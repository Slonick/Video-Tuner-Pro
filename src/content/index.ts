// Content script entry. Imported modules register their own listeners/samplers
// as a side effect of being imported.
import { api, ctxValid } from "./platform/browser.js";
import { STORE, OUR_AREAS, whenReady } from "./platform/storage.js";
import { clamp, clampTarget } from "./core/clamp.js";
import { getDomain } from "./core/domain.js";
import {
  resolveSpeed,
  resolveSyncTarget,
  resolveAutoSlow,
  type AutoSlowSettings,
} from "./core/resolve.js";
import { normalizePresetSet } from "../shared/presets.js";
import { S } from "./state.js";
import { applyAll, reassertRate } from "./speed.js";
import { controlLive } from "./live/sync.js";
import { applyResolvedTargetFromStore } from "./live/target.js";
import { applyAudioComp } from "./audio/compressor.js";
import { engageAudio } from "./audio/status.js";
import { updateTimeBadge, flashBadge, ownsBadgeNode } from "./badge/overlay.js";
import { updateLauncher, ownsLauncherNode } from "./overlay/launcher.js";
import { REGISTRY_KEYS, loadRegistry, applyRegistryChanges } from "./settings/registry.js";
import { recordAudioSample, A_HIST_MS } from "./audio/metering.js";
import { autoSlowSample, AUTOSLOW_MS } from "./audio/autoslow.js";
import { applyResolvedAutoSlowFromStore } from "./audio/autoslow-config.js";
import { recordBufferSample, BUF_HIST_MS } from "./bitrate.js";
import { collectVideos, startTracking, stopTracking, reconcile } from "./videos.js";
import "./messaging.js"; // registers the popup message handler
import "./keyboard.js"; // registers the keyboard-shortcut listener
import "./theater.js"; // applies the YouTube "super theater" layout when enabled
import { currentChannel, channelKeys } from "./channel.js";

let liveTick: ReturnType<typeof setTimeout> | null = null;
let audioSampler: ReturnType<typeof setInterval> | null = null;
let bufferSampler: ReturnType<typeof setInterval> | null = null;
let autoSlowSampler: ReturnType<typeof setInterval> | null = null;
let observerScheduled = false;
let lastChannel: string | null = null; // re-resolve speed when the YouTube channel changes

// Background-tick cadence: 1s while the page has a video, backing off toward 5s on
// pages with none so idle tabs stop walking the DOM every second. Media events and
// the tab regaining focus snap it back to TICK_MIN.
const TICK_MIN = 1000;
const TICK_MAX = 5000;
let tickInterval = TICK_MIN;

// reconcile() is a full shadow-piercing walk; the observer already tracks media
// incrementally, so this only needs to run as a rare backstop (the one case the
// observer can't see: a shadow root attached to an already-present element).
const RECONCILE_MS = 8000;
let lastReconcileAt = 0;

// After an extension reload this script is re-injected into the already-open tab
// (see background/index.ts). A previous instance may have left its on-video badge
// in the DOM — remove it so we don't end up with two. (Removing it is also a DOM
// mutation, which makes the old instance's observer notice the dead context and
// tear itself down.)
try {
  document.querySelectorAll("[data-vtp-badge],[data-vtp-launcher]").forEach((n) => n.remove());
} catch (e) {
  /* ignore */
}

// Stop every recurring timer (background tick + graph samplers). Used both on
// teardown and when the tab goes to the background.
function stopTimers() {
  if (liveTick != null) {
    clearTimeout(liveTick);
    liveTick = null;
  }
  if (audioSampler != null) {
    clearInterval(audioSampler);
    audioSampler = null;
  }
  if (bufferSampler != null) {
    clearInterval(bufferSampler);
    bufferSampler = null;
  }
  if (autoSlowSampler != null) {
    clearInterval(autoSlowSampler);
    autoSlowSampler = null;
  }
}

