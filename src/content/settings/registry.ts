import { clampNum } from "../core/clamp.js";
import {
  CHAT_PANEL_HEIGHT,
  CHAT_PANEL_HEIGHT_MAX,
  CHAT_PANEL_HEIGHT_MIN,
  CHAT_PANEL_WIDTH,
  CHAT_PANEL_WIDTH_MAX,
  CHAT_PANEL_WIDTH_MIN,
  SIDE_CHAT_MAX,
  SIDE_CHAT_MIN,
  SIDE_CHAT_WIDTH,
} from "../../shared/chat-bounds.js";
import { normalizeSpeedStep, normalizeHoldSpeed } from "../../shared/presets.js";
import { normalizeKeymap } from "../../shared/keymap.js";
import { clampGlassOpacity, GLASS_OPACITY_KEY } from "../../shared/glass.js";
import { S } from "../state.js";
import { applyAll, resetAudios } from "../speed.js";
import { updateTimeBadge, flashBadge, applyBadgeGlass } from "../badge/overlay.js";
import { updateLauncher, applyLauncherGlass } from "../overlay/launcher.js";
import { releaseAutoSlow } from "../audio/autoslow.js";
import { applyViewerChatMode, applyViewerChatSettings } from "../viewer.js";

// One settings key. `parse` turns a raw stored value into the typed value (default +
// clamp/normalize); `set` writes it onto S (a typed setter, so field and value types
// stay matched). `apply` is the optional side-effect to run after the value changed.
interface Entry<T> {
  key: string;
  parse: (raw: unknown) => T;
  set: (v: T) => void;
  apply?: () => void;
}

// Lets each entry infer its own value type from parse/set, then erases it so they
// can live in one array.
function entry<T>(e: Entry<T>): Entry<unknown> {
  return e as Entry<unknown>;
}

