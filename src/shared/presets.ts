// Editable speed presets — a variable-length list (1…MAX_PRESETS) of values, each
// with an optional hotkey chord and a "pinned" flag. Values live under
// "speedPresets" (integer percents); the matching key + pin live at the same
// index under "presetKeys" (chord spec or null) and "presetPins" (boolean). The
// three arrays stay in lockstep: sorted together by value, so a key/pin always
// follows its speed. The pinned presets are the ones shown in the popup's
// collapsed quick row. Pure + unit-tested.
import { parseChord, formatChord } from "./keymap.js";

// How many presets can exist, and how many fit the collapsed quick row (one row
// of four — a second row overflows the popup's ~600px height cap).
export const MAX_PRESETS = 16;
export const MIN_PRESETS = 1;
export const QUICK_COUNT = 4;
// The popup slider's lower bound; presets snap to this floor and the 5% step.
export const PRESET_MIN = 25;
// Absolute ceiling for any preset value — matches the hard playback cap
// (MAX_SPEED = 16× in the speed clamps), expressed as a percent. Presets are free
// to use the whole range; speedMax only bounds the popup slider, not the presets.
export const PRESET_MAX = 1600;
const STEP = 5;

// The shipped defaults — a fine cluster around 100% plus the 16× ceiling.
export const DEFAULT_PRESETS: number[] = [25, 50, 75, 90, 100, 110, 125, 150, 175, 200, 250, 1600];

// Default per-preset keys, aligned to the sorted DEFAULT_PRESETS: the lowest nine
// get ⇧1…⇧9 (Shift avoids the bare 1-9 players like YouTube bind; only nine
// digits exist), the rest ship unassigned. null = no key.
export const DEFAULT_PRESET_KEYS: (string | null)[] = DEFAULT_PRESETS.map((_, i) =>
  i < 9 ? `S+Digit${i + 1}` : null,
);

// Preset values pinned out of the box → the popup's collapsed quick row. Matched
// by value (so they apply to any preset set that contains them) when nothing is
// stored yet.
export const DEFAULT_PINNED_VALUES: number[] = [50, 100, 175, 250];

// The configurable upper bound the popup speed slider + preset editor expose.
// Stored under key "speedMax" (integer percent). Sits below the hard playback
// cap (PRESET_MAX), which stays as a safety limit above it.
export const SPEED_MAX_DEFAULT = 500;
export const SPEED_MAX_MIN = 100;
export const SPEED_MAX_STEP = 25;

// How much one slower/faster press (or popup ± tap) changes the speed, in
// percent. Stored under "speedStep"; Shift doubles it. The popup + content
// script divide by 100 to a fraction.
export const STEP_DEFAULT = 5;
export const STEP_MIN = 1;
export const STEP_MAX = 50;

// The temporary speed the "hold" key applies while pressed. Stored under
// "holdSpeed" (integer percent); default 200% (2×).
export const HOLD_SPEED_DEFAULT = 200;

function clampPct(v: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  const stepped = Math.round(v / STEP) * STEP;
  return Math.min(PRESET_MAX, Math.max(PRESET_MIN, stepped));
}

// Coerce a stored "max speed" value into the allowed range (default 500%).
export function normalizeSpeedMax(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return SPEED_MAX_DEFAULT;
  const stepped = Math.round(n / SPEED_MAX_STEP) * SPEED_MAX_STEP;
  return Math.min(PRESET_MAX, Math.max(SPEED_MAX_MIN, stepped));
}

// Coerce a stored speed-step value into the allowed range (default 5%).
export function normalizeSpeedStep(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return STEP_DEFAULT;
  return Math.min(STEP_MAX, Math.max(STEP_MIN, Math.round(n)));
}

// Coerce a stored hold-speed value into the preset range (default 200%, snap 5%).
export function normalizeHoldSpeed(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return HOLD_SPEED_DEFAULT;
  const stepped = Math.round(n / STEP) * STEP;
  return Math.min(PRESET_MAX, Math.max(PRESET_MIN, stepped));
}

