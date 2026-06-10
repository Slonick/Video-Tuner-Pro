// Video Tuner Pro — content script (Chrome + Firefox)
// Cross-browser API alias: Firefox exposes `browser`, Chrome exposes `chrome`.
// `chrome` is also available in Firefox as a callback-style alias, so we use it.
const api = (typeof browser !== "undefined") ? browser : chrome;

// Settings sync across the user's devices (Chrome Sync / Firefox Sync, which are
// separate per browser). Falls back to device-local storage if sync is missing.
const STORE = (api.storage && api.storage.sync) ? api.storage.sync : api.storage.local;
const STORE_AREA = (api.storage && STORE === api.storage.sync) ? "sync" : "local";

const MIN_SPEED = 0.1;
const MAX_SPEED = 16;

// --- Live-sync tuning ---
// Catch-up uses ONE fixed rate with hysteresis: changing playbackRate constantly
// re-syncs the browser's audio time-stretcher (robotic/crackly sound), so we flip
// speed only at the band edges, not continuously.
const MIN_FORWARD_BUFFER = 0.3;    // smallest buffer we'll ever drain down to
const LIVE_MAX_FLOOR = 1.25;       // catch-up rate can never be set below 125%
const CATCHUP_START = 2.0;         // begin catching up once this many seconds beyond the target
const CATCHUP_STOP = 0.3;          // stop once back within this of the target

let currentSpeed = 1.0;
// Live-sync mode keeps live streams near the live edge automatically.
let liveSyncEnabled = false;
let liveSyncTarget = 3;            // seconds of allowed lag behind the live edge (0–15)
let liveSyncMax = 1.5;            // max catch-up rate (multiplier), never below 1.25
let lastSyncPct = -1;
let liveSeenAt = 0;               // timestamp of the last live <video> we saw (sticky detection)
let lastDropped = 0;              // dropped-frame counter from the previous tick
let liveTick = null;             // handle for the background interval, so we can stop it
let showRemaining = false;        // on-video badge: speed + real remaining time
const seenVideos = new WeakSet();

// --- Audio compression (Web Audio) ---
// Routes each media element through a DynamicsCompressorNode + make-up GainNode to
// even out loud/quiet passages. Global setting (applies on every site).
let audioCompEnabled = false;
// Raw DynamicsCompressor parameters (the popup's "simple" strength slider just
// writes these too, so the content script only ever applies raw values).
let audioCompThreshold = -50;    // dB, -100…0  (FrankerFaceZ defaults)
let audioCompKnee = 40;          // dB, 0…40
let audioCompRatio = 12;         // x:1, 1…20
let audioCompAttack = 0;         // s, 0…1
let audioCompRelease = 0.25;     // s, 0…1
let audioCompGain = 0;           // make-up gain in dB, 0…24
let audioCtx = null;
const audioGraphs = new WeakMap(); // video -> { source, comp, gain }
const audioSkipped = new WeakSet(); // videos we must not route (CORS-risk / already wired)
let audioGestureHooked = false;

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

// Clamp a numeric setting to [lo, hi], falling back to def when not a number.
function clampNum(v, lo, hi, def) {
  const n = Number(v);
  if (Number.isNaN(n)) return def;
  return Math.min(hi, Math.max(lo, n));
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

  // Generic fallback (covers Twitch low-latency etc., where duration isn't
  // Infinity): a stream whose media edge advances in real time, set by probeLive.
  const s = liveProbe.get(video);
  if (s && s.live) return true;
  return false;
}

// --- Generic live detection ------------------------------------------------
// Live content can only be fetched at ~1x real time (it doesn't exist yet),
// whereas a VOD exposes its whole length immediately (seekable.end = duration,
// constant) and buffers ahead faster than real time. So we sample the furthest
// known media position and call it live when it advances at roughly 1x.
const liveProbe = new WeakMap();

function streamEnd(v) {
  let end = 0;
  try {
    const sk = v.seekable; // some players (Twitch) report a huge sentinel here
    if (sk && sk.length) { const e = sk.end(sk.length - 1); if (isFinite(e) && e < 1e7) end = Math.max(end, e); }
    const bf = v.buffered;
    if (bf && bf.length) end = Math.max(end, bf.end(bf.length - 1));
    if (isFinite(v.duration) && v.duration < 1e7) end = Math.max(end, v.duration);
  } catch (e) { /* ignore */ }
  return end;
}

