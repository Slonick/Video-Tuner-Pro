// Content script entry. Imported modules register their own listeners/samplers
// as a side effect of being imported.
import { api, ctxValid } from "./platform/browser.js";
import { STORE, OUR_AREAS, whenReady } from "./platform/storage.js";
import { clamp, clampTarget, clampNum } from "./core/clamp.js";
import { getDomain } from "./core/domain.js";
import { resolveSpeed, resolveSyncTarget } from "./core/resolve.js";
import { presetFractions } from "../shared/presets.js";
import { normalizeKeymap } from "../shared/keymap.js";
import { S } from "./state.js";
import { applyAll, reassertRate, resetAudios } from "./speed.js";
import { controlLive } from "./live/sync.js";
import { applyResolvedTargetFromStore } from "./live/target.js";
import { applyAudioComp } from "./audio/compressor.js";
import { engageAudio } from "./audio/status.js";
import { updateTimeBadge, flashBadge, ownsBadgeNode } from "./badge/overlay.js";
import { recordAudioSample, A_HIST_MS } from "./audio/metering.js";
import { recordBufferSample, BUF_HIST_MS } from "./bitrate.js";
import "./messaging.js"; // registers the popup message handler
import "./keyboard.js"; // registers the keyboard-shortcut listener
import "./theater.js"; // applies the YouTube "super theater" layout when enabled
import { currentChannel, channelKeys } from "./channel.js";

let liveTick: ReturnType<typeof setInterval> | null = null;
let audioSampler: ReturnType<typeof setInterval> | null = null;
let bufferSampler: ReturnType<typeof setInterval> | null = null;
let observerScheduled = false;
let lastChannel: string | null = null; // re-resolve speed when the YouTube channel changes

// After an extension reload this script is re-injected into the already-open tab
// (see background/index.ts). A previous instance may have left its on-video badge
// in the DOM — remove it so we don't end up with two. (Removing it is also a DOM
// mutation, which makes the old instance's observer notice the dead context and
// tear itself down.)
try {
  document.querySelectorAll("[data-vtp-badge]").forEach((n) => n.remove());
} catch (e) {
  /* ignore */
}

// The extension context dies on reload/update; shut down cleanly when it does.
// Exported so live.js can call it without a circular value dependency.
export function teardown() {
  if (liveTick) {
    clearInterval(liveTick);
    liveTick = null;
  }
  if (audioSampler) {
    clearInterval(audioSampler);
    audioSampler = null;
  }
  if (bufferSampler) {
    clearInterval(bufferSampler);
    bufferSampler = null;
  }
  try {
    observer.disconnect();
  } catch (e) {
    /* ignore */
  }
}

// Resolve the page's speed by priority: per-channel > per-site > global > 100%.
// Sites/channels with nothing saved (and no global default) stay at 100%.
function applyResolved(
  domains: Record<string, number>,
  channels: Record<string, number>,
  globalSpeed: number | undefined,
): void {
  const keys = channelKeys();
  lastChannel = keys[0] ?? null;
  const r = resolveSpeed(keys, getDomain(), domains, channels, globalSpeed);
  S.userSpeed = clamp(r.speed);
  S.currentSpeed = S.userSpeed;
  S.speedScope = r.scope;
}

