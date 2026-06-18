// Editable speed presets — the eight values behind the popup's preset grid and
// the Shift+1…8 keyboard shortcuts. Stored once (key "speedPresets", as integer
// percents) so the grid and the hotkeys stay in lockstep. Pure + unit-tested.

export const PRESET_COUNT = 8;
// The popup slider's lower bound; presets snap to this floor and the 5% step.
export const PRESET_MIN = 25;
// Absolute ceiling for any preset value — matches the hard playback cap
// (MAX_SPEED = 16× in the speed clamps), expressed as a percent. The *visible*
// upper bound is the user's speedMax setting (≤ this), enforced by the editor.
export const PRESET_MAX = 1600;
const STEP = 5;

// The shipped defaults — same eight values the popup grid used before they were
// made editable.
export const DEFAULT_PRESETS: number[] = [50, 75, 100, 125, 150, 175, 200, 250];

// The configurable upper bound the popup speed slider + preset editor expose.
// Stored under key "speedMax" (integer percent). Sits below the hard playback
// cap (PRESET_MAX), which stays as a safety limit above it.
export const SPEED_MAX_DEFAULT = 500;
export const SPEED_MAX_MIN = 100;
export const SPEED_MAX_STEP = 25;

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

// Coerce stored/user input into exactly PRESET_COUNT clean, sorted percents.
// Missing or invalid slots fall back to the default at that position.
export function normalizePresets(raw: unknown): number[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: number[] = [];
  for (let i = 0; i < PRESET_COUNT; i++) {
    out.push(clampPct(Number(arr[i]), DEFAULT_PRESETS[i]));
  }
  return out.sort((a, b) => a - b);
}

// As playback-rate fractions (e.g. 1.5), for the content script.
export function presetFractions(raw: unknown): number[] {
  return normalizePresets(raw).map((p) => p / 100);
}
