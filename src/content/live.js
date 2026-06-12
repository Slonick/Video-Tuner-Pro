// Live-stream detection and Live-sync catch-up.
import {
  clamp, i18n, ctxValid,
  MIN_FORWARD_BUFFER, LIVE_MAX_FLOOR, CATCHUP_START, CATCHUP_STOP,
} from "./env.js";
import { S } from "./state.js";
import { collectVideos } from "./videos.js";
import { applyAll } from "./speed.js";
import { showIndicator } from "./badge.js";
import { teardown } from "./index.js";

let lastSyncPct = -1;
let liveSeenAt = 0;     // timestamp of the last live <video> we saw (sticky detection)
let lastDropped = 0;    // dropped-frame counter from the previous tick
let lastControlAt = 0;

// --- Live-stream detection -------------------------------------------------
export function isLive(video) {
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
// Live content can only be fetched at ~1x real time; a VOD exposes its whole
// length immediately and buffers ahead faster than real time. So we sample the
// furthest known media position and call it live when it advances at roughly 1x.
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

export function probeLive(v) {
  if (!v) return;
  const t = Date.now();
  if (v.duration === Infinity) { liveProbe.set(v, { lastEnd: 0, lastT: t, lastGrow: t, live: true }); return; }
  const end = streamEnd(v);
  let s = liveProbe.get(v);
  if (!s) { liveProbe.set(v, { lastEnd: end, lastT: t, lastGrow: 0, hits: 0, live: false }); return; }
  const dT = (t - s.lastT) / 1000;
  if (dT < 0.4) return; // need spacing between samples for a stable rate
  const rate = (end - s.lastEnd) / dT;
  s.lastEnd = end; s.lastT = t;
  // Real-time growth (~1x) = a live edge; VOD is either flat (~0) or bursty (>>1).
  if (rate > 0.3 && rate < 1.7) { s.hits++; if (s.hits >= 3) s.lastGrow = t; }
  else { s.hits = 0; }
  s.live = s.lastGrow > 0 && (t - s.lastGrow) < 8000; // sticky through brief stalls
}

// Seconds of media buffered ahead of the current position. On a live stream the
// player downloads up to the live edge, so this doubles as our lag-behind-live.
export function forwardBuffer(video) {
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
export function liveVideo() {
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
export function onStreamPage() {
  return !!liveVideo() || (Date.now() - liveSeenAt < 6000);
}

// Dispatcher: on a live stream, speed is controlled ONLY here — manual speed is
// never applied to streams. Sync OFF → hold 100%. Sync ON → auto catch-up.
// Throttled: the indicator writes to the DOM, which re-triggers the observer.
export function controlLive() {
  if (!ctxValid()) { teardown(); return; }
  const now = Date.now();
  if (now - lastControlAt < 250) return;
  lastControlAt = now;
  const live = liveVideo();
  if (live) {
    if (S.liveSyncEnabled) runLiveSync(live);
    else forceLiveNormal();
    return;
  }
  // Not a live stream. Wait out the sticky window, then restore the user's
  // intended non-live speed — otherwise a (mistaken) live detection would leave
  // playback stuck at 100%.
  if (onStreamPage()) return;
  if (Math.abs(S.currentSpeed - S.userSpeed) > 0.001) {
    S.currentSpeed = S.userSpeed;
    applyAll();
    showIndicator();
  }
}

// Sync OFF: a live stream always plays at 100% (no manual/inherited speed).
function forceLiveNormal() {
  if (S.currentSpeed !== 1.0) {
    S.currentSpeed = 1.0;
    applyAll();
    showIndicator(i18n("indicatorLive"));
  }
}

// Sync ON: keep the stream within `liveSyncTarget` seconds of the live edge.
// Catch-up runs at ONE fixed rate (liveSyncMax) with hysteresis: we start only
// once clearly behind and stop once back near the target, so the audio stays
// clean (playback rate changes just twice per cycle, no continuous re-pitch).
function runLiveSync(video) {
  if (video.paused) return;

  const lag = forwardBuffer(video);
  const dropped = droppedFramesDelta(video);
  const target = Math.max(S.liveSyncTarget, MIN_FORWARD_BUFFER);
  const rate = clamp(Math.max(LIVE_MAX_FLOOR, S.liveSyncMax)); // fixed catch-up speed

  let desired = S.currentSpeed;
  if (S.currentSpeed > 1.0) {
    // Already catching up — hold until back near the target, or bail if frames drop.
    if (lag <= target + CATCHUP_STOP || dropped > 0) desired = 1.0;
  } else {
    // Normal — start catching up only once we've fallen clearly behind.
    if (lag > target + CATCHUP_START && dropped === 0) desired = rate;
  }

  if (Math.abs(desired - S.currentSpeed) > 0.001) {
    S.currentSpeed = desired;
    applyAll();
  }

  const pct = Math.round(S.currentSpeed * 100);
  if (pct !== lastSyncPct) {
    lastSyncPct = pct;
    showIndicator(pct > 100
      ? i18n("indicatorCatchup", [String(pct)])
      : i18n("indicatorSynced"));
  }
}

// onChanged resets this so the next runLiveSync re-announces immediately.
export function resetSyncAnnounce() { lastSyncPct = -1; }
