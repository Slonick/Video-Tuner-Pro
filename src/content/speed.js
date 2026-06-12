// Applying the playback speed to the page's videos and persisting per-site speed.
import { clamp, ctxValid, getDomain, STORE } from "./env.js";
import { S } from "./state.js";
import { collectVideos, seenVideos } from "./videos.js";
import { isLive, probeLive, controlLive, onStreamPage } from "./live.js";
import { applyAudioComp } from "./audio.js";
import { updateBadge, showIndicator, updateTimeBadge, flashBadge } from "./badge.js";

export function persistDomainSpeed(speed) {
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
    // MutationObserver pass). Re-assigning playbackRate each time restarts the
    // audio time-stretcher and glitches sound during sped-up playback.
    if (Math.abs(video.playbackRate - S.currentSpeed) > 0.001) video.playbackRate = S.currentSpeed;
  } catch (e) { /* some players reject rate before metadata is ready */ }

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

export function applyAll() {
  const videos = collectVideos();
  videos.forEach(applyToVideo);
  videos.forEach(probeLive); // sample media edge for generic live detection
  applyAudioComp(videos);
  updateBadge();
}

export function setSpeed(speed, persist, manual) {
  // Streams ignore manual speed entirely — they're governed by Live-sync.
  if (manual && onStreamPage()) return;
  S.currentSpeed = clamp(speed);
  S.userSpeed = S.currentSpeed; // remember it as the intended non-live speed
  applyAll();
  if (persist) persistDomainSpeed(S.currentSpeed);
  showIndicator();
  updateTimeBadge(); flashBadge();
}