export const REGISTRY: Entry<unknown>[] = [
  // Defaults-on flags: an explicit `false` (the user turned it off) is respected.
  entry({
    key: "showRemaining",
    parse: (raw) => raw !== false,
    set: (v) => (S.showRemaining = v),
    apply: () => {
      updateTimeBadge();
      flashBadge();
    },
  }),
  entry({
    key: "streamBadge",
    parse: (raw) => raw !== false,
    set: (v) => (S.streamBadge = v),
    apply: () => {
      updateTimeBadge();
      flashBadge();
    },
  }),
  // Opt-in: turning audio control on re-applies to <audio>; off hands them back.
  entry({
    key: "audioSpeed",
    parse: (raw) => raw === true,
    set: (v) => (S.audioSpeedEnabled = v),
    apply: () => {
      if (S.audioSpeedEnabled) applyAll();
      else resetAudios();
    },
  }),
  entry({
    key: "forceRate",
    parse: (raw) => raw === true,
    set: (v) => (S.forceRate = v),
  }),
  // Live-sync buffer reserve (s) — global scalar read live by the controlLive tick,
  // so no apply side-effect. Range 1–10, default 3.
  entry({
    key: "liveSyncBufferReserve",
    parse: (raw) => clampNum(raw, 1, 10, 3),
    set: (v) => (S.liveSyncBufferReserve = v),
  }),
  entry({
    key: "keyboard",
    parse: (raw) => raw !== false,
    set: (v) => (S.keyboardEnabled = v),
  }),
  entry({
    key: "keymap",
    parse: (raw) => normalizeKeymap(raw),
    set: (v) => (S.keymap = v),
  }),
  entry({
    key: "speedStep",
    parse: (raw) => normalizeSpeedStep(raw) / 100,
    set: (v) => (S.speedStep = v),
  }),
  entry({
    key: "holdSpeed",
    parse: (raw) => normalizeHoldSpeed(raw) / 100,
    set: (v) => (S.holdSpeed = v),
  }),
  // On-video launcher: when to surface the button. updateLauncher re-evaluates it.
  entry({
    key: "overlayButton",
    parse: (raw): "off" | "fullscreen" | "always" =>
      raw === "off" || raw === "always" ? raw : "fullscreen",
    set: (v) => (S.overlayButton = v),
    apply: () => updateLauncher(),
  }),
  // Opt-in SponsorBlock markers on the viewer's seek bar (third-party request).
  entry({
    key: "sponsorMarks",
    parse: (raw) => raw === true,
    set: (v) => (S.sponsorMarks = v),
  }),
  entry({
    key: "viewerAutoEnabled",
    parse: (raw) => raw !== false,
    set: (v) => (S.viewerAutoEnabled = v),
    apply: () => updateLauncher(),
  }),
  entry({
    key: "viewerAutoPlaybackOnly",
    parse: (raw) => raw === true,
    set: (v) => (S.viewerAutoPlaybackOnly = v),
  }),
  entry({
    key: "viewerBackdropVideo",
    parse: (raw) => raw === true,
    set: (v) => (S.viewerBackdropVideo = v),
  }),
  // Stream chat in the viewer. Mode changes remount the chat surface; the panel
  // scalars restyle a mounted overlay panel live.
  entry({
    key: "viewerChatMode",
    parse: (raw): "off" | "side" | "overlay" => (raw === "side" || raw === "overlay" ? raw : "off"),
    set: (v) => (S.viewerChatMode = v),
    apply: applyViewerChatMode,
  }),
  entry({
    key: "viewerChatOpacity",
    parse: (raw) => clampNum(raw, 0, 1, 0.4),
    set: (v) => (S.viewerChatOpacity = v),
    apply: applyViewerChatSettings,
  }),
  entry({
    key: "viewerChatInput",
    parse: (raw) => raw !== false,
    set: (v) => (S.viewerChatInput = v),
    apply: applyViewerChatSettings,
  }),
  entry({
    key: "viewerChatWidth",
    parse: (raw) =>
      Math.round(clampNum(raw, CHAT_PANEL_WIDTH_MIN, CHAT_PANEL_WIDTH_MAX, CHAT_PANEL_WIDTH)),
    set: (v) => (S.viewerChatWidth = v),
    apply: applyViewerChatSettings,
  }),
  entry({
    key: "viewerChatSideWidths",
    parse: (raw) => {
      const out: Record<string, { normal?: number; theater?: number }> = {};
      if (raw && typeof raw === "object") {
        for (const [site, v] of Object.entries(raw as Record<string, unknown>)) {
          if (!v || typeof v !== "object") continue;
          const widths: { normal?: number; theater?: number } = {};
          for (const f of ["normal", "theater"] as const) {
            const n = (v as Record<string, unknown>)[f];
            if (typeof n === "number" && Number.isFinite(n)) {
              widths[f] = Math.round(clampNum(n, SIDE_CHAT_MIN, SIDE_CHAT_MAX, SIDE_CHAT_WIDTH));
            }
          }
          if (widths.normal != null || widths.theater != null) out[site] = widths;
        }
      }
      return out;
    },
    set: (v) => (S.viewerChatSideWidths = v),
    apply: applyViewerChatMode,
  }),
  entry({
    key: "viewerChatPanelSites",
    parse: (raw) => {
      const out: Record<
        string,
        {
          opacity?: number;
          width?: number;
          height?: number;
          h?: "left" | "right";
          v?: "top" | "bottom";
          dx?: number;
          dy?: number;
        }
      > = {};
      if (raw && typeof raw === "object") {
        for (const [site, v] of Object.entries(raw as Record<string, unknown>)) {
          if (!v || typeof v !== "object") continue;
          const src = v as Record<string, unknown>;
          const prefs: (typeof out)[string] = {};
          if (typeof src.opacity === "number" && Number.isFinite(src.opacity)) {
            prefs.opacity = clampNum(src.opacity, 0, 1, 0.4);
          }
          if (typeof src.width === "number" && Number.isFinite(src.width)) {
            prefs.width = Math.round(
              clampNum(src.width, CHAT_PANEL_WIDTH_MIN, CHAT_PANEL_WIDTH_MAX, CHAT_PANEL_WIDTH),
            );
          }
          if (typeof src.height === "number" && Number.isFinite(src.height)) {
            prefs.height = Math.round(
              clampNum(src.height, CHAT_PANEL_HEIGHT_MIN, CHAT_PANEL_HEIGHT_MAX, CHAT_PANEL_HEIGHT),
            );
          }
          if (src.h === "left" || src.h === "right") prefs.h = src.h;
          if (src.v === "top" || src.v === "bottom") prefs.v = src.v;
          // The distances may legitimately be negative (panel hanging past the
          // video edge) — just keep them sane.
          if (typeof src.dx === "number" && Number.isFinite(src.dx)) {
            prefs.dx = Math.round(clampNum(src.dx, -4000, 4000, 0));
          }
          if (typeof src.dy === "number" && Number.isFinite(src.dy)) {
            prefs.dy = Math.round(clampNum(src.dy, -4000, 4000, 0));
          }
          if (Object.keys(prefs).length) out[site] = prefs;
        }
      }
      return out;
    },
    set: (v) => (S.viewerChatPanelSites = v),
    apply: applyViewerChatSettings,
  }),
  entry({
    key: "viewerChatHeight",
    parse: (raw) =>
      Math.round(clampNum(raw, CHAT_PANEL_HEIGHT_MIN, CHAT_PANEL_HEIGHT_MAX, CHAT_PANEL_HEIGHT)),
    set: (v) => (S.viewerChatHeight = v),
    apply: applyViewerChatSettings,
  }),
  // Glass opacity multiplier — scales the on-video badge + launcher glass live.
  entry({
    key: GLASS_OPACITY_KEY,
    parse: (raw) => clampGlassOpacity(raw),
    set: (v) => (S.glassOpacity = v),
    apply: () => {
      applyLauncherGlass();
      applyBadgeGlass();
    },
  }),
  // Audio compressor — values only. The engage-vs-reapply side-effect stays bespoke
  // in index.ts (the toggle re-engages; a param tweak just re-applies), so it isn't
  // duplicated per param here.
  entry({
    key: "audioComp",
    parse: (raw) => raw !== false,
    set: (v) => (S.audioCompEnabled = v),
  }),
  entry({
    key: "audioCompThreshold",
    parse: (raw) => clampNum(raw, -100, 0, -60),
    set: (v) => (S.audioCompThreshold = v),
  }),
  entry({
    key: "audioCompKnee",
    parse: (raw) => clampNum(raw, 0, 40, 30),
    set: (v) => (S.audioCompKnee = v),
  }),
  entry({
    key: "audioCompRatio",
    parse: (raw) => clampNum(raw, 1, 20, 10),
    set: (v) => (S.audioCompRatio = v),
  }),
  entry({
    key: "audioCompAttack",
    parse: (raw) => clampNum(raw, 0, 1, 0),
    set: (v) => (S.audioCompAttack = v),
  }),
  entry({
    key: "audioCompRelease",
    parse: (raw) => clampNum(raw, 0, 1, 1),
    set: (v) => (S.audioCompRelease = v),
  }),
  entry({
    key: "audioCompGain",
    parse: (raw) => clampNum(raw, 0, 24, 0),
    set: (v) => (S.audioCompGain = v),
  }),
  // Auto-slow response dynamics (floor + hold/reaction/ease-back) — global scalars
  // with no side-effect; the scoped target stays bespoke.
  // Master on/off — global (like the compressor), not per-scope.
  entry({
    key: "autoSlowEnabled",
    parse: (raw) => raw === true,
    set: (v) => (S.autoSlowEnabled = v),
    apply: () => {
      if (!S.autoSlowEnabled) releaseAutoSlow();
    },
  }),
  entry({
    key: "autoSlowFloor",
    parse: (raw) => clampNum(raw, 0.5, 2, 1.0),
    set: (v) => (S.autoSlowFloor = v),
  }),
  entry({
    key: "autoSlowKnee",
    parse: (raw) => clampNum(raw, 0, 2, 0.5),
    set: (v) => (S.autoSlowKnee = v),
  }),
  entry({
    key: "autoSlowHold",
    parse: (raw) => clampNum(raw, 0, 4, 1.2),
    set: (v) => (S.autoSlowHold = v),
  }),
  entry({
    key: "autoSlowReaction",
    parse: (raw) => clampNum(raw, 0, 100, 50),
    set: (v) => (S.autoSlowReaction = v),
  }),
  entry({
    key: "autoSlowEaseBack",
    parse: (raw) => clampNum(raw, 0, 100, 25),
    set: (v) => (S.autoSlowEaseBack = v),
  }),
];

// The registry's storage keys, to fold into loadSpeed's STORE.get list.
export const REGISTRY_KEYS = REGISTRY.map((e) => e.key);

// Load every registry key from a fresh STORE.get result into S. No side-effects —
// loadSpeed applies the resolved speed/badge/launcher once afterwards.
export function loadRegistry(result: Record<string, unknown>): void {
  for (const e of REGISTRY) e.set(e.parse(result[e.key]));
}

// Apply a storage.onChanged batch: write S for each changed registry key, then run
// the affected side-effects once (deduped). Returns whether any registry key was in
// the batch, so the caller can skip its own follow-up work when nothing matched.
export function applyRegistryChanges(changes: Record<string, { newValue?: unknown }>): boolean {
  let touched = false;
  const applies = new Set<() => void>();
  for (const e of REGISTRY) {
    const ch = changes[e.key];
    if (!ch) continue;
    e.set(e.parse(ch.newValue));
    touched = true;
    if (e.apply) applies.add(e.apply);
  }
  for (const fn of applies) fn();
  return touched;
}