// The extension context dies on reload/update; shut down cleanly when it does.
// Exported so live.js can call it without a circular value dependency.
export function teardown() {
  stopTimers();
  stopTracking(); // disconnects the media-registry observer
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
      // Bespoke keys: cross-scope resolution (speed / sync target / auto-slow
      // bundle), paired presets, and per-domain maps. The simple scalars/flags
      // come from the settings registry.
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
      "overlayBtnPos",
      "overlayPanelPos",
      "autoSlowSites",
      "autoSlowChannels",
      "autoSlowGlobal",
      "speedPresets",
      "presetKeys",
      ...REGISTRY_KEYS,
    ],
    (result) => {
      const domains = (result.domains || {}) as Record<string, number>;
      const channels = (result.channels || {}) as Record<string, number>;
      const badgePos = (result.badgePos || {}) as Record<string, { fx: number; fy: number }>;
      S.badgePos = badgePos[getDomain()] || null;
      S.badgePinned = ((result.badgePinned || {}) as Record<string, boolean>)[getDomain()] === true;
      const overlayBtnPos = (result.overlayBtnPos || {}) as Record<
        string,
        { fx: number; fy: number }
      >;
      S.overlayBtnPos = overlayBtnPos[getDomain()] || null;
      S.overlayPanelPos =
        ((result.overlayPanelPos || {}) as Record<string, { fx: number; fy: number }>)[
          getDomain()
        ] || null;
      // Simple scalars/flags (badge toggles, keyboard, steps, overlay button, audio
      // compressor params, auto-slow dynamics) load from the registry in one pass.
      loadRegistry(result);
      const ps = normalizePresetSet(result.speedPresets, result.presetKeys);
      S.presets = ps.presets.map((p) => p / 100);
      S.presetKeys = ps.keys;
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
      // Auto-slow: the target resolves by scope (one bundle per scope). The master
      // enable is a GLOBAL flag (loaded by the registry above), not per-scope; the
      // floor and response dynamics are registry-loaded too.
      const rs = resolveAutoSlow(
        channelKeys(),
        getDomain(),
        (result.autoSlowSites || {}) as Record<string, AutoSlowSettings>,
        (result.autoSlowChannels || {}) as Record<string, AutoSlowSettings>,
        result.autoSlowGlobal as AutoSlowSettings | undefined,
      );
      S.autoSlowScope = rs.scope;
      S.autoSlowTarget = rs.target;
      applyResolved(domains, channels, result.globalSpeed as number | undefined);
      applyAll();
      // A live stream never inherits a saved speed — sync (or 100%) takes over.
      controlLive();
      updateTimeBadge();
      updateLauncher();
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
    updateLauncher();
  });
  applyResolvedTargetFromStore(); // the channel changed — its allowed-delay may differ
  applyResolvedAutoSlowFromStore(); // ...and its auto-slow enable may differ too
}

// Wait for the selective-sync config so the first resolve reads each setting from
// the area it actually lives in (an opted-out category is in local, not sync).
whenReady(loadSpeed);

// Steady background tick: re-assert speed and drive live-sync (a backstop — most
// re-applies are now event-driven). Self-reschedules so the cadence can back off on
// pages with no media. A full reconcile() runs only every RECONCILE_MS, not per tick.
function tick() {
  if (!ctxValid()) {
    teardown();
    return;
  } // orphaned after a reload — stop the dead instance
  const now = Date.now();
  if (now - lastReconcileAt >= RECONCILE_MS) {
    lastReconcileAt = now;
    reconcile(); // rare backstop for shadow roots attached to pre-existing elements
  }
  applyAll();
  controlLive();
  updateTimeBadge();
  updateLauncher();
  if (currentChannel() !== lastChannel) reresolve();
  // Back off the cadence when the page has no video (collectVideos reads the tracked
  // set — cheap). Any video keeps it at TICK_MIN; a media event or focus regain
  // resets it via wake().
  tickInterval = collectVideos().length ? TICK_MIN : Math.min(TICK_MAX, tickInterval * 2);
  liveTick = setTimeout(tick, tickInterval);
}

// Start the recurring timers (background tick + graph samplers). `immediate` ticks
// right away to catch up after the tab regains focus. Background graph samplers
// pre-fill the popup's audio/latency graphs; their sample bodies live in their
// modules (unit-tested), only the scheduling lives here in the browser-wired entry.
function startTimers(immediate = false) {
  if (liveTick == null) liveTick = setTimeout(tick, immediate ? 0 : tickInterval);
  if (audioSampler == null) audioSampler = setInterval(recordAudioSample, A_HIST_MS);
  if (bufferSampler == null) bufferSampler = setInterval(recordBufferSample, BUF_HIST_MS);
  // Always running; the sample body no-ops cheaply while auto-slow is off.
  if (autoSlowSampler == null) autoSlowSampler = setInterval(autoSlowSample, AUTOSLOW_MS);
}

