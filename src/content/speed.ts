import { clamp } from "./core/clamp.js";
import { getDomain } from "./core/domain.js";
import { resolveSpeed, type SpeedScope } from "./core/resolve.js";
import { channelKeys } from "./channel.js";
import { ctxValid } from "./platform/browser.js";
import { STORE } from "./platform/storage.js";
import { S } from "./state.js";
import { collectVideos, collectAudios, seenVideos, seenAudios } from "./videos.js";
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

// Apply the current speed to one media element. Keeps pitch natural and seeds
// defaultPlaybackRate so a freshly-loaded source starts at the right rate (no 1×
// flash before the reactive re-apply). Only writes playbackRate when it actually
// differs — applyAll runs often (1s tick + every MutationObserver pass), and a
// redundant write restarts the audio time-stretcher and glitches sound.
function setMediaRate(media: HTMLMediaElement): void {
  try {
    if (media.preservesPitch === false) media.preservesPitch = true;
    if (Math.abs(media.defaultPlaybackRate - S.currentSpeed) > 0.001)
      media.defaultPlaybackRate = S.currentSpeed;
    if (Math.abs(media.playbackRate - S.currentSpeed) > 0.001) media.playbackRate = S.currentSpeed;
  } catch (e) {
    /* some players reject rate before metadata is ready */
  }
}

// Re-assert our rate on a single element. Backs the hard-capture handler
// (index.ts), which swallows the page's ratechange before the per-element
// listeners below can fire, so it has to re-apply here. Live videos are owned by
// controlLive; audios only when the opt-in toggle is on.
export function reassertRate(media: HTMLMediaElement): void {
  if (media instanceof HTMLVideoElement) {
    if (isLive(media)) return;
    setMediaRate(media);
  } else if (S.audioSpeedEnabled) {
    setMediaRate(media);
  }
}

function applyToVideo(video: HTMLVideoElement): void {
  // A live video's rate is owned by controlLive (live/sync.ts). applyAll runs
  // per mutation pass (≈frame rate on chat-heavy pages), so countering the
  // player's own rate writes here flips the rate twice within a frame — every
  // flip restarts the audio time-stretcher with an audible click.
  if (!isLive(video)) setMediaRate(video);

  if (seenVideos.has(video)) return;
  seenVideos.add(video);

  const reapply = () => {
    // On live streams the rate is governed by controlLive's tick; don't fight the
    // player's own latency control here, or the tug-of-war drops frames.
    if (isLive(video)) return;
    setMediaRate(video);
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

// <audio> never gets a badge, live-sync, or the compressor — just the rate.
function applyToAudio(audio: HTMLAudioElement): void {
  setMediaRate(audio);
  if (seenAudios.has(audio)) return;
  seenAudios.add(audio);
  const reapply = () => setMediaRate(audio);
  audio.addEventListener("play", reapply);
  audio.addEventListener("loadeddata", reapply);
  audio.addEventListener("ratechange", reapply);
}

// Bridge the desired audio rate to the MAIN-world hook (audio-inject.ts), which
// owns detached media (e.g. SoundCloud's `new Audio()`) the isolated world can't
// reach. Present only while the toggle is on; its removal tells the page world to
// hand those elements back at 1×. Written only on an actual change so the page-
// world attribute observer doesn't churn on every tick.
const AUDIO_RATE_ATTR = "data-vtp-audiorate";
function publishAudioRate(): void {
  try {
    const root = document.documentElement;
    if (!root) return;
    if (S.audioSpeedEnabled) {
      const v = String(S.currentSpeed);
      if (root.getAttribute(AUDIO_RATE_ATTR) !== v) root.setAttribute(AUDIO_RATE_ATTR, v);
    } else if (root.hasAttribute(AUDIO_RATE_ATTR)) {
      root.removeAttribute(AUDIO_RATE_ATTR);
    }
  } catch (e) {
    /* ignore */
  }
}

// Reset every <audio> back to normal speed — used when the toggle is turned off.
export function resetAudios(): void {
  for (const a of collectAudios()) {
    try {
      a.defaultPlaybackRate = 1;
      a.playbackRate = 1;
    } catch (e) {}
  }
  publishAudioRate(); // toggle is off now — clear the bridge so the page world resets too
}

export function applyAll(): void {
  const videos = collectVideos();
  videos.forEach(applyToVideo);
  videos.forEach(probeLive); // sample media edge for generic live detection
  applyAudioComp(videos);
  if (S.audioSpeedEnabled) collectAudios().forEach(applyToAudio);
  publishAudioRate(); // keep the MAIN-world bridge in step with the toggle + speed
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
