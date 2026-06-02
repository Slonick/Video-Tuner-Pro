// Video Speed Controller Pro — content script (Chrome + Firefox)
// Cross-browser API alias: Firefox exposes `browser`, Chrome exposes `chrome`.
// `chrome` is also available in Firefox as a callback-style alias, so we use it.
const api = (typeof browser !== "undefined") ? browser : chrome;

const MIN_SPEED = 0.1;
const MAX_SPEED = 16;

// --- Live-sync tuning ---
const LIVE_SYNC_GAIN = 0.05;       // extra rate per second of lag over the target
const MIN_FORWARD_BUFFER = 0.3;    // smallest buffer we'll ever drain down to
const SMOOTH_ALPHA = 0.34;         // how fast currentSpeed eases toward the target
const LIVE_MAX_FLOOR = 1.25;       // catch-up max can never be set below 125%

let currentSpeed = 1.0;
// Live-sync mode keeps live streams near the live edge automatically.
let liveSyncEnabled = false;
let liveSyncTarget = 3;            // seconds of allowed lag behind the live edge (0–15)
let liveSyncMax = 1.5;            // max catch-up rate (multiplier), never below 1.25
let lastSyncPct = -1;
let liveSeenAt = 0;               // timestamp of the last live <video> we saw (sticky detection)
let lastDropped = 0;              // dropped-frame counter from the previous tick
let liveTick = null;             // handle for the background interval, so we can stop it
const seenVideos = new WeakSet();

function getDomain() {
  return window.location.hostname;
}

// The extension context dies when the extension is reloaded/updated; any api.*
// call from this orphaned script then throws. Detect that and shut down cleanly.
function ctxValid() {
  try { return !!(api.runtime && api.runtime.id); } catch (e) { return false; }
}

function teardown() {
  if (liveTick) { clearInterval(liveTick); liveTick = null; }
  try { observer.disconnect(); } catch (e) { /* ignore */ }
}

// Localized string, guarded so a dead context never throws an uncaught error.
function i18n(key, subs) {
  try { return api.i18n.getMessage(key, subs) || ""; } catch (e) { return ""; }
}

function clamp(speed) {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 100) / 100));
}

function clampTarget(n) {
  n = Number(n);
  if (Number.isNaN(n)) return 3;
  return Math.min(15, Math.max(0, Math.round(n)));
}

function clampMax(n) {
  n = Number(n);
  if (Number.isNaN(n)) return 1.5;
  return Math.min(3, Math.max(LIVE_MAX_FLOOR, Math.round(n * 100) / 100));
}

// --- Live-stream detection -------------------------------------------------
function isLive(video) {
  // Most live MSE streams report an infinite duration (Twitch, many players).
  if (video.duration === Infinity) return true;

  // YouTube live (including DVR streams) reports a FINITE, growing duration, so
  // the duration check alone misses it. YouTube adds the "ytp-live" class to the
  // player and time-display, and shows a live badge — only while a live stream is
  // playing, never on regular VOD. Use those as the signal.
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)) {
    const player = (video.closest && video.closest(".html5-video-player")) ||
                   document.querySelector(".html5-video-player");
    if (player && player.classList.contains("ytp-live")) return true;
    if (document.querySelector(".ytp-time-display.ytp-live")) return true;
    const badge = document.querySelector(".ytp-live-badge");
    if (badge && badge.offsetParent !== null) return true; // visible = live
  }
  return false;
}

// Seconds of media buffered ahead of the current position. On a live stream the
// player downloads up to the live edge, so this doubles as our lag-behind-live.
function forwardBuffer(video) {
  const b = video.buffered;
  const t = video.currentTime;
  try {
    for (let i = 0; i < b.length; i++) {
      if (t >= b.start(i) - 0.25 && t <= b.end(i) + 0.25) return b.end(i) - t;
    }
  } catch (e) { /* ignore */ }
  return 0;
}

// Net video frames dropped since the previous call (decoder/network can't keep up).
function droppedFramesDelta(video) {
  try {
    const q = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    const total = q ? q.droppedVideoFrames : 0;
    const delta = total - lastDropped;
    lastDropped = total;
    return delta > 0 ? delta : 0;
  } catch (e) { return 0; }
}