function loadSpeed() {
  if (!ctxValid()) return;
  STORE.get(
    [
      "domains",
      "channels",
      "globalSpeed",
      "liveSync",
      "liveSyncTarget",
      "syncTargets",
      "syncTargetChannels",
      "syncTargetGlobal",
      "badgePos",
      "badgePinned",
      "audioComp",
      "audioCompThreshold",
      "audioCompKnee",
      "audioCompRatio",
      "audioCompAttack",
      "audioCompRelease",
      "audioCompGain",
      "showRemaining",
      "streamBadge",
      "audioSpeed",
      "forceRate",
      "keyboard",
      "keymap",
      "speedPresets",
    ],
    (result) => {
      const domains = (result.domains || {}) as Record<string, number>;
      const channels = (result.channels || {}) as Record<string, number>;
      const badgePos = (result.badgePos || {}) as Record<string, { fx: number; fy: number }>;
      S.badgePos = badgePos[getDomain()] || null;
      S.badgePinned = ((result.badgePinned || {}) as Record<string, boolean>)[getDomain()] === true;
      // Defaults-on: features ship enabled; an explicit `false` in storage (the
      // user turned it off) is still respected.
      S.showRemaining = result.showRemaining !== false;
      S.streamBadge = result.streamBadge !== false;
      // Opt-in (default off): explicit `true` required.
      S.audioSpeedEnabled = result.audioSpeed === true;
      S.forceRate = result.forceRate === true;
      S.keyboardEnabled = result.keyboard !== false;
      S.keymap = normalizeKeymap(result.keymap);
      S.presets = presetFractions(result.speedPresets);
      S.liveSyncEnabled = result.liveSync !== false;
      // Allowed delay resolves by scope: channel > site > global > 5s. The legacy
      // `liveSyncTarget` acts as the old global fallback.
      const rt = resolveSyncTarget(
        channelKeys(),
        getDomain(),
        (result.syncTargets || {}) as Record<string, number>,
        (result.syncTargetChannels || {}) as Record<string, number>,
        (result.syncTargetGlobal ?? result.liveSyncTarget) as number | undefined,
      );
      S.targetScope = rt.scope;
      S.liveSyncTarget = clampTarget(rt.target);
      S.audioCompEnabled = result.audioComp !== false;
      S.audioCompThreshold = clampNum(result.audioCompThreshold, -100, 0, -60);
      S.audioCompKnee = clampNum(result.audioCompKnee, 0, 40, 30);
      S.audioCompRatio = clampNum(result.audioCompRatio, 1, 20, 10);
      S.audioCompAttack = clampNum(result.audioCompAttack, 0, 1, 0);
      S.audioCompRelease = clampNum(result.audioCompRelease, 0, 1, 1);
      S.audioCompGain = clampNum(result.audioCompGain, 0, 24, 0);
      applyResolved(domains, channels, result.globalSpeed as number | undefined);
      applyAll();
      // A live stream never inherits a saved speed — sync (or 100%) takes over.
      controlLive();
      updateTimeBadge();
    },
  );
}

// YouTube is an SPA — navigating to another channel's video keeps this script
// alive, so re-resolve when the detected channel changes (the 1s tick drives the
// check; the owner link may render a beat after navigation).
function reresolve() {
  if (!ctxValid()) return;
  STORE.get(["domains", "channels", "globalSpeed"], (r) => {
    applyResolved(
      (r.domains || {}) as Record<string, number>,
      (r.channels || {}) as Record<string, number>,
      r.globalSpeed as number | undefined,
    );
    applyAll();
    controlLive();
    updateTimeBadge();
  });
  applyResolvedTargetFromStore(); // the channel changed — its allowed-delay may differ
}

// Wait for the selective-sync config so the first resolve reads each setting from
// the area it actually lives in (an opted-out category is in local, not sync).
whenReady(loadSpeed);

// Steady background tick: re-apply speed (catches videos created inside shadow
// roots, where document mutations don't fire) and drive live-sync.
liveTick = setInterval(() => {
  if (!ctxValid()) {
    teardown();
    return;
  } // orphaned after a reload — stop the dead instance
  applyAll();
  controlLive();
  updateTimeBadge();
  if (currentChannel() !== lastChannel) reresolve();
}, 1000);

// Background graph samplers (pre-fill the popup's audio/latency graphs). The
// sample bodies live in their modules (unit-tested); only the scheduling lives
// here, in the browser-wired entry point.
audioSampler = setInterval(recordAudioSample, A_HIST_MS);
bufferSampler = setInterval(recordBufferSample, BUF_HIST_MS);

// Apply the speed the moment ANY video starts up — a second player added to the
// page would otherwise wait for the next tick/mutation pass and could begin at
// 1×. Media events don't bubble, but a capture-phase listener still sees them.
for (const ev of ["play", "loadedmetadata"]) {
  document.addEventListener(
    ev,
    (e) => {
      if (!(e.target instanceof HTMLMediaElement)) return;
      if (!ctxValid()) return;
      applyAll();
      controlLive();
      // Surface the badge whenever playback starts (covers autoplay pages where
      // the user never moves the pointer over the video). updateTimeBadge mounts
      // it if needed; flashBadge reveals it and resumes the usual auto-hide.
      if (e.type === "play") {
        updateTimeBadge();
        flashBadge();
      }
    },
    true,
  );
}

