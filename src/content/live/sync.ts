// Live-sync catch-up: on a live stream, speed is controlled ONLY here — manual
// speed is never applied. Drives playback toward the live edge and back to 100%.
import { clamp } from "../core/clamp.js";
import { i18n } from "../platform/i18n.js";
import { ctxValid } from "../platform/browser.js";
import { MIN_FORWARD_BUFFER, LIVE_MAX_FLOOR } from "../core/constants.js";
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
function forceLiveNormal(): void {
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
function runLiveSync(video: HTMLVideoElement): void {
  if (video.paused) return;

  const buffer = forwardBuffer(video);
  // Measure how far behind we are by latency-to-broadcaster where the site
  // exposes it (Twitch/YouTube — more accurate than buffered-ahead); otherwise
  // fall back to the buffer. Catching up by latency physically drains the buffer
  // (we play faster than real-time toward the live edge), so the buffer still
  // gates the catch-up as an anti-stall guard.
  const lat = streamLatency();
  const dropped = droppedFramesDelta(video);
  const target = Math.max(S.liveSyncTarget, MIN_FORWARD_BUFFER);
  const rate = clamp(Math.max(LIVE_MAX_FLOOR, S.liveSyncMax)); // fixed catch-up speed

  const desired = decideCatchupSpeed({ currentSpeed: S.currentSpeed, buffer, latency: lat, dropped, target, rate });

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
export function resetSyncAnnounce(): void { lastSyncPct = -1; }
