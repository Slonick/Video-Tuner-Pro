// Content script entry. Imported modules register their own listeners/samplers
// as a side effect of being imported.
import { api, ctxValid } from "./platform/browser.js";
import { STORE, STORE_AREA } from "./platform/storage.js";
import { clamp, clampTarget, clampNum } from "./core/clamp.js";
import { getDomain } from "./core/domain.js";
import { S } from "./state.js";
import { applyAll } from "./speed.js";
import { controlLive, resetSyncAnnounce } from "./live/sync.js";
import { applyAudioComp } from "./audio/compressor.js";
import { announceAudioStatus } from "./audio/status.js";
import { updateTimeBadge, flashBadge } from "./badge/overlay.js";
import { ownsNode } from "./badge/indicator.js";
import "./messaging.js"; // registers the popup message handler (pulls in the bitrate sampler)
import "./keyboard.js";  // registers the keyboard-shortcut listener
import { currentChannel } from "./channel.js";

let liveTick: ReturnType<typeof setInterval> | null = null;
let observerScheduled = false;
let lastChannel: string | null = null;   // re-resolve speed when the YouTube channel changes

// The extension context dies on reload/update; shut down cleanly when it does.
// Exported so live.js can call it without a circular value dependency.
export function teardown() {
  if (liveTick) { clearInterval(liveTick); liveTick = null; }
  try { observer.disconnect(); } catch (e) { /* ignore */ }
}

// Resolve the page's speed: a per-channel speed wins over the per-domain one,
// else 100%. Sites/channels the user never remembered stay at 100%.
function applyResolved(domains: Record<string, number>, channels: Record<string, number>): void {
  const ch = currentChannel();
  lastChannel = ch;
  const saved = (ch && channels[ch] != null) ? channels[ch] : domains[getDomain()];
  S.userSpeed = clamp(saved != null ? saved : 1.0);
  S.currentSpeed = S.userSpeed;
}

function loadSpeed() {
  if (!ctxValid()) return;
  STORE.get(
    ["domains", "channels", "liveSync", "liveSyncTarget",
     "audioComp", "audioCompThreshold", "audioCompKnee", "audioCompRatio",
     "audioCompAttack", "audioCompRelease", "audioCompGain", "showRemaining", "streamBadge", "keyboard"],
    (result) => {
      const domains = (result.domains || {}) as Record<string, number>;
      const channels = (result.channels || {}) as Record<string, number>;
      // Defaults-on: features ship enabled; an explicit `false` in storage (the
      // user turned it off) is still respected.
      S.showRemaining = result.showRemaining !== false;
      S.streamBadge = result.streamBadge !== false;
      S.keyboardEnabled = result.keyboard !== false;
      S.liveSyncEnabled = result.liveSync !== false;
      S.liveSyncTarget = clampTarget(result.liveSyncTarget != null ? result.liveSyncTarget : 5);
      S.audioCompEnabled = result.audioComp !== false;
      S.audioCompThreshold = clampNum(result.audioCompThreshold, -100, 0, -60);
      S.audioCompKnee = clampNum(result.audioCompKnee, 0, 40, 30);
      S.audioCompRatio = clampNum(result.audioCompRatio, 1, 20, 10);
      S.audioCompAttack = clampNum(result.audioCompAttack, 0, 1, 0);
      S.audioCompRelease = clampNum(result.audioCompRelease, 0, 1, 1);
      S.audioCompGain = clampNum(result.audioCompGain, 0, 24, 10);
      applyResolved(domains, channels);
      applyAll();
      // A live stream never inherits a saved speed — sync (or 100%) takes over.
      controlLive();
      updateTimeBadge();
    }
  );
}

// YouTube is an SPA — navigating to another channel's video keeps this script
// alive, so re-resolve when the detected channel changes (the 1s tick drives the
// check; the owner link may render a beat after navigation).
function reresolve() {
  if (!ctxValid()) return;
  STORE.get(["domains", "channels"], (r) => {
    applyResolved((r.domains || {}) as Record<string, number>, (r.channels || {}) as Record<string, number>);
    applyAll();
    controlLive();
    updateTimeBadge();
  });
}

loadSpeed();

// Steady background tick: re-apply speed (catches videos created inside shadow
// roots, where document mutations don't fire) and drive live-sync.
liveTick = setInterval(() => {
  applyAll(); controlLive(); updateTimeBadge();
  if (currentChannel() !== lastChannel) reresolve();
}, 1000);

// Apply the speed the moment ANY video starts up — a second player added to the
// page would otherwise wait for the next tick/mutation pass and could begin at
// 1×. Media events don't bubble, but a capture-phase listener still sees them.
for (const ev of ["play", "loadedmetadata"]) {
  document.addEventListener(ev, (e) => {
    if (!(e.target instanceof HTMLVideoElement)) return;
    if (!ctxValid()) return;
    applyAll();
    controlLive();
  }, true);
}

// Watch for videos added later (SPA navigation, lazy players). Chat-heavy pages
// mutate constantly, so coalesce a burst into a single rAF pass — and never re-run
// for our own indicator writes.
const observer = new MutationObserver((mutations) => {
  if (!ctxValid()) { teardown(); return; }
  if (observerScheduled) return;
  if (mutations.every((m) => ownsNode(m.target))) return;
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
  if (area !== STORE_AREA) return;
  if (changes.liveSync) S.liveSyncEnabled = !!changes.liveSync.newValue;
  if (changes.liveSyncTarget) S.liveSyncTarget = clampTarget(changes.liveSyncTarget.newValue);
  if (changes.liveSync || changes.liveSyncTarget) {
    resetSyncAnnounce();
    controlLive();
  }
  if (changes.showRemaining) { S.showRemaining = !!changes.showRemaining.newValue; updateTimeBadge(); flashBadge(); }
  if (changes.streamBadge) { S.streamBadge = !!changes.streamBadge.newValue; updateTimeBadge(); flashBadge(); }
  if (changes.keyboard) S.keyboardEnabled = !!changes.keyboard.newValue;
  let audioChanged = false;
  if (changes.audioComp) { S.audioCompEnabled = !!changes.audioComp.newValue; audioChanged = true; }
  if (changes.audioCompThreshold) { S.audioCompThreshold = clampNum(changes.audioCompThreshold.newValue, -100, 0, -60); audioChanged = true; }
  if (changes.audioCompKnee) { S.audioCompKnee = clampNum(changes.audioCompKnee.newValue, 0, 40, 30); audioChanged = true; }
  if (changes.audioCompRatio) { S.audioCompRatio = clampNum(changes.audioCompRatio.newValue, 1, 20, 10); audioChanged = true; }
  if (changes.audioCompAttack) { S.audioCompAttack = clampNum(changes.audioCompAttack.newValue, 0, 1, 0); audioChanged = true; }
  if (changes.audioCompRelease) { S.audioCompRelease = clampNum(changes.audioCompRelease.newValue, 0, 1, 1); audioChanged = true; }
  if (changes.audioCompGain) { S.audioCompGain = clampNum(changes.audioCompGain.newValue, 0, 24, 0); audioChanged = true; }
  if (audioChanged) {
    // Apply immediately; when the user flipped the toggle, also poll briefly and
    // report the real outcome on screen (it may take a moment to engage).
    if (changes.audioComp) announceAudioStatus(0);
    else applyAudioComp();
  }
});
