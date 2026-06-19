// Selective sync — pure registry + routing helpers (no chrome APIs, so it's
// unit-testable in isolation). Every persisted setting belongs to a category;
// each category is independently synced (chrome.storage.sync) or kept on this
// device (storage.local). The live routing layer (./store.ts) reads these maps
// to decide which area a key lives in.

export type Category = "speeds" | "delays" | "audio" | "shortcuts" | "general";

// The categories the user can toggle, in display order. "general" is the catch-all
// for everything else (theme, language, badge toggles, one-time "seen" flags).
export const CATEGORIES: Category[] = ["speeds", "delays", "audio", "shortcuts", "general"];

// Every known storage key → its category. Anything not listed falls through to
// "general" (see categoryOf), so a forgotten key still has a deterministic home.
export const KEY_CATEGORY: Record<string, Category> = {
  // Saved playback speeds (global default + per-site + per-channel).
  globalSpeed: "speeds",
  domains: "speeds",
  channels: "speeds",
  // Editable preset values + the configurable max-speed ceiling, the per-press
  // step size, and the hold-key's temporary speed.
  speedPresets: "speeds",
  presetKeys: "speeds",
  presetPins: "speeds",
  speedMax: "speeds",
  speedStep: "speeds",
  holdSpeed: "speeds",
  // Auto-slow for dense speech: the per-scope enable + the global floor. Grouped
  // with speeds — it resolves per scope and acts on the playback rate.
  autoSlowGlobal: "speeds",
  autoSlowSites: "speeds",
  autoSlowChannels: "speeds",
  autoSlowFloor: "speeds",
  autoSlowHold: "speeds",
  autoSlowReaction: "speeds",
  autoSlowEaseBack: "speeds",
  // Live-sync: the on/off toggle and the allowed-delay, saved per scope.
  liveSync: "delays",
  liveSyncTarget: "delays", // legacy global fallback
  liveSyncMax: "delays", // legacy
  syncTargetGlobal: "delays",
  syncTargets: "delays",
  syncTargetChannels: "delays",
  // Audio compressor.
  audioComp: "audio",
  audioCompThreshold: "audio",
  audioCompKnee: "audio",
  audioCompRatio: "audio",
  audioCompAttack: "audio",
  audioCompRelease: "audio",
  audioCompGain: "audio",
  // Keyboard shortcuts: the on/off toggle and the key map.
  keyboard: "shortcuts",
  keymap: "shortcuts",
  // General toggles / per-device-ish bits.
  theme: "general",
  uiLang: "general",
  showRemaining: "general",
  streamBadge: "general",
  superTheater: "general",
  superTheaterStream: "general",
  audioSpeed: "general",
  forceRate: "general",
  badgePos: "general",
  badgePinned: "general",
  liveSyncSeen: "general",
  audioSeen: "general",
  popupGuideSeen: "general",
};

// Where the sync-category map itself lives — always device-local, since "what to
// sync" is a per-device choice. Never routed (the router reads it to route).
export const SYNC_META_KEY = "syncCategories";

// Master sync switch. When off, every category routes to local regardless of its
// per-category preference; the preferences are remembered and restored when it's
// turned back on. Also device-local, and defaults on (prior behaviour).
export const SYNC_MASTER_KEY = "syncMaster";
export const DEFAULT_MASTER = true;

// Default: everything synced — matches the pre-feature behaviour, so existing
// users (and a fresh install) keep cross-device sync until they opt out.
export type SyncConfig = Record<Category, boolean>;
export const DEFAULT_SYNC: SyncConfig = {
  speeds: true,
  delays: true,
  audio: true,
  shortcuts: true,
  general: true,
};
export const ALL_LOCAL: SyncConfig = {
  speeds: false,
  delays: false,
  audio: false,
  shortcuts: false,
  general: false,
};

// The config the router actually uses: the per-category preferences when the
// master switch is on, or everything-local when it's off.
export function effectiveConfig(prefs: SyncConfig, master: boolean): SyncConfig {
  return master ? { ...prefs } : { ...ALL_LOCAL };
}

export function categoryOf(key: string): Category {
  return KEY_CATEGORY[key] ?? "general";
}

// Keys grouped by category — derived once from KEY_CATEGORY.
export const KEYS_BY_CATEGORY: Record<Category, string[]> = CATEGORIES.reduce(
  (acc, c) => {
    acc[c] = Object.keys(KEY_CATEGORY).filter((k) => KEY_CATEGORY[k] === c);
    return acc;
  },
  {} as Record<Category, string[]>,
);

// Coerce a stored (possibly partial / legacy) map into a full config — every
// category present, missing ones defaulting to synced.
export function normalizeConfig(raw: unknown): SyncConfig {
  const cfg = { ...DEFAULT_SYNC };
  if (raw && typeof raw === "object") {
    for (const c of CATEGORIES) {
      const v = (raw as Record<string, unknown>)[c];
      if (typeof v === "boolean") cfg[c] = v;
    }
  }
  return cfg;
}

// A synced category lives in "sync"; an opted-out one in "local".
export function areaForCategory(cat: Category, cfg: SyncConfig): "sync" | "local" {
  return cfg[cat] ? "sync" : "local";
}
export function areaForKey(key: string, cfg: SyncConfig): "sync" | "local" {
  return areaForCategory(categoryOf(key), cfg);
}

// Split a key list into the two storage areas they currently route to.
export function groupKeysByArea(
  keys: string[],
  cfg: SyncConfig,
): { sync: string[]; local: string[] } {
  const out: { sync: string[]; local: string[] } = { sync: [], local: [] };
  for (const k of keys) out[areaForKey(k, cfg)].push(k);
  return out;
}
