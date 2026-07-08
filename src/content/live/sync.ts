// Live-sync catch-up: on a live stream, speed is controlled ONLY here — manual
// speed is never applied. Drives playback toward the live edge and back to 100%.
import { ctxValid } from "../platform/browser.js";
import { MIN_FORWARD_BUFFER, CATCHUP_DWELL_MS } from "../core/constants.js";
import { catchupBufferFloor, decideCatchupSpeed, settleCatchupRate } from "./catchup.js";
import { S } from "../state.js";
import { applyAll } from "../speed.js";
import { teardown } from "../index.js";
import { liveVideo, onStreamPage } from "./detection.js";
import { forwardBuffer, streamLatency } from "./metrics.js";

const droppedFrames = new WeakMap<HTMLVideoElement, number>();
let lastControlAt = 0;
let lastStepAt = 0; // when the applied catch-up step last changed — the dwell anchor
let activeLiveVideo: HTMLVideoElement | null = null;

// Net video frames dropped since the previous call (decoder/network can't keep up).
function droppedFramesDelta(video: HTMLVideoElement): number {
  try {
    const q = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
    const total = q ? q.droppedVideoFrames : 0;
    const previous = droppedFrames.get(video);
    droppedFrames.set(video, total);
    if (previous == null) return 0;
    const delta = total - previous;
    return delta > 0 ? delta : 0;
  } catch (e) {
    return 0;
  }
}

// Pitch stays preserved during catch-up (the gentle ≤125% ramp keeps stretch
// artifacts tolerable; resampling's pitch shift was judged worse). The guard
// also repairs videos a previous build left with preservesPitch=false.
function applyPitchMode(video: HTMLVideoElement): void {
  try {
    if (video.preservesPitch === false) video.preservesPitch = true;
  } catch (e) {
    /* ignore */
  }
}

// A live video's playbackRate is written ONLY here (applyAll skips live
// videos). Immediate when our decision changes; external drift — the site's
// own latency manager nudging the rate — is re-asserted at most once a second,
// so a disagreement costs one click per second instead of one per frame.
let lastRateAssertAt = 0;
let lastRateDecisionAt = 0;
function setLiveRate(video: HTMLVideoElement, rate: number, decisionChanged: boolean): void {
  const now = Date.now();
  if (Math.abs(video.playbackRate - rate) <= 0.001) {
    if (decisionChanged) {
      lastRateAssertAt = now;
      lastRateDecisionAt = now;
    }
    return;
  }
  if (!decisionChanged && now - lastRateAssertAt < 1000) return;
  lastRateAssertAt = now;
  if (decisionChanged) lastRateDecisionAt = now;
  try {
    video.playbackRate = rate;
  } catch (e) {
    /* ignore */
  }
}

// Dispatcher: on a live stream, speed is controlled ONLY here. Sync OFF → hold
// 100%. Sync ON → auto catch-up. Throttled: the indicator writes to the DOM,
// which re-triggers the observer.
export function controlLive(
  snapshot: { live?: HTMLVideoElement | null; onStream?: boolean } = {},
): void {
  if (!ctxValid()) {
    teardown();
    return;
  }
  const now = Date.now();
  if (now - lastControlAt < 250) return;
  lastControlAt = now;
  const live = snapshot.live !== undefined ? snapshot.live : liveVideo();
  if (live !== activeLiveVideo) {
    activeLiveVideo = live;
    lastStepAt = 0;
    lastRateAssertAt = 0;
    lastRateDecisionAt = 0;
  }
  if (live) {
    if (S.liveSyncEnabled) runLiveSync(live);
    else forceLiveNormal(live);
    return;
  }
  // Not a live stream. Wait out the sticky window, then restore the user's
  // intended non-live speed — otherwise a (mistaken) live detection would leave
  // playback stuck at 100%.
  if (snapshot.onStream !== undefined ? snapshot.onStream : onStreamPage()) return;
  if (S.speedManual) return;
  if (Math.abs(S.currentSpeed - S.userSpeed) > 0.001) {
    S.currentSpeed = S.userSpeed;
    applyAll();
  }
}

// Sync OFF: a live stream always plays at 100% (no manual/inherited speed).
function forceLiveNormal(video: HTMLVideoElement): void {
  const changed = S.currentSpeed !== 1.0;
  if (changed) {
    S.currentSpeed = 1.0;
    applyAll();
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
  const target = Math.max(S.liveSyncTarget, MIN_FORWARD_BUFFER);

  const lag = lat != null ? lat : buffer;
  const floor = catchupBufferFloor(lat, target, S.liveSyncBufferReserve);
  const rawDropped = droppedFramesDelta(video);
  let desired = decideCatchupSpeed({
    buffer,
    latency: lat,
    dropped: 0,
    target,
    reserve: S.liveSyncBufferReserve,
  });
  const holdingCatchup = S.currentSpeed > 1 && lag > target && buffer > floor + 0.05;
  let dropped = 0;
  if (desired > 1 || holdingCatchup) {
    // A rate switch itself drops a frame or two, and a bail here causes another
    // switch — reacting to every dropped frame oscillates 100%↔105%+ forever.
    // Ignore drops briefly after the catch-up decision changes and below a real burst.
    dropped = Date.now() - lastRateDecisionAt < 1500 || rawDropped < 3 ? 0 : rawDropped;
    if (dropped > 0) {
      desired = decideCatchupSpeed({
        buffer,
        latency: lat,
        dropped,
        target,
        reserve: S.liveSyncBufferReserve,
      });
    }
  }
  if (
    desired <= 1 &&
    S.currentSpeed > 1 &&
    dropped === 0 &&
    lag > target &&
    buffer > floor + 0.05
  ) {
    desired = Math.min(S.currentSpeed, 1.05);
  } else if (
    lastStepAt > 0 &&
    desired > 1 &&
    desired < S.currentSpeed &&
    dropped === 0 &&
    lag > target &&
    buffer > floor + 0.05
  ) {
    desired = S.currentSpeed;
  }
  const settled = settleCatchupRate(
    desired,
    S.currentSpeed,
    Date.now() - lastStepAt,
    CATCHUP_DWELL_MS,
  );

  const changed = Math.abs(settled - S.currentSpeed) > 0.001;
  if (changed) {
    lastStepAt = Date.now();
    S.currentSpeed = settled;
    applyAll(); // badges/audio everywhere; the live video's rate is set below
  }
  applyPitchMode(video);
  setLiveRate(video, settled, changed);
}