function probeLive(v) {
  if (!v) return;
  const t = Date.now();
  if (v.duration === Infinity) { liveProbe.set(v, { lastEnd: 0, lastT: t, lastGrow: t, live: true }); return; }
  const end = streamEnd(v);
  let s = liveProbe.get(v);
  if (!s) { liveProbe.set(v, { lastEnd: end, lastT: t, lastGrow: 0, live: false }); return; }
  const dT = (t - s.lastT) / 1000;
  if (dT < 0.4) return; // need spacing between samples for a stable rate
  const rate = (end - s.lastEnd) / dT;
  s.lastEnd = end; s.lastT = t;
  // Real-time growth (~1x) = a live edge; VOD is either flat (~0) or bursty (>>1).
  if (rate > 0.3 && rate < 1.7) s.lastGrow = t;
  s.live = (t - s.lastGrow) < 12000; // sticky, survives brief stalls/quality switches
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

// Collect every <video> on the page, piercing OPEN shadow roots. Some players
// (e.g. Boosty) render the <video> inside a shadow DOM, where a plain
// document.querySelectorAll("video") can't reach it.
function collectVideos() {
  const acc = [];
  const seen = new Set();
  const scan = (root) => {
    let vids;
    try { vids = root.querySelectorAll("video"); } catch (e) { return; }
    for (const v of vids) { if (!seen.has(v)) { seen.add(v); acc.push(v); } }
    let all;
    try { all = root.querySelectorAll("*"); } catch (e) { return; }
    for (const el of all) { if (el.shadowRoot) scan(el.shadowRoot); }
  };
  scan(document);
  return acc;
}

// Pick the main live <video>: prefer the one that's actually playing and largest,
// so tiny preview/ad players don't make detection flicker on/off.
function liveVideo() {
  let best = null;
  let bestScore = -1;
  for (const v of collectVideos()) {
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

// Sync ON: keep the stream within `liveSyncTarget` seconds of the live edge.
//
// We measure lag as the buffered-ahead amount, NOT seekable.end − currentTime:
// on Twitch `seekable.end` is a useless sentinel (~2^30). The player downloads
// segments up to the live edge, so (buffered.end − currentTime) is how far behind
// live we actually are. Speeding up drains that buffer back down toward the target,
// which self-limits — we stop before the buffer runs out.
//
// Catch-up runs at ONE fixed rate (liveSyncMax) with hysteresis: we start only
// once clearly behind and stop once back near the target. Playback rate therefore
// changes just twice per cycle, so the audio stays clean (no continuous re-pitch).
function runLiveSync(video) {
  if (video.paused) return;

  const lag = forwardBuffer(video);
  const dropped = droppedFramesDelta(video);
  const target = Math.max(liveSyncTarget, MIN_FORWARD_BUFFER);
  const rate = clamp(Math.max(LIVE_MAX_FLOOR, liveSyncMax)); // fixed catch-up speed

  let desired = currentSpeed;
  if (currentSpeed > 1.0) {
    // Already catching up — hold the fixed rate until we're back near the target,
    // or bail early if frames start dropping (network/decoder can't keep up).
    if (lag <= target + CATCHUP_STOP || dropped > 0) desired = 1.0;
  } else {
    // Normal — start catching up only once we've fallen clearly behind.
    if (lag > target + CATCHUP_START && dropped === 0) desired = rate;
  }

  if (Math.abs(desired - currentSpeed) > 0.001) {
    currentSpeed = desired;
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

// --- Audio compression -----------------------------------------------------
// Routing a media element through Web Audio SILENCES it if the underlying media
// is cross-origin without CORS. To avoid muting people's audio, only route media
// that's safe: a MediaStream (srcObject), MSE/blob, data:, same-origin, or an
// element that opted into CORS.
function canRouteAudio(video) {
  // MediaStream playback (e.g. Twitch) leaves src/currentSrc empty — it's local
  // and routable. This is the case FFZ's canCompress() allows via srcObject.
  if (video.srcObject) return true;
  const src = video.currentSrc || video.src || "";
  if (!src) return false;
  if (src.startsWith("blob:") || src.startsWith("data:")) return true; // MSE / inline
  try {
    if (new URL(src, location.href).origin === location.origin) return true; // same-origin
  } catch (e) { return false; }
  return !!video.crossOrigin; // cross-origin only if the site set crossorigin=...
}

function alog(...args) { try { console.info("[Video Tuner]", ...args); } catch (e) {} }

function resumeAudioCtx() {
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
}

function ensureAudioCtx() {
  if (audioCtx) return audioCtx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = AC ? new AC() : null;
  } catch (e) { audioCtx = null; }
  if (audioCtx) {
    hookAudioGesture();
    // A fresh context starts "suspended" until a user gesture. When it finally
    // resumes, (re)build the graphs we deferred while it was suspended.
    audioCtx.addEventListener("statechange", () => {
      alog("AudioContext state:", audioCtx.state);
      if (audioCtx.state === "running") applyAudioComp();
    });
    resumeAudioCtx();
  }
  return audioCtx;
}

let lastAudioSkip = null; // why the most recent setupGraph() bailed: 'cors' | 'inuse' | 'noctx'
let lastNotRoutableLog = null; // throttles the "not routable yet" diagnostic log

function setupGraph(video) {
  if (audioGraphs.has(video)) return audioGraphs.get(video);
  // audioSkipped only holds elements that genuinely can't be captured (another
  // graph already owns them) — that's permanent for the element's lifetime.
  if (audioSkipped.has(video)) { lastAudioSkip = "inuse"; return null; }
  // NOT routable yet: do NOT ban the element. Its src may still be loading or the
  // player may have just swapped the <video> (common on Twitch). Retry next tick.
  if (!canRouteAudio(video)) {
    lastAudioSkip = "cors";
    const sig = (video.currentSrc || video.src || "") + "|" + !!video.srcObject;
    if (sig !== lastNotRoutableLog) { // log only when the state changes, not every tick
      lastNotRoutableLog = sig;
      alog("audio: not routable yet —", { currentSrc: video.currentSrc || video.src || "", hasSrcObject: !!video.srcObject });
    }
    return null;
  }
  const ctx = ensureAudioCtx();
  if (!ctx) { lastAudioSkip = "noctx"; return null; }
  // Capturing into a suspended context silences the element until it resumes, so
  // wait until it's running. ensureAudioCtx's statechange handler rebuilds when it
  // resumes; the 1s tick also retries. (This is what FFZ does.)
  if (ctx.state !== "running") { lastAudioSkip = "suspended"; resumeAudioCtx(); return null; }
  let source;
  try {
    source = ctx.createMediaElementSource(video);
  } catch (e) {
    // Element already feeds another Web Audio graph (another extension or the
    // player itself) — only one capture per element is allowed.
    lastAudioSkip = "inuse";
    audioSkipped.add(video);
    alog("audio: skipped (element already captured by another extension/player)");
    return null;
  }
  const comp = ctx.createDynamicsCompressor();
  const gain = ctx.createGain();
  source.connect(comp);
  comp.connect(gain);
  gain.connect(ctx.destination);
  // Taps for the popup's before/after level meters. Analysers analyze whatever is
  // fed to them even with no onward connection, so they don't alter the audio.
  const analyserIn = ctx.createAnalyser();
  const analyserOut = ctx.createAnalyser();
  analyserIn.fftSize = analyserOut.fftSize = 1024;
  analyserIn.smoothingTimeConstant = analyserOut.smoothingTimeConstant = 0.5;
  source.connect(analyserIn);
  gain.connect(analyserOut);
  const g = { source, comp, gain, analyserIn, analyserOut };
  audioGraphs.set(video, g);
  // Once audio is routed through a suspended context it goes silent, so resume
  // whenever this element starts playing.
  video.addEventListener("playing", resumeAudioCtx, { passive: true });
  alog("audio: compression graph engaged on a video");
  return g;
}

// Ramp an AudioParam toward a value instead of assigning .value directly — an
// abrupt jump produces an audible click. Short time-constant = quick but smooth.
function rampParam(param, value) {
  try {
    const t = audioCtx ? audioCtx.currentTime : 0;
    param.cancelScheduledValues(t);
    param.setTargetAtTime(value, t, 0.02);
  } catch (e) {
    try { param.value = value; } catch (_) {}
  }
}

// Off = transparent graph (ratio 1:1, unity gain) rather than disconnecting, since
// a created source can't be cleanly un-routed back to the element's native output.
// Skipped when nothing changed, so we don't re-poke params every tick (clicks).
function applyGraphParams(g) {
  const on = audioCompEnabled;
  const key = on
    ? `${audioCompThreshold}|${audioCompKnee}|${audioCompRatio}|${audioCompAttack}|${audioCompRelease}|${audioCompGain}`
    : "off";
  if (g._key === key) return;
  g._key = key;
  try {
    rampParam(g.comp.threshold, on ? audioCompThreshold : 0);
    rampParam(g.comp.knee, on ? audioCompKnee : 0);
    rampParam(g.comp.ratio, on ? audioCompRatio : 1);
    rampParam(g.comp.attack, on ? audioCompAttack : 0.003);
    rampParam(g.comp.release, on ? audioCompRelease : 0.25);
    rampParam(g.gain.gain, on ? Math.pow(10, audioCompGain / 20) : 1);
  } catch (e) { /* node detached */ }
}

function hookAudioGesture() {
  if (audioGestureHooked) return;
  audioGestureHooked = true;
  const resume = () => { if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {}); };
  document.addEventListener("click", resume, { capture: true, passive: true });
  document.addEventListener("keydown", resume, { capture: true, passive: true });
}

function applyAudioComp(videos) {
  const list = videos || collectVideos();
  let engaged = 0, skipped = 0, reason = null;
  for (const v of list) {
    let g = audioGraphs.get(v);
    if (!g) {
      if (!audioCompEnabled) continue; // don't capture audio until the user enables it
      g = setupGraph(v);
      if (!g) {
        skipped++;
        // 'inuse' is the more specific/actionable reason — prefer it.
        if (lastAudioSkip === "inuse") reason = "inuse";
        else if (!reason) reason = lastAudioSkip;
        continue;
      }
    }
    applyGraphParams(g);
    engaged++;
  }
  if (audioCompEnabled) { hookAudioGesture(); resumeAudioCtx(); }
  return { engaged, skipped, reason };
}

// --- Loading & applying ----------------------------------------------------
function loadSpeed() {
  if (!ctxValid()) return;
  STORE.get(
    ["domains", "liveSync", "liveSyncTarget", "liveSyncMax",
     "audioComp", "audioCompThreshold", "audioCompKnee", "audioCompRatio",
     "audioCompAttack", "audioCompRelease", "audioCompGain", "showRemaining"],
    (result) => {
      const domains = result.domains || {};
      showRemaining = !!result.showRemaining;
      liveSyncEnabled = !!result.liveSync;
      liveSyncTarget = clampTarget(result.liveSyncTarget != null ? result.liveSyncTarget : 3);
      liveSyncMax = clampMax(result.liveSyncMax != null ? result.liveSyncMax : 1.5);
      audioCompEnabled = !!result.audioComp;
      audioCompThreshold = clampNum(result.audioCompThreshold, -100, 0, -50);
      audioCompKnee = clampNum(result.audioCompKnee, 0, 40, 40);
      audioCompRatio = clampNum(result.audioCompRatio, 1, 20, 12);
      audioCompAttack = clampNum(result.audioCompAttack, 0, 1, 0);
      audioCompRelease = clampNum(result.audioCompRelease, 0, 1, 0.25);
      audioCompGain = clampNum(result.audioCompGain, 0, 24, 0);
      // Only sites the user explicitly remembered get a saved speed; the rest are 100%.
      currentSpeed = clamp(domains[getDomain()] || 1.0);
      applyAll();
      // A live stream never inherits a saved speed — sync (or 100%) takes over.
      controlLive();
      updateTimeBadge();
    }
  );
}

function persistDomainSpeed(speed) {
  if (!ctxValid()) return;
  STORE.get(["domains"], (result) => {
    const domains = result.domains || {};
    domains[getDomain()] = speed;
    STORE.set({ domains });
  });
}

function applyToVideo(video) {
  try {
    // Only set when it actually differs — applyAll runs often (1s tick + every
    // MutationObserver pass, which is frequent on chat-heavy pages). Re-assigning
    // playbackRate each time restarts the audio time-stretcher and glitches sound
    // during sped-up playback.
    if (Math.abs(video.playbackRate - currentSpeed) > 0.001) video.playbackRate = currentSpeed;
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
  const videos = collectVideos();
  videos.forEach(applyToVideo);
  videos.forEach(probeLive); // sample media edge for generic live detection
  applyAudioComp(videos);
  updateBadge();
}

// --- Toolbar icon ----------------------------------------------------------
// Tell the background what to draw on the toolbar icon for this tab:
//   • the speed multiplier badge (e.g. 1.0, 0.5, 1.5, 1.75) is always shown;
//   • on a live stream the play triangle is drawn red (live: true);
//   • no video -> clear back to the default icon.
// The frame that owns the video drives it; a frame that never had a video stays
// silent so it can't clobber another frame's icon.
let lastBadge = null;
let badgeHadVideo = false;
let badgeUrl = location.href;
function speedLabel(s) {
  // Round to 2 decimals, but always keep at least one decimal: 1 -> "1.0",
  // 2 -> "2.0", 1.5 -> "1.5", 1.75 -> "1.75".
  let str = String(Math.round(s * 100) / 100);
  if (!str.includes(".")) str += ".0";
  return str;
}
function updateBadge() {
  // SPA navigation (YouTube etc.) changes the URL without reloading the content
  // script, so the dedupe cache below would suppress the re-send. Reset it on URL
  // change so the icon is re-asserted for the new page.
  const urlChanged = location.href !== badgeUrl;
  if (urlChanged) { badgeUrl = location.href; lastBadge = null; }

  const hasVideo = collectVideos().length > 0;
  let payload;
  if (hasVideo) {
    payload = { action: "icon", text: speedLabel(currentSpeed), live: onStreamPage() };
  } else if (badgeHadVideo || urlChanged) {
    payload = { action: "icon", clear: true }; // had a video / navigated away
  } else {
    return;                                    // never had one — leave the icon alone
  }
  badgeHadVideo = hasVideo;
  const key = JSON.stringify(payload);
  if (key === lastBadge) return;
  lastBadge = key;
  if (!ctxValid()) return;
  try { api.runtime.sendMessage(payload); } catch (e) {}
}

function setSpeed(speed, persist, manual) {
  // Streams ignore manual speed entirely — they're governed by Live-sync.
  if (manual && onStreamPage()) return;
  currentSpeed = clamp(speed);
  applyAll();
  if (persist) persistDomainSpeed(currentSpeed);
  showIndicator();
  updateTimeBadge(); flashBadge();
}

// --- Transient on-screen feedback (minimal pill, overlaid on the video) -----
let indicatorEl = null;
let indicatorTimer = null;

// Largest playing video — what the overlay anchors to.
function primaryVideo() {
  let best = null, bestScore = -1;
  for (const v of collectVideos()) {
    const r = v.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) continue;
    const score = (v.paused ? 0 : 1e9) + r.width * r.height;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  return best;
}

function showIndicator(text) {
  if (!document.body) return;
  if (!indicatorEl) {
    indicatorEl = document.createElement("div");
    indicatorEl.style.cssText = [
      "position:fixed", "z-index:2147483647", "pointer-events:none",
      "font:500 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif",
      "color:#fff", "background:rgba(0,0,0,0.55)", "padding:5px 9px",
      "border-radius:6px", "white-space:nowrap", "transition:opacity .2s", "opacity:0",
      "-webkit-backdrop-filter:blur(3px)", "backdrop-filter:blur(3px)"
    ].join(";");
  }

  // Overlay sits over the video via fixed (viewport) coords. Host is normally
  // <body>; in fullscreen we move it under the fullscreen element, since a body
  // child wouldn't render over a fullscreen player. We avoid hosting inside the
  // player container because a transform there would break fixed positioning.
  const video = primaryVideo();
  const fsEl = document.fullscreenElement;
  const host = (fsEl && fsEl.tagName !== "VIDEO") ? fsEl : document.body;
  if (indicatorEl.parentNode !== host) host.appendChild(indicatorEl);

  if (video) {
    const r = video.getBoundingClientRect();
    indicatorEl.style.left = Math.round(r.left + r.width / 2) + "px";
    indicatorEl.style.top = Math.round(r.top + Math.max(10, r.height * 0.05)) + "px";
    indicatorEl.style.transform = "translateX(-50%)";
  } else {
    indicatorEl.style.left = "50%";
    indicatorEl.style.top = "14px";
    indicatorEl.style.transform = "translateX(-50%)";
  }

  indicatorEl.textContent = text || `${Math.round(currentSpeed * 100)}%`;
  indicatorEl.style.opacity = "1";
  clearTimeout(indicatorTimer);
  indicatorTimer = setTimeout(() => {
    if (indicatorEl) indicatorEl.style.opacity = "0";
  }, 1200);
}

// --- On-video badge: speed + real remaining time (optional) ----------------
function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// Parse a "H:MM:SS" / "MM:SS" clock (SponsorBlock's text is like "(1:54:13)").
function parseClock(t) {
  const m = String(t).match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  return m[3] != null ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
}

// Effective content duration. SponsorBlock, when its "show duration after skips"
// option is on, injects #sponsorBlockDurationAfterSkips with the real length —
// already reflecting the user's own skip categories. Use it when present; we can't
// read another extension's settings, so without it we fall back to the full length.
function effectiveDuration(video) {
  try {
    const el = document.getElementById("sponsorBlockDurationAfterSkips");
    if (el) { const s = parseClock(el.textContent); if (s > 0) return s; }
  } catch (e) { /* ignore */ }
  return video.duration;
}

let timeBadgeEl = null;
let timeBadgeHideTimer = null;
let badgeVideo = null;          // cached primary video so mousemove stays cheap
let badgeMoveHooked = false;

function renderBadge(v) {
  const r = v.getBoundingClientRect();
  timeBadgeEl.style.left = Math.round(r.left + Math.max(10, r.width * 0.012)) + "px";
  timeBadgeEl.style.top = Math.round(r.top + Math.max(10, r.height * 0.04)) + "px";
  const speed = v.playbackRate || currentSpeed || 1;
  const dur = v.duration;
  const eff = effectiveDuration(v); // SponsorBlock real length, or full length
  const frac = dur > 0 ? Math.min(1, v.currentTime / dur) : 0;
  const remain = Math.max(0, eff * (1 - frac)) / speed;
  const sp = Math.round(speed * 100) / 100;
  timeBadgeEl.textContent = `${sp}× · ${fmtTime(remain)}`;
}

// Show the badge briefly, then fade it out — like player controls.
function flashBadge() {
  if (!timeBadgeEl || timeBadgeEl.style.display === "none") return;
  timeBadgeEl.style.opacity = "1";
  clearTimeout(timeBadgeHideTimer);
  timeBadgeHideTimer = setTimeout(() => { if (timeBadgeEl) timeBadgeEl.style.opacity = "0"; }, 2600);
}

function hookBadgeMouse() {
  if (badgeMoveHooked) return;
  badgeMoveHooked = true;
  document.addEventListener("mousemove", (e) => {
    if (!showRemaining || !timeBadgeEl || !badgeVideo) return;
    const r = badgeVideo.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    renderBadge(badgeVideo);
    flashBadge();
  }, { passive: true });
}

// Keep the badge's content/position fresh (called every tick). Visibility itself
// is driven by mouse movement (flashBadge), so it only appears when you move over
// the video and auto-hides after a moment.
function updateTimeBadge() {
  if (!showRemaining) { if (timeBadgeEl) timeBadgeEl.style.display = "none"; badgeVideo = null; return; }
  const v = primaryVideo();
  if (!v || !isFinite(v.duration) || v.duration <= 0 || onStreamPage()) {
    if (timeBadgeEl) timeBadgeEl.style.display = "none";
    badgeVideo = null;
    return;
  }
  badgeVideo = v;
  hookBadgeMouse();
  if (!timeBadgeEl) {
    timeBadgeEl = document.createElement("div");
    timeBadgeEl.style.cssText = [
      "position:fixed", "z-index:2147483646", "pointer-events:none",
      "font:600 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif",
      "color:#fff", "background:rgba(0,0,0,0.55)", "padding:5px 9px",
      "border-radius:6px", "white-space:nowrap", "opacity:0", "transition:opacity .25s",
      "-webkit-backdrop-filter:blur(3px)", "backdrop-filter:blur(3px)"
    ].join(";");
  }
  const fsEl = document.fullscreenElement;
  const host = (fsEl && fsEl.tagName !== "VIDEO") ? fsEl : document.body;
  if (timeBadgeEl.parentNode !== host) host.appendChild(timeBadgeEl);
  timeBadgeEl.style.display = "block";
  renderBadge(v);
}

// After the user flips the audio toggle, the graph may not engage on the very
// first try (src still loading, context suspended, player swapping the <video>).
// Poll briefly so we report the real outcome instead of a transient "unavailable".
let audioAnnounceTimer = null;
function announceAudioStatus(attempt) {
  clearTimeout(audioAnnounceTimer);
  if (!audioCompEnabled) { showIndicator(i18n("audioOff") || "Audio compression off"); return; }
  const res = applyAudioComp();
  if (res.engaged > 0) { showIndicator(i18n("audioOn") || "Audio compression on"); return; }
  if (res.reason === "inuse") { showIndicator(i18n("audioInUse") || "Audio already used by another extension/player"); return; }
  if ((attempt || 0) < 6) { // ~3s of retries while it loads / resumes
    audioAnnounceTimer = setTimeout(() => announceAudioStatus((attempt || 0) + 1), 500);
    return;
  }
  showIndicator(i18n("audioUnavailable") || "Compression unavailable on this video");
}

// --- Init ------------------------------------------------------------------
loadSpeed();

// Steady background tick: re-apply speed (catches videos created inside shadow
// roots, where document mutations don't fire) and drive live-sync.
liveTick = setInterval(() => { applyAll(); controlLive(); updateTimeBadge(); }, 1000);

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
  if (area !== STORE_AREA) return;
  if (changes.liveSync) liveSyncEnabled = !!changes.liveSync.newValue;
  if (changes.liveSyncTarget) liveSyncTarget = clampTarget(changes.liveSyncTarget.newValue);
  if (changes.liveSyncMax) liveSyncMax = clampMax(changes.liveSyncMax.newValue);
  if (changes.liveSync || changes.liveSyncTarget || changes.liveSyncMax) {
    lastSyncPct = -1;
    controlLive();
  }
  if (changes.showRemaining) { showRemaining = !!changes.showRemaining.newValue; updateTimeBadge(); flashBadge(); }
  let audioChanged = false;
  if (changes.audioComp) { audioCompEnabled = !!changes.audioComp.newValue; audioChanged = true; }
  if (changes.audioCompThreshold) { audioCompThreshold = clampNum(changes.audioCompThreshold.newValue, -100, 0, -50); audioChanged = true; }
  if (changes.audioCompKnee) { audioCompKnee = clampNum(changes.audioCompKnee.newValue, 0, 40, 40); audioChanged = true; }
  if (changes.audioCompRatio) { audioCompRatio = clampNum(changes.audioCompRatio.newValue, 1, 20, 12); audioChanged = true; }
  if (changes.audioCompAttack) { audioCompAttack = clampNum(changes.audioCompAttack.newValue, 0, 1, 0); audioChanged = true; }
  if (changes.audioCompRelease) { audioCompRelease = clampNum(changes.audioCompRelease.newValue, 0, 1, 0.25); audioChanged = true; }
  if (changes.audioCompGain) { audioCompGain = clampNum(changes.audioCompGain.newValue, 0, 24, 0); audioChanged = true; }
  if (audioChanged) {
    // Apply immediately; when the user flipped the toggle, also poll briefly and
    // report the real outcome on screen (it may take a moment to engage).
    if (changes.audioComp) announceAudioStatus(0);
    else applyAudioComp();
  }
});

// --- Popup messages --------------------------------------------------------
// The popup messages the whole tab (all frames). To avoid an ad/util iframe
// answering first with the wrong state (e.g. YouTube), only the frame that holds
// the video replies; the top frame replies as a slightly-deferred fallback so a
// video-bearing subframe can win.
function replyFromVideoFrame(sendResponse, build) {
  const hasVid = collectVideos().length > 0;
  const reply = () => { try { sendResponse(build()); } catch (e) {} };
  if (hasVid) { reply(); return true; }
  if (window.top === window) { setTimeout(reply, 60); return true; }
  return false; // subframe without a video stays silent
}

api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "setSpeed") {
    // Every frame applies it; only the video frame answers.
    setSpeed(request.speed, false, true);
    return replyFromVideoFrame(sendResponse,
      () => ({ success: true, speed: currentSpeed, live: onStreamPage() }));
  }
  if (request.action === "rememberSite") {
    const speed = typeof request.speed === "number" ? clamp(request.speed) : currentSpeed;
    persistDomainSpeed(speed);
    sendResponse({ success: true, speed });
    return true;
  }
  if (request.action === "getSpeed") {
    return replyFromVideoFrame(sendResponse,
      () => ({ speed: currentSpeed, domain: getDomain(), live: onStreamPage() }));
  }
  if (request.action === "getMonitor") {
    return replyFromVideoFrame(sendResponse, () => monitorData());
  }
  return false;
});

