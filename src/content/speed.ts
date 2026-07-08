import { clamp } from "./core/clamp.js";
import { getDomain } from "./core/domain.js";
import { resolveSpeed, type SpeedScope } from "./core/resolve.js";
import { channelKeys } from "./channel.js";
import { ctxValid } from "./platform/browser.js";
import { STORE } from "./platform/storage.js";
import { S } from "./state.js";
import {
  collectVideos,
  collectAudios,
  primaryVideo,
  primaryVideoFrom,
  seenVideos,
  seenAudios,
} from "./videos.js";
import { isLive, probeLive, onStreamPage, trackDvr, resetDvrFor } from "./live/detection.js";
import { controlLive } from "./live/sync.js";
import { applyAudioComp } from "./audio/compressor.js";
import { updateBadge } from "./badge/icon.js";
import { updateTimeBadge, flashBadge } from "./badge/overlay.js";

type Done = (ok?: boolean) => void;

export function persistDomainSpeed(speed: number, done?: Done): void {
  if (!ctxValid()) {
    done?.(false);
    return;
  }
  // Only the top frame persists the per-site speed. The popup broadcasts
  // "rememberSite" to every frame, and each write is a read-modify-write of the
  // whole `domains` map — so a subframe (e.g. YouTube's accounts.youtube.com
  // login iframe) racing the main frame can clobber the real site's entry.
  if (window.top !== window) {
    done?.(false);
    return;
  }
  STORE.get(["domains"], (result) => {
    const domains = { ...((result.domains || {}) as Record<string, number>) };
    domains[getDomain()] = speed;
    STORE.set({ domains }, done);
  });
}

export function persistChannelSpeed(speed: number, done?: Done): void {
  if (!ctxValid()) {
    done?.(false);
    return;
  }
  if (window.top !== window) {
    done?.(false);
    return;
  } // top frame only — same multi-frame write race as persistDomainSpeed
  const keys = channelKeys();
  if (!keys.length) {
    done?.(false);
    return;
  }
  STORE.get(["channels"], (result) => {
    const channels = { ...((result.channels || {}) as Record<string, number>) };
    for (const k of keys) delete channels[k];
    channels[keys[0]] = speed;
    STORE.set({ channels }, done);
  });
}

export function persistGlobalSpeed(speed: number, done?: Done): void {
  if (!ctxValid()) {
    done?.(false);
    return;
  }
  if (window.top !== window) {
    done?.(false);
    return;
  } // top frame only — keep parity with the other writers
  STORE.set({ globalSpeed: speed }, done);
}