// Pick the main live <video>: prefer the one that's actually playing and largest,
// so tiny preview/ad players don't make detection flicker on/off.
function liveVideo() {
  let best = null;
  let bestScore = -1;
  for (const v of document.querySelectorAll("video")) {
    if (!isLive(v)) continue;
    const r = v.getBoundingClientRect();
    const score = (v.paused ? 0 : 1e9) + r.width * r.height;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  if (best) liveSeenAt = Date.now();
  return best;
}

// True if this page is a live stream, staying sticky through brief detection
// flickers (quality switches momentarily report a finite duration on Twitch).
function onStreamPage() {
  return !!liveVideo() || (Date.now() - liveSeenAt < 6000);
}

// Dispatcher: on a live stream, speed is controlled ONLY here — manual speed is
// never applied to streams. Sync OFF → hold 100%. Sync ON → auto catch-up.
// Throttled: the indicator writes to the DOM, which re-triggers the observer, so
// without this guard a single update would loop and freeze the tab.
let lastControlAt = 0;
function controlLive() {
  if (!ctxValid()) { teardown(); return; }
  const now = Date.now();
  if (now - lastControlAt < 250) return;
  lastControlAt = now;
  const live = liveVideo();
  if (!live) return;
  if (liveSyncEnabled) {
    runLiveSync(live);
  } else {
    forceLiveNormal();
  }
}

// Sync OFF: a live stream always plays at 100% (no manual/inherited speed).
function forceLiveNormal() {
  if (currentSpeed !== 1.0) {
    currentSpeed = 1.0;
    applyAll();
    showIndicator(i18n("indicatorLive"));
  }
}

// Sync ON: keep the stream within `liveSyncTarget` seconds of the live edge by
// gently raising the rate (up to `liveSyncMax`).
//
// We measure lag as the buffered-ahead amount, NOT seekable.end − currentTime:
// on Twitch `seekable.end` is a useless sentinel (~2^30). The player downloads
// segments up to the live edge, so (buffered.end − currentTime) is how far behind
// live we actually are. Speeding up drains that buffer back down toward the target,
// which self-limits — we stop before the buffer runs out.
function runLiveSync(video) {
  if (video.paused) return;

  const lag = forwardBuffer(video);
  const dropped = droppedFramesDelta(video);
  const maxBoost = Math.max(LIVE_MAX_FLOOR, liveSyncMax) - 1;
  // Never drain below a small floor even if the user sets the target to 0.
  const floor = Math.max(liveSyncTarget, MIN_FORWARD_BUFFER);
  let desired = 1.0;
  if (lag > floor && dropped === 0) {
    desired = 1.0 + Math.min(maxBoost, (lag - liveSyncTarget) * LIVE_SYNC_GAIN);
  }

  // Ease toward the target so the speed change isn't audible as a jump.
  let next = currentSpeed + (desired - currentSpeed) * SMOOTH_ALPHA;
  if (Math.abs(next - desired) < 0.005) next = desired;
  next = clamp(next);

  if (Math.abs(next - currentSpeed) > 0.001) {
    currentSpeed = next;
    applyAll();
  }

  const pct = Math.round(currentSpeed * 100);
  if (pct !== lastSyncPct) {
    lastSyncPct = pct;
    showIndicator(pct > 100
      ? i18n("indicatorCatchup", [String(pct)])
      : i18n("indicatorSynced"));
  }
}

// --- Loading & applying ----------------------------------------------------
function loadSpeed() {
  if (!ctxValid()) return;
  api.storage.local.get(
    ["domains", "liveSync", "liveSyncTarget", "liveSyncMax"],
    (result) => {
      const domains = result.domains || {};
      liveSyncEnabled = !!result.liveSync;
      liveSyncTarget = clampTarget(result.liveSyncTarget != null ? result.liveSyncTarget : 3);
      liveSyncMax = clampMax(result.liveSyncMax != null ? result.liveSyncMax : 1.5);
      // Only sites the user explicitly remembered get a saved speed; the rest are 100%.
      currentSpeed = clamp(domains[getDomain()] || 1.0);
      applyAll();
      // A live stream never inherits a saved speed — sync (or 100%) takes over.
      controlLive();
    }
  );
}

function persistDomainSpeed(speed) {
  if (!ctxValid()) return;
  api.storage.local.get(["domains"], (result) => {
    const domains = result.domains || {};
    domains[getDomain()] = speed;
    api.storage.local.set({ domains });
  });
}

function applyToVideo(video) {
  try {
    video.playbackRate = currentSpeed;
  } catch (e) { /* some players reject rate before metadata is ready */ }

  if (seenVideos.has(video)) return;
  seenVideos.add(video);

  const reapply = () => {
    // On live streams the rate is governed by controlLive's tick; don't fight the
    // player's own latency control here, or the tug-of-war drops frames.
    if (isLive(video)) return;
    if (Math.abs(video.playbackRate - currentSpeed) > 0.001) {
      try { video.playbackRate = currentSpeed; } catch (e) {}
    }
  };
  video.addEventListener("play", reapply);
  video.addEventListener("loadeddata", reapply);
  video.addEventListener("ratechange", reapply);

  // Re-evaluate live state as the stream loads and as playback progresses.
  video.addEventListener("durationchange", controlLive);
  video.addEventListener("loadedmetadata", controlLive);
  video.addEventListener("timeupdate", controlLive);
}

function applyAll() {
  document.querySelectorAll("video").forEach(applyToVideo);
}

function setSpeed(speed, persist, manual) {
  // Streams ignore manual speed entirely — they're governed by Live-sync.
  if (manual && onStreamPage()) return;
  currentSpeed = clamp(speed);
  applyAll();
  if (persist) persistDomainSpeed(currentSpeed);
  showIndicator();
}

// --- Transient on-screen feedback (popup-style, auto-hides) ----------------
let indicatorEl = null;
let indicatorTimer = null;

function showIndicator(text) {
  if (!document.body) return;
  if (!indicatorEl) {
    indicatorEl = document.createElement("div");
    indicatorEl.style.cssText = [
      "position:fixed", "top:16px", "right:16px", "z-index:2147483647",
      "background:rgba(40,40,60,0.92)", "color:#fff", "font:600 14px/1 -apple-system,Segoe UI,Roboto,sans-serif",
      "padding:10px 14px", "border-radius:10px", "pointer-events:none",
      "box-shadow:0 4px 12px rgba(0,0,0,0.35)", "transition:opacity .25s",
      "opacity:0"
    ].join(";");
    document.body.appendChild(indicatorEl);
  }
  indicatorEl.textContent = text || `⏩ ${Math.round(currentSpeed * 100)}%  (${currentSpeed.toFixed(2)}x)`;
  indicatorEl.style.opacity = "1";
  clearTimeout(indicatorTimer);
  indicatorTimer = setTimeout(() => {
    if (indicatorEl) indicatorEl.style.opacity = "0";
  }, 1200);
}

// --- Init ------------------------------------------------------------------
loadSpeed();

// Steady background tick so live-sync works even when timeupdate is sparse.
liveTick = setInterval(controlLive, 1000);

// Watch for videos added later (SPA navigation, lazy players). Chat-heavy pages
// (Twitch) mutate constantly, so coalesce a burst into a single rAF pass rather
// than reacting to every node — and never re-run for our own indicator writes.
let observerScheduled = false;
const observer = new MutationObserver((mutations) => {
  if (!ctxValid()) { teardown(); return; }
  if (observerScheduled) return;
  if (mutations.every((m) => indicatorEl && indicatorEl.contains(m.target))) return;
  observerScheduled = true;
  requestAnimationFrame(() => {
    observerScheduled = false;
    applyAll();
    controlLive();
  });
});
function startObserver() {
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
if (document.documentElement) {
  startObserver();
} else {
  document.addEventListener("DOMContentLoaded", startObserver);
}

// React instantly when settings change in the popup.
api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.liveSync) liveSyncEnabled = !!changes.liveSync.newValue;
  if (changes.liveSyncTarget) liveSyncTarget = clampTarget(changes.liveSyncTarget.newValue);
  if (changes.liveSyncMax) liveSyncMax = clampMax(changes.liveSyncMax.newValue);
  if (changes.liveSync || changes.liveSyncTarget || changes.liveSyncMax) {
    lastSyncPct = -1;
    controlLive();
  }
});

// --- Popup messages --------------------------------------------------------
api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "setSpeed") {
    // Apply for this tab session only; persistence happens via "rememberSite".
    setSpeed(request.speed, false, true);
    sendResponse({ success: true, speed: currentSpeed, live: onStreamPage() });
  } else if (request.action === "rememberSite") {
    const speed = typeof request.speed === "number" ? clamp(request.speed) : currentSpeed;
    persistDomainSpeed(speed);
    sendResponse({ success: true, speed });
  } else if (request.action === "getSpeed") {
    sendResponse({ speed: currentSpeed, domain: getDomain(), live: onStreamPage() });
  }
  return true;
});