// Estimated download bitrate (bits/s) of the stream, from the decoder's byte
// counter — unlike Resource Timing, this isn't blocked by cross-origin CDNs.
// Chromium-only (webkitVideoDecodedByteCount); returns null elsewhere (Firefox).
//
// Averaged over a sliding window (total bytes / total time) rather than per-tick,
// so per-segment fetch spikes don't make the number jump around.
const BITRATE_WINDOW = 6000; // ms to average the bitrate over
function streamBitrate(v) {
  if (!v || typeof v.webkitVideoDecodedByteCount !== "number") return null;
  const bytes = v.webkitVideoDecodedByteCount + (v.webkitAudioDecodedByteCount || 0);
  const t = Date.now();
  const s = v._brSamples || (v._brSamples = []);
  // Counter went backwards (seek / source or quality switch) → drop the history.
  if (s.length && bytes < s[s.length - 1].b) s.length = 0;
  s.push({ t, b: bytes });
  while (s.length > 2 && t - s[0].t > BITRATE_WINDOW) s.shift();
  if (s.length < 2) return null;
  const dt = (s[s.length - 1].t - s[0].t) / 1000;
  if (dt < 1) return null; // need ~1s of data before showing a number
  return ((s[s.length - 1].b - s[0].b) * 8) / dt;
}

