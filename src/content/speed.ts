import { clamp } from "./core/clamp.js";
import { getDomain } from "./core/domain.js";
import { resolveSpeed, type SpeedScope } from "./core/resolve.js";
import { channelKeys } from "./channel.js";
import { ctxValid } from "./platform/browser.js";
import { STORE } from "./platform/storage.js";
import { S } from "./state.js";
import { collectVideos, seenVideos } from "./videos.js";
import { isLive, probeLive, onStreamPage, trackDvr, resetDvr } from "./live/detection.js";
import { controlLive } from "./live/sync.js";
import { applyAudioComp } from "./audio/compressor.js";
import { updateBadge } from "./badge/icon.js";
import { updateTimeBadge, flashBadge } from "./badge/overlay.js";

export function persistDomainSpeed(speed: number): void {
  if (!ctxValid()) return;
  // Only the top frame persists the per-site speed. The popup broadcasts
  // "rememberSite" to every frame, and each write is a read-modify-write of the
  // whole `domains` map — so a subframe (e.g. YouTube's accounts.youtube.com
  // login iframe) racing the main frame can clobber the real site's entry.
  if (window.top !== window) return;
  STORE.get(["domains"], (result) => {
    const domains = (result.domains || {}) as Record<string, number>;
    domains[getDomain()] = speed;
    STORE.set({ domains });
  });
}

export function persistChannelSpeed(speed: number): void {
  if (!ctxValid()) return;
  if (window.top !== window) return; // top frame only — same multi-frame write race as persistDomainSpeed
  const keys = channelKeys();
  if (!keys.length) return;
  STORE.get(["channels"], (result) => {
    const channels = (result.channels || {}) as Record<string, number>;
    for (const k of keys) delete channels[k];
    channels[keys[0]] = speed;
    STORE.set({ channels });
  });
}

export function persistGlobalSpeed(speed: number): void {
  if (!ctxValid()) return;
  if (window.top !== window) return; // top frame only — keep parity with the other writers
  STORE.set({ globalSpeed: speed });
}

// Re-resolve the chain (channel > site > global > 100%) from the given maps and
// apply it — dropping any manual in-tab override.
function applyResolvedNow(
  channels: Record<string, number>,
  domains: Record<string, number>,
  globalSpeed: number | undefined,
): void {
  const r = resolveSpeed(channelKeys(), getDomain(), domains, channels, globalSpeed);
  S.speedScope = r.scope;
  setSpeed(clamp(r.speed), false, true);
}

// Reset just the manual change: re-take the saved speed by priority, deleting
// nothing. Backs the R hotkey and the reset button by the readout.
export function resetToSaved(): void {
  if (!ctxValid()) return;
  STORE.get(["channels", "domains", "globalSpeed"], (result) => {
    applyResolvedNow(
      (result.channels || {}) as Record<string, number>,
      (result.domains || {}) as Record<string, number>,
      result.globalSpeed as number | undefined,
    );
  });
}

// Drop the saved speed for one scope (channel/site/global) and re-resolve the
// remaining chain, applying the new speed.
export function resetScope(scope: SpeedScope): void {
  if (!ctxValid()) return;
  STORE.get(["channels", "domains", "globalSpeed"], (result) => {
    const channels = (result.channels || {}) as Record<string, number>;
    const domains = (result.domains || {}) as Record<string, number>;
    let globalSpeed = result.globalSpeed as number | undefined;
    if (scope === "channel") {
      const keys = channelKeys();
      if (!keys.length) return;
      for (const k of keys) delete channels[k];
      STORE.set({ channels });
    } else if (scope === "site") {
      delete domains[getDomain()];
      STORE.set({ domains });
    } else if (scope === "global") {
      globalSpeed = undefined;
      STORE.remove("globalSpeed");
    } else {
      return;
    }
    applyResolvedNow(channels, domains, globalSpeed);
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
      if (Math.abs(video.playbackRate - S.currentSpeed) > 0.001)
        video.playbackRate = S.currentSpeed;
    } catch (e) {
      /* some players reject rate before metadata is ready */
    }
  }

  if (seenVideos.has(video)) return;
  seenVideos.add(video);

  const reapply = () => {
    // On live streams the rate is governed by controlLive's tick; don't fight the
    // player's own latency control here, or the tug-of-war drops frames.
    if (isLive(video)) return;
    if (Math.abs(video.playbackRate - S.currentSpeed) > 0.001) {
      try {
        video.playbackRate = S.currentSpeed;
      } catch (e) {}
    }
  };
  video.addEventListener("play", reapply);
  video.addEventListener("loadeddata", reapply);
  video.addEventListener("ratechange", reapply);

  // Track DVR (scrubbed-back) state first, so the live re-evaluation below sees
  // the fresh value; reset it when new content loads.
  video.addEventListener("seeking", () => trackDvr(video));
  video.addEventListener("timeupdate", () => trackDvr(video));
  video.addEventListener("loadedmetadata", resetDvr);

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
  updateTimeBadge();
  flashBadge(); // the badge flashes the new speed as feedback
}