// Hard-capture mode (opt-in, default off): swallow the page's ratechange in the
// capture phase so site scripts never see — and can't undo — our speed, then
// re-assert it ourselves (the swallow also pre-empts the per-element reapply
// listeners). Skipped entirely when off, so normal behaviour is unchanged.
document.addEventListener(
  "ratechange",
  (e) => {
    if (!S.forceRate) return;
    const t = e.target;
    if (!(t instanceof HTMLMediaElement)) return;
    if (t instanceof HTMLAudioElement && !S.audioSpeedEnabled) return; // not ours to control
    e.stopImmediatePropagation();
    if (!ctxValid()) return;
    reassertRate(t);
  },
  true,
);

// Watch for videos added later (SPA navigation, lazy players). Chat-heavy pages
// mutate constantly, so coalesce a burst into a single rAF pass — and never re-run
// for our own indicator writes.
const observer = new MutationObserver((mutations) => {
  if (!ctxValid()) {
    teardown();
    return;
  }
  if (observerScheduled) return;
  if (mutations.every((m) => ownsBadgeNode(m.target))) return;
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
  if (!OUR_AREAS.has(area)) return;
  if (changes.liveSync) S.liveSyncEnabled = !!changes.liveSync.newValue;
  // Any allowed-delay scope key changed → re-resolve the chain (also re-runs
  // controlLive). The legacy liveSyncTarget is folded in as the old global.
  if (
    changes.syncTargets ||
    changes.syncTargetChannels ||
    changes.syncTargetGlobal ||
    changes.liveSyncTarget
  ) {
    applyResolvedTargetFromStore();
  } else if (changes.liveSync) {
    controlLive();
  }
  if (changes.showRemaining) {
    S.showRemaining = !!changes.showRemaining.newValue;
    updateTimeBadge();
    flashBadge();
  }
  if (changes.streamBadge) {
    S.streamBadge = !!changes.streamBadge.newValue;
    updateTimeBadge();
    flashBadge();
  }
  if (changes.badgePos) {
    const map =
      (changes.badgePos.newValue as Record<string, { fx: number; fy: number }> | undefined) || {};
    S.badgePos = map[getDomain()] || null;
    updateTimeBadge();
  }
  if (changes.badgePinned) {
    const map = (changes.badgePinned.newValue as Record<string, boolean> | undefined) || {};
    S.badgePinned = map[getDomain()] === true;
    updateTimeBadge(); // re-syncs the pin + forces visibility when pinned
    flashBadge(); // when unpinned, resumes the auto-hide countdown
  }
  if (changes.audioSpeed) {
    S.audioSpeedEnabled = changes.audioSpeed.newValue === true;
    if (S.audioSpeedEnabled) applyAll();
    else resetAudios(); // turned off — hand the <audio> elements back to the page
  }
  if (changes.forceRate) S.forceRate = changes.forceRate.newValue === true;
  if (changes.keyboard) S.keyboardEnabled = !!changes.keyboard.newValue;
  if (changes.keymap) S.keymap = normalizeKeymap(changes.keymap.newValue);
  if (changes.speedPresets) S.presets = presetFractions(changes.speedPresets.newValue);
  let audioChanged = false;
  if (changes.audioComp) {
    S.audioCompEnabled = !!changes.audioComp.newValue;
    audioChanged = true;
  }
  if (changes.audioCompThreshold) {
    S.audioCompThreshold = clampNum(changes.audioCompThreshold.newValue, -100, 0, -60);
    audioChanged = true;
  }
  if (changes.audioCompKnee) {
    S.audioCompKnee = clampNum(changes.audioCompKnee.newValue, 0, 40, 30);
    audioChanged = true;
  }
  if (changes.audioCompRatio) {
    S.audioCompRatio = clampNum(changes.audioCompRatio.newValue, 1, 20, 10);
    audioChanged = true;
  }
  if (changes.audioCompAttack) {
    S.audioCompAttack = clampNum(changes.audioCompAttack.newValue, 0, 1, 0);
    audioChanged = true;
  }
  if (changes.audioCompRelease) {
    S.audioCompRelease = clampNum(changes.audioCompRelease.newValue, 0, 1, 1);
    audioChanged = true;
  }
  if (changes.audioCompGain) {
    S.audioCompGain = clampNum(changes.audioCompGain.newValue, 0, 24, 0);
    audioChanged = true;
  }
  if (audioChanged) {
    // On a toggle flip, retry a few times so it engages even if the video/context
    // wasn't ready; a param tweak just re-applies once.
    if (changes.audioComp) engageAudio(0);
    else applyAudioComp();
  }
});
