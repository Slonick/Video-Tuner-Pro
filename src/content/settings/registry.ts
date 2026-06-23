// Declarative table for the SIMPLE settings keys — the scalars and flags that map
// 1:1 onto a field of `S` through a pure parse, with at most one side-effect. Each
// key is described ONCE here instead of being repeated across loadSpeed's get-list,
// loadSpeed's assignment block, and the onChanged if-chain. Keys with cross-scope
// resolution or per-domain maps (speed, sync target, auto-slow bundle, presets,
// badge/button position) are deliberately NOT here — they keep their bespoke code.
import { clampNum } from "../core/clamp.js";
import { normalizeSpeedStep, normalizeHoldSpeed } from "../../shared/presets.js";
import { normalizeKeymap } from "../../shared/keymap.js";
import { clampGlassOpacity, GLASS_OPACITY_KEY } from "../../shared/glass.js";
import { S } from "../state.js";
import { applyAll, resetAudios } from "../speed.js";
import { updateTimeBadge, flashBadge, applyBadgeGlass } from "../badge/overlay.js";
import { updateLauncher, applyLauncherGlass } from "../overlay/launcher.js";

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
  // with no side-effect; the scoped enable/target bundle stays bespoke.
  // Master on/off — global (like the compressor), not per-scope. The sampler resets
  // the slowdown itself when it sees the flag off, so no apply side-effect here.
  entry({
    key: "autoSlowEnabled",
    parse: (raw) => raw === true,
    set: (v) => (S.autoSlowEnabled = v),
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