// Re-resolve the chain (channel > site > global > 100%) from the given maps and
// apply it — dropping any manual in-tab override.
function applyResolvedNow(
  channels: Record<string, number>,
  domains: Record<string, number>,
  globalSpeed: number | undefined,
): void {
  const r = resolveSpeed(channelKeys(), getDomain(), domains, channels, globalSpeed);
  const speed = clamp(r.speed);
  S.speedScope = r.scope;
  S.speedManual = false;
  if (activePrimaryIsLive()) {
    S.userSpeed = speed;
    return;
  }
  setSpeed(speed, false, false);
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
export function resetScope(scope: SpeedScope, done?: Done): void {
  if (!ctxValid()) {
    done?.(false);
    return;
  }
  STORE.get(["channels", "domains", "globalSpeed"], (result) => {
    const channels = { ...((result.channels || {}) as Record<string, number>) };
    const domains = { ...((result.domains || {}) as Record<string, number>) };
    let globalSpeed = result.globalSpeed as number | undefined;
    const finish = (ok?: boolean) => {
      if (ok === false) {
        done?.(false);
        return;
      }
      applyResolvedNow(channels, domains, globalSpeed);
      done?.(true);
    };
    if (scope === "channel") {
      const keys = channelKeys();
      if (!keys.length) {
        done?.(false);
        return;
      }
      for (const k of keys) delete channels[k];
      if (Object.keys(channels).length) STORE.set({ channels }, finish);
      else STORE.remove("channels", finish);
    } else if (scope === "site") {
      delete domains[getDomain()];
      if (Object.keys(domains).length) STORE.set({ domains }, finish);
      else STORE.remove("domains", finish);
    } else if (scope === "global") {
      globalSpeed = undefined;
      STORE.remove("globalSpeed", finish);
    } else {
      done?.(false);
      return;
    }
  });
}

// Apply the current speed to one media element. Keeps pitch natural and seeds
// defaultPlaybackRate so a freshly-loaded source starts at the right rate (no 1×
// flash before the reactive re-apply). Only writes playbackRate when it actually
// differs — applyAll runs often (1s tick + every MutationObserver pass), and a
// redundant write restarts the audio time-stretcher and glitches sound.
function speedWithAutoSlow(base: number): number {
  return S.autoSlowEnabled ? base * S.autoSlowFactor : base;
}

function setMediaRate(media: HTMLMediaElement, baseSpeed = S.currentSpeed): void {
  // The applied rate is the user's speed scaled by the auto-slow factor (1 when
  // the feature is off or no dense speech is detected). defaultPlaybackRate stays
  // at the *intended* speed so a freshly-loaded source isn't seeded at a
  // momentarily-slowed rate.
  const eff = speedWithAutoSlow(baseSpeed);
  try {
    if (media.preservesPitch === false) media.preservesPitch = true;
    if (Math.abs(media.defaultPlaybackRate - baseSpeed) > 0.001)
      media.defaultPlaybackRate = baseSpeed;
    if (Math.abs(media.playbackRate - eff) > 0.001) media.playbackRate = eff;
  } catch (e) {
    /* some players reject rate before metadata is ready */
  }
}

function activePrimaryIsLive(): boolean {
  const v = primaryVideo();
  return v ? isLive(v) : onStreamPage();
}

function setNonLiveVideoRate(video: HTMLVideoElement, primaryLive = activePrimaryIsLive()): void {
  setMediaRate(video, primaryLive ? S.userSpeed : S.currentSpeed);
}

// The speed actually written to playbackRate: the user's speed times the live
// auto-slow factor. Ignored entirely when the feature is off.
export function effectiveSpeed(): number {
  return speedWithAutoSlow(S.currentSpeed);
}

// Re-assert the effective rate on the primary video right now — the autoslow
// sampler calls this when the factor moves, so a slowdown takes effect without
// waiting for the next 1s tick.
export function reapplyPrimaryRate(): void {
  const v = primaryVideo();
  if (v && !isLive(v)) setNonLiveVideoRate(v);
}

// Re-assert our rate on a single element. Backs the hard-capture handler
// (index.ts), which swallows the page's ratechange before the per-element
// listeners below can fire, so it has to re-apply here. Live videos are owned by
// controlLive; audios only when the opt-in toggle is on.
export function reassertRate(media: HTMLMediaElement): void {
  if (media instanceof HTMLVideoElement) {
    if (isLive(media)) return;
    setNonLiveVideoRate(media);
  } else if (S.audioSpeedEnabled) {
    setMediaRate(media);
  }
}

function applyToVideo(video: HTMLVideoElement, primaryLive: boolean): void {
  // A live video's rate is owned by controlLive (live/sync.ts). applyAll runs
  // per mutation pass (≈frame rate on chat-heavy pages), so countering the
  // player's own rate writes here flips the rate twice within a frame — every
  // flip restarts the audio time-stretcher with an audible click.
  if (!isLive(video)) setNonLiveVideoRate(video, primaryLive);

  if (seenVideos.has(video)) return;
  seenVideos.add(video);

  const reapply = () => {
    // On live streams the rate is governed by controlLive's tick; don't fight the
    // player's own latency control here, or the tug-of-war drops frames.
    if (isLive(video)) return;
    setNonLiveVideoRate(video);
  };
  video.addEventListener("play", reapply);
  video.addEventListener("loadeddata", reapply);
  video.addEventListener("ratechange", reapply);

  // Track DVR (scrubbed-back) state first, so the live re-evaluation below sees
  // the fresh value; reset it when new content loads.
  video.addEventListener("seeking", () => trackDvr(video));
  video.addEventListener("timeupdate", () => trackDvr(video));
  video.addEventListener("loadedmetadata", () => resetDvrFor(video));

  // Re-evaluate live state as the stream loads and as playback progresses.
  const reevaluateLive = () => controlLive();
  video.addEventListener("durationchange", reevaluateLive);
  video.addEventListener("loadedmetadata", reevaluateLive);
  video.addEventListener("timeupdate", reevaluateLive);
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

export function applyAll(
  snapshot: { videos?: HTMLVideoElement[]; primaryLive?: boolean } = {},
): void {
  const videos = snapshot.videos ?? collectVideos();
  const primaryLive =
    snapshot.primaryLive !== undefined
      ? snapshot.primaryLive
      : videos.length
        ? activePrimaryIsLive()
        : false;
  const primary = primaryVideoFrom(videos);
  videos.forEach((v) => applyToVideo(v, primaryLive));
  videos.forEach(probeLive); // sample media edge for generic live detection
  applyAudioComp(videos, primary);
  if (S.audioSpeedEnabled) collectAudios().forEach(applyToAudio);
  publishAudioRate(); // keep the MAIN-world bridge in step with the toggle + speed
  updateBadge();
}

export function setSpeed(speed: number, persist?: boolean, manual?: boolean): void {
  // Streams ignore manual speed entirely — they're governed by Live-sync.
  if (manual && activePrimaryIsLive()) return;
  S.currentSpeed = clamp(speed);
  S.userSpeed = S.currentSpeed; // remember it as the intended non-live speed
  if (manual) S.speedManual = true;
  applyAll();
  if (persist) persistDomainSpeed(S.currentSpeed);
  updateTimeBadge();
  flashBadge(); // the badge flashes the new speed as feedback
}
