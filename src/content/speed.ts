import { clamp } from "./core/clamp.js";
import { getDomain } from "./core/domain.js";
import { currentChannel } from "./channel.js";
import { ctxValid } from "./platform/browser.js";
import { STORE } from "./platform/storage.js";
import { S } from "./state.js";
import { collectVideos, seenVideos } from "./videos.js";
import { isLive, probeLive, onStreamPage } from "./live/detection.js";
import { controlLive } from "./live/sync.js";
import { applyAudioComp } from "./audio/compressor.js";
import { updateBadge } from "./badge/icon.js";
import { showIndicator } from "./badge/indicator.js";
import { updateTimeBadge, flashBadge } from "./badge/overlay.js";

export function persistDomainSpeed(speed: number): void {
  if (!ctxValid()) return;
  STORE.get(["domains"], (result) => {
    const domains = (result.domains || {}) as Record<string, number>;
    domains[getDomain()] = speed;
    STORE.set({ domains });
  });
}

export function persistChannelSpeed(speed: number): void {
  if (!ctxValid()) return;
  const ch = currentChannel();
  if (!ch) return;
  STORE.get(["channels"], (result) => {
    const channels = (result.channels || {}) as Record<string, number>;
    channels[ch] = speed;
    STORE.set({ channels });
  });
}

// Drop this channel's saved speed and fall back to the per-domain one (or 100%).
export function resetChannelSpeed(): void {
  if (!ctxValid()) return;
  const ch = currentChannel();
  if (!ch) return;
  STORE.get(["channels", "domains"], (result) => {
    const channels = (result.channels || {}) as Record<string, number>;
    delete channels[ch];
    STORE.set({ channels });
    const domains = (result.domains || {}) as Record<string, number>;
    const fallback = domains[getDomain()];
    setSpeed(clamp(fallback != null ? fallback : 1.0), false, true);
  });
}

function applyToVideo(video: HTMLVideoElement): void {
  // A live video's rate is owned by controlLive (live/sync.ts). applyAll runs
  // per mutation pass (≈frame rate on chat-heavy pages), so countering the
  // player's own rate writes here flips the rate twice within a frame — every
  // flip restarts the audio time-stretcher with an audible click.
  if (!isLive(video)) {
    try {
      // Only set when it actually differs — applyAll runs often (1s tick + every
      // MutationObserver pass). Re-assigning playbackRate each time restarts the
      // audio time-stretcher and glitches sound during sped-up playback.
      if (Math.abs(video.playbackRate - S.currentSpeed) > 0.001) video.playbackRate = S.currentSpeed;
    } catch (e) { /* some players reject rate before metadata is ready */ }
  }

  if (seenVideos.has(video)) return;
  seenVideos.add(video);

  const reapply = () => {
    // On live streams the rate is governed by controlLive's tick; don't fight the
    // player's own latency control here, or the tug-of-war drops frames.
    if (isLive(video)) return;
    if (Math.abs(video.playbackRate - S.currentSpeed) > 0.001) {
      try { video.playbackRate = S.currentSpeed; } catch (e) {}
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

export function applyAll(): void {
  const videos = collectVideos();
  videos.forEach(applyToVideo);
  videos.forEach(probeLive); // sample media edge for generic live detection
  applyAudioComp(videos);
  updateBadge();
}

export function setSpeed(speed: number, persist?: boolean, manual?: boolean): void {
  // Streams ignore manual speed entirely — they're governed by Live-sync.
  if (manual && onStreamPage()) return;
  S.currentSpeed = clamp(speed);
  S.userSpeed = S.currentSpeed; // remember it as the intended non-live speed
  applyAll();
  if (persist) persistDomainSpeed(S.currentSpeed);
  showIndicator();
  updateTimeBadge(); flashBadge();
}
