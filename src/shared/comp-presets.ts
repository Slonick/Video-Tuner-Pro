// Compressor presets — a variable-length list (1…COMP_MAX_PRESETS) of one-tap
// profiles shared by the popup (the audio section's preset buttons) and the
// options page (where they're added/removed/renamed/pinned and their values
// tuned). Each preset carries the five compressor params, an optional custom
// name, and a "pinned" flag; the pinned ones (up to COMP_QUICK_COUNT) are the
// buttons shown in the popup. Make-up gain is intentionally excluded: it's a
// manual control a preset never overrides. Persisted as an array under
// `compPresets`. Pure + unit-tested.
export interface CompParams {
  threshold: number;
  knee: number;
  ratio: number;
  attack: number; // seconds
  release: number; // seconds
}

// A stored/resolved preset: the params plus an optional custom name and an
// optional make-up gain override. `nameKey` localizes the three shipped defaults
// (Voice/Night/Movie); user-added presets have neither and fall back to a generic
// "Preset N" label. `gain` (dB), when set, overrides the global make-up gain: the
// popup's gain slider then edits *this preset's* gain; presets without it use —
// and the slider edits — the global gain instead.
export interface CompPreset extends CompParams {
  name?: string;
  nameKey?: string;
  gain?: number;
  pin: boolean;
}

// How many presets can exist, and how many fit the popup's preset row (a single
// row — more would overflow the popup's ~600px height cap).
export const COMP_MIN_PRESETS = 1;
export const COMP_MAX_PRESETS = 8;
export const COMP_QUICK_COUNT = 3; // the popup's quick row fits three (Voice / Night / Movie)

// Make-up gain bounds (dB) — shared by the popup slider, the options' global-gain
// slider, and a preset's optional gain override.
export const GAIN_MIN = 0;
export const GAIN_MAX = 24;
export const GAIN_STEP = 1;
export const GAIN_DEFAULT = 0;

// The slider ranges the popup enforces (clampNum) — a value outside these would
// be silently altered on apply, so every stored value is clamped to fit.
const RANGES: Record<keyof CompParams, [number, number]> = {
  threshold: [-100, 0],
  knee: [0, 40],
  ratio: [1, 20],
  attack: [0, 1],
  release: [0, 1],
};

// Params used when a stored entry is missing fields and no default lines up.
const FALLBACK: CompParams = { threshold: -60, knee: 30, ratio: 10, attack: 0, release: 1 };

export const COMP_PRESET_DEFAULTS: CompPreset[] = [
  // The balanced default — also the everyday "voice / dialogue" profile.
  { nameKey: "presetVoice", threshold: -60, knee: 30, ratio: 10, attack: 0, release: 1, pin: true },
  // Late-night: flatten almost everything so quiet passages stay audible.
  {
    nameKey: "presetNight",
    threshold: -50,
    knee: 30,
    ratio: 16,
    attack: 0.005,
    release: 0.4,
    pin: true,
  },
  // Movies: tame loud action while lifting quiet dialogue, over a wide range.
  {
    nameKey: "presetMovie",
    threshold: -28,
    knee: 30,
    ratio: 8,
    attack: 0.01,
    release: 0.5,
    pin: true,
  },
];

// The keyed order of the pre-list `compPresets` shape, for migrating old data.
const OLD_ORDER = ["voice", "night", "movie"] as const;

const clone = (p: CompPreset): CompPreset => ({ ...p });
const defaults = (): CompPreset[] => COMP_PRESET_DEFAULTS.map(clone);

function clampParam(key: keyof CompParams, raw: unknown, fallback: number): number {
  const [lo, hi] = RANGES[key];
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function coerceParams(src: Partial<CompParams> | undefined, base: CompParams): CompParams {
  return {
    threshold: clampParam("threshold", src?.threshold, base.threshold),
    knee: clampParam("knee", src?.knee, base.knee),
    ratio: clampParam("ratio", src?.ratio, base.ratio),
    attack: clampParam("attack", src?.attack, base.attack),
    release: clampParam("release", src?.release, base.release),
  };
}

const cleanName = (raw: unknown): string | undefined =>
  typeof raw === "string" && raw.trim() ? raw.trim() : undefined;

// An optional per-preset gain → a clamped dB value, or undefined (use the global
// make-up gain) when absent or invalid.
export function coerceGain(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(GAIN_MAX, Math.max(GAIN_MIN, Math.round(n)));
}

// Drop pins beyond COMP_QUICK_COUNT (the popup's quick row fits that many), keeping
// the earliest-listed ones. Mutates + returns the list.
function capPins(list: CompPreset[]): CompPreset[] {
  let pins = 0;
  for (const p of list) if (p.pin && ++pins > COMP_QUICK_COUNT) p.pin = false;
  return list;
}

// Migrate the old keyed `{ voice, night, movie }` shape (params + optional name,
// no pin) into the list form: the three defaults, each with its stored overrides
// merged on and pinned (so the popup keeps showing all three as before).
function migrateOld(obj: Record<string, unknown>): CompPreset[] {
  return COMP_PRESET_DEFAULTS.map((def, i) => {
    const stored = obj[OLD_ORDER[i]] as (Partial<CompParams> & { name?: unknown }) | undefined;
    return {
      ...coerceParams(stored, def),
      name: cleanName(stored?.name),
      nameKey: def.nameKey,
      pin: true,
    };
  });
}

function normalizeList(raw: unknown[]): CompPreset[] {
  const list = raw.slice(0, COMP_MAX_PRESETS).map((entry, i): CompPreset => {
    const e = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const base = COMP_PRESET_DEFAULTS[i] ?? FALLBACK;
    return {
      ...coerceParams(e as Partial<CompParams>, base),
      name: cleanName(e.name),
      nameKey: typeof e.nameKey === "string" ? e.nameKey : undefined,
      gain: coerceGain(e.gain),
      pin: e.pin === true,
    };
  });
  return list.length ? capPins(list) : defaults();
}

// Coerce whatever is stored under `compPresets` into a clean preset list: the new
// array form is validated; the old keyed object is migrated; anything else falls
// back to the shipped defaults.
export function normalizeCompPresets(raw: unknown): CompPreset[] {
  if (Array.isArray(raw)) return normalizeList(raw);
  if (raw && typeof raw === "object") return migrateOld(raw as Record<string, unknown>);
  return defaults();
}

// Map a profile to the storage keys the content script reads.
export function compToStorage(p: CompParams): Record<string, number> {
  return {
    audioCompThreshold: p.threshold,
    audioCompKnee: p.knee,
    audioCompRatio: p.ratio,
    audioCompAttack: p.attack,
    audioCompRelease: p.release,
  };
}