// A media event or the tab regaining focus: drop back to the fast cadence and
// re-tick promptly instead of waiting out a backed-off interval. No-op while
// hidden (timers stopped) — visibilitychange restarts them.
function wake() {
  tickInterval = TICK_MIN;
  if (liveTick != null) {
    clearTimeout(liveTick);
    liveTick = setTimeout(tick, 0);
  }
}

// Don't burn CPU on hidden tabs: stop the timers in the background, restart (and
// immediately catch up) when the tab is shown again.
document.addEventListener("visibilitychange", () => {
  if (!ctxValid()) {
    teardown();
    return;
  }
  if (document.hidden) stopTimers();
  else {
    tickInterval = TICK_MIN;
    startTimers(true);
  }
});

if (!document.hidden) startTimers();

// Apply the speed the moment ANY video starts up — a second player added to the
// page would otherwise wait for the next tick/mutation pass and could begin at
// 1×. Media events don't bubble, but a capture-phase listener still sees them.
for (const ev of ["play", "loadedmetadata"]) {
  document.addEventListener(
    ev,
    (e) => {
      if (!(e.target instanceof HTMLMediaElement)) return;
      if (!ctxValid()) return;
      wake(); // media showed up — reset any no-video backoff to the fast cadence
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

// Coalesce a re-apply into a single rAF pass — the registry calls this only when a
// mutation actually added media (new/lazy player, SPA navigation), so chat/feed
// churn no longer drives needless applyAll passes.
function scheduleReapply() {
  if (observerScheduled) return;
  observerScheduled = true;
  requestAnimationFrame(() => {
    observerScheduled = false;
    if (!ctxValid()) {
      teardown();
      return;
    }
    applyAll();
    controlLive();
  });
}

// Watch for videos added later (SPA navigation, lazy players, in-shadow swaps). The
// registry owns the MutationObserver: it maintains the tracked-media set
// incrementally (bounded by what changed) and observes media-bearing shadow roots,
// calling scheduleReapply only when media changed. ownsBadgeNode keeps our own badge
// shadow root from being observed (its writes would otherwise feed back in).
function startObserver() {
  startTracking({
    onMediaChange: scheduleReapply,
    onContextDead: teardown,
    isOwnNode: (n) => ownsBadgeNode(n) || ownsLauncherNode(n),
  });
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
  // Simple scalars/flags + their side-effects (badge toggles re-render the badge,
  // audio-speed re-applies/resets, the overlay button re-evaluates) come from the
  // registry in one pass.
  applyRegistryChanges(changes);
  // Audio compressor values are in the registry too; only its engage/re-apply stays
  // here — the toggle re-engages (retrying while the context warms up), a param tweak
  // just re-applies once.
  if (changes.audioComp) engageAudio(0);
  else if (
    changes.audioCompThreshold ||
    changes.audioCompKnee ||
    changes.audioCompRatio ||
    changes.audioCompAttack ||
    changes.audioCompRelease ||
    changes.audioCompGain
  ) {
    applyAudioComp();
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
  if (changes.overlayBtnPos) {
    const map =
      (changes.overlayBtnPos.newValue as Record<string, { fx: number; fy: number }> | undefined) ||
      {};
    S.overlayBtnPos = map[getDomain()] || null;
    updateLauncher();
  }
  if (changes.overlayPanelPos) {
    const map =
      (changes.overlayPanelPos.newValue as
        | Record<string, { fx: number; fy: number }>
        | undefined) || {};
    S.overlayPanelPos = map[getDomain()] || null;
  }
  if (changes.autoSlowSites || changes.autoSlowChannels || changes.autoSlowGlobal) {
    applyResolvedAutoSlowFromStore(); // re-resolve the scoped bundle (enable + target)
  }
  if (changes.speedPresets || changes.presetKeys) {
    // Both arrays sort together, so re-read both and recompute the pair set.
    STORE.get(["speedPresets", "presetKeys"], (r) => {
      const ps = normalizePresetSet(r.speedPresets, r.presetKeys);
      S.presets = ps.presets.map((p) => p / 100);
      S.presetKeys = ps.keys;
    });
  }
});
