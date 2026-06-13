// Live-sync catch-up: on a live stream, speed is controlled ONLY here — manual
// speed is never applied. Drives playback toward the live edge and back to 100%.
import { i18n } from "../platform/i18n.js";
import { ctxValid } from "../platform/browser.js";
import { MIN_FORWARD_BUFFER } from "../core/constants.js";
import { decideCatchupSpeed } from "./catchup.js";
import { S } from "../state.js";
import { applyAll } from "../speed.js";
import { showIndicator } from "../badge/indicator.js";
import { teardown } from "../index.js";
import { liveVideo, onStreamPage } from "./detection.js";
import { forwardBuffer, streamLatency } from "./metrics.js";

let lastSyncPct = -1;
let lastDropped = 0;    // dropped-frame counter from the previous tick
let lastControlAt = 0;

// Net video frames dropped since the previous call (decoder/network can't keep up).
function droppedFramesDelta(video: HTMLVideoElement): number {
  try {
    const q = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    const total = q ? q.droppedVideoFrames : 0;
    const delta = total - lastDropped;
    lastDropped = total;
    return delta > 0 ? delta : 0;
  } catch (e) { return 0; }
}

// Pitch stays preserved during catch-up (the gentle ≤125% ramp keeps stretch
// artifacts tolerable; resampling's pitch shift was judged worse). The guard
// also repairs videos a previous build left with preservesPitch=false.
function applyPitchMode(video: HTMLVideoElement): void {
  try {
    if (video.preservesPitch === false) video.preservesPitch = true;
  } catch (e) { /* ignore */ }
}

// A live video's playbackRate is written ONLY here (applyAll skips live
// videos). Immediate when our decision changes; external drift — the site's
// own latency manager nudging the rate — is re-asserted at most once a second,
// so a disagreement costs one click per second instead of one per frame.
let lastRateAssertAt = 0;
function setLiveRate(video: HTMLVideoElement, rate: number, decisionChanged: boolean): void {
  if (Math.abs(video.playbackRate - rate) <= 0.001) return;
  const now = Date.now();
  if (!decisionChanged && now - lastRateAssertAt < 1000) return;
  lastRateAssertAt = now;
  try { video.playbackRate = rate; } catch (e) { /* ignore */ }
}

// Dispatcher: on a live stream, speed is controlled ONLY here. Sync OFF → hold
// 100%. Sync ON → auto catch-up. Throttled: the indicator writes to the DOM,
// which re-triggers the observer.
export function controlLive(): void {
  if (!ctxValid()) { teardown(); return; }
  const now = Date.now();
  if (now - lastControlAt < 250) return;
  lastControlAt = now;
  const live = liveVideo();
  if (live) {
    if (S.liveSyncEnabled) runLiveSync(live);
    else forceLiveNormal(live);
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
function forceLiveNormal(video: HTMLVideoElement): void {
  const changed = S.currentSpeed !== 1.0;
  if (changed) {
    S.currentSpeed = 1.0;
    applyAll();
    showIndicator(i18n("indicatorLive"));
  }
  applyPitchMode(video);
  setLiveRate(video, 1.0, changed);
}

// Sync ON: keep the stream within `liveSyncTarget` seconds of the live edge.
// The rate ramps with the lag (decideCatchupSpeed) — the closer to the target,
// the slower — so catching up fades out instead of snapping on/off.
function runLiveSync(video: HTMLVideoElement): void {
  if (video.paused) return;

  const buffer = forwardBuffer(video);
  // Measure how far behind we are by latency-to-broadcaster where the site
  // exposes it (Twitch/YouTube — more accurate than buffered-ahead); otherwise
  // fall back to the buffer. Catching up by latency physically drains the buffer
  // (we play faster than real-time toward the live edge), so the buffer still
  // gates the catch-up as an anti-stall guard.
  const lat = streamLatency();
  // A rate switch itself drops a frame or two, and a bail here causes another
  // switch — reacting to every dropped frame oscillates 100%↔105%+ forever.
  // Ignore drops briefly after our own rate writes and below a real burst.
  const rawDropped = droppedFramesDelta(video);
  const dropped = (Date.now() - lastRateAssertAt < 1500 || rawDropped < 3) ? 0 : rawDropped;
  const target = Math.max(S.liveSyncTarget, MIN_FORWARD_BUFFER);

  const desired = decideCatchupSpeed({ buffer, latency: lat, dropped, target });

  const changed = Math.abs(desired - S.currentSpeed) > 0.001;
  if (changed) {
    S.currentSpeed = desired;
    applyAll(); // badges/audio everywhere; the live video's rate is set below
  }
  applyPitchMode(video);
  setLiveRate(video, desired, changed);

  const pct = Math.round(S.currentSpeed * 100);
  if (pct !== lastSyncPct) {
    lastSyncPct = pct;
    showIndicator(pct > 100
      ? i18n("indicatorCatchup", [String(pct)])
      : i18n("indicatorSynced"));
  }
}

// onChanged resets this so the next runLiveSync re-announces immediately.
export function resetSyncAnnounce(): void { lastSyncPct = -1; }