// Everything the popup graphs need, in one round-trip.
function monitorData() {
  const v = primaryVideo();
  const live = onStreamPage();
  return {
    audio: audioLevels(),
    // The buffer graph only makes sense on live streams (lag behind the edge);
    // on a VOD the buffer is huge and irrelevant, so report nothing.
    buffer: (v && live) ? forwardBuffer(v) : null,
    bitrate: (v && live) ? streamBitrate(v) : null,
    target: liveSyncTarget,
    live,
    hasVideo: !!v,
  };
}

// RMS level (in dBFS, -100…0) of an analyser's current frame.
function analyserDb(an) {
  if (!an._buf) an._buf = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(an._buf);
  let sum = 0;
  for (let i = 0; i < an._buf.length; i++) sum += an._buf[i] * an._buf[i];
  const rms = Math.sqrt(sum / an._buf.length);
  return rms > 0.0000158 ? 20 * Math.log10(rms) : -100; // floor ~ -96 dB
}

// Before/after levels of the primary video's compressor, for the popup meters.
function audioLevels() {
  const v = primaryVideo();
  const g = v && audioGraphs.get(v);
  if (!audioCompEnabled || !g || !g.analyserIn) {
    return { active: false, enabled: audioCompEnabled };
  }
  return {
    active: true,
    enabled: true,
    in: analyserDb(g.analyserIn),
    out: analyserDb(g.analyserOut),
    threshold: audioCompThreshold,
  };
}
