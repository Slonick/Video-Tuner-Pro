// Compressor presets — one-tap sound profiles for the audio section. Values stay
// inside the sliders' ranges (threshold [-100,0], knee [0,40], ratio [1,20],
// attack/release [0,1] s). Make-up gain is intentionally left out: it's a manual
// control a preset never overrides.
export interface CompParams {
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;   // seconds
  release: number;  // seconds
}

export type PresetName = "voice" | "night" | "movie";

export const COMP_PRESETS: Record<PresetName, CompParams> = {
  // The balanced default — also the everyday "voice / dialogue" profile.
  voice: { threshold: -60, knee: 30, ratio: 10, attack: 0, release: 1 },
  // Late-night: flatten almost everything so quiet passages stay audible.
  night: { threshold: -50, knee: 30, ratio: 16, attack: 0.005, release: 0.4 },
  // Movies: tame loud action while lifting quiet dialogue, over a wide range.
  movie: { threshold: -28, knee: 30, ratio: 8, attack: 0.01, release: 0.5 },
};

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