// How many presets a stored value yields: the count of finite entries, clamped to
// [MIN_PRESETS, MAX_PRESETS]; the defaults' length when nothing valid is stored.
function presetCount(values: number[]): number {
  if (!values.length) return DEFAULT_PRESETS.length;
  return Math.min(MAX_PRESETS, Math.max(MIN_PRESETS, values.length));
}

// Coerce stored/user input into a clean, sorted percent list (1…MAX_PRESETS
// values). Empty/invalid input falls back to the defaults.
export function normalizePresets(raw: unknown): number[] {
  const arr = Array.isArray(raw) ? raw.map(Number).filter(Number.isFinite) : [];
  const src = arr.length ? arr : DEFAULT_PRESETS;
  const n = presetCount(arr);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(clampPct(Number(src[i]), DEFAULT_PRESETS[i] ?? 100));
  return out.sort((a, b) => a - b);
}

// A single stored key spec → a clean chord string, or null if missing/invalid.
function normalizeOneKey(raw: unknown): string | null {
  const c = parseChord(raw);
  return c ? formatChord(c) : null;
}

// Coerce the stored presets + their keys + pins into lockstep (value, key, pin)
// entries, sorted by value so each key/pin stays attached to its speed. Duplicate
// keys are dropped to null (keeping the lower-valued preset's), and no more than
// QUICK_COUNT presets stay pinned (lowest values win). Missing keys fall back to
// DEFAULT_PRESET_KEYS so upgrading users keep ⇧1…⇧9.
export function normalizePresetSet(
  rawPresets: unknown,
  rawKeys: unknown,
  rawPins?: unknown,
): { presets: number[]; keys: (string | null)[]; pinned: boolean[] } {
  const pRaw = Array.isArray(rawPresets) ? rawPresets.map(Number).filter(Number.isFinite) : [];
  const pSrc = pRaw.length ? pRaw : DEFAULT_PRESETS;
  const n = presetCount(pRaw);
  const kSrc = Array.isArray(rawKeys) ? rawKeys : DEFAULT_PRESET_KEYS;
  // No stored pins → seed the default pinned values (by value); otherwise honor
  // exactly what's stored.
  const hasPins = Array.isArray(rawPins);
  const bSrc = hasPins ? (rawPins as unknown[]) : [];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const pct = clampPct(Number(pSrc[i]), DEFAULT_PRESETS[i] ?? 100);
    rows.push({
      pct,
      key: normalizeOneKey(kSrc[i]),
      pin: hasPins ? bSrc[i] === true : DEFAULT_PINNED_VALUES.includes(pct),
    });
  }
  rows.sort((a, b) => a.pct - b.pct);
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.key && seen.has(r.key)) r.key = null;
    else if (r.key) seen.add(r.key);
  }
  let pins = 0;
  for (const r of rows) {
    if (r.pin && ++pins > QUICK_COUNT) r.pin = false;
  }
  return {
    presets: rows.map((r) => r.pct),
    keys: rows.map((r) => r.key),
    pinned: rows.map((r) => r.pin),
  };
}

// The preset indices shown in the collapsed quick row: the pinned ones, then the
// lowest-value unpinned to fill up to QUICK_COUNT, returned in ascending-value
// order (the lists are already value-sorted, so index order == value order).
export function quickPresetIndices(pinned: boolean[]): number[] {
  const all = pinned.map((_, i) => i);
  const pick = all.filter((i) => pinned[i]).concat(all.filter((i) => !pinned[i]));
  return pick.slice(0, QUICK_COUNT).sort((a, b) => a - b);
}

// As playback-rate fractions (e.g. 1.5), for the content script.
export function presetFractions(raw: unknown): number[] {
  return normalizePresets(raw).map((p) => p / 100);
}
