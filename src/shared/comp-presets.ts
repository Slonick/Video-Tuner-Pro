// Compressor presets — shared by the popup (one-tap profiles in the audio
// section) and the options page (where their values + names are editable). Values
// stay inside the sliders' ranges (threshold [-100,0], knee [0,40], ratio [1,20],
// attack/release [0,1] s). Make-up gain is intentionally excluded: it's a manual
// control a preset never overrides.
export interface CompParams {
  threshold: number;
  knee: number;
  ratio: number;
  attack: number; // seconds
  release: number; // seconds
}

export type PresetName = "voice" | "night" | "movie";
export const PRESET_ORDER: PresetName[] = ["voice", "night", "movie"];

export const COMP_PRESET_DEFAULTS: Record<PresetName, CompParams> = {
  // The balanced default — also the everyday "voice / dialogue" profile.
  voice: { threshold: -60, knee: 30, ratio: 10, attack: 0, release: 1 },
  // Late-night: flatten almost everything so quiet passages stay audible.
  night: { threshold: -50, knee: 30, ratio: 16, attack: 0.005, release: 0.4 },
  // Movies: tame loud action while lifting quiet dialogue, over a wide range.
  movie: { threshold: -28, knee: 30, ratio: 8, attack: 0.01, release: 0.5 },
};

// Persisted under `compPresets`: per preset, the params plus an optional custom
// name. Any missing field falls back to the default.
export type StoredPreset = Partial<CompParams> & { name?: string };
export type StoredPresets = Partial<Record<PresetName, StoredPreset>>;

export interface ResolvedPreset extends CompParams {
  name?: string;
}

// Merge the stored overrides onto the defaults. `name` stays undefined unless the
// user set one — callers fill the localized default ("Voice"/"Night"/"Movie").
export function resolvePresets(
  stored: StoredPresets | undefined,
): Record<PresetName, ResolvedPreset> {
  const out = {} as Record<PresetName, ResolvedPreset>;
  for (const k of PRESET_ORDER) out[k] = { ...COMP_PRESET_DEFAULTS[k], ...(stored?.[k] || {}) };
  return out;
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
