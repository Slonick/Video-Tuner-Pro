// Compressor presets — one-tap sound profiles for the audio section. Values stay
// inside the sliders' ranges (threshold [-100,0], knee [0,40], ratio [1,20],
// attack/release [0,1] s, gain [0,24] dB).
export interface CompParams {
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;   // seconds
  release: number;  // seconds
  gain: number;
}

export type PresetName = "voice" | "night" | "movie";

export const COMP_PRESETS: Record<PresetName, CompParams> = {
  // The balanced default — also the everyday "voice / dialogue" profile.
  voice: { threshold: -60, knee: 30, ratio: 10, attack: 0, release: 1, gain: 10 },
  // Late-night: flatten almost everything and make up a lot of level so quiet
  // passages stay audible at a low volume.
  night: { threshold: -50, knee: 30, ratio: 16, attack: 0.005, release: 0.4, gain: 12 },
  // Movies: tame loud action while lifting quiet dialogue, over a wide range.
  movie: { threshold: -28, knee: 30, ratio: 8, attack: 0.01, release: 0.5, gain: 6 },
};

// Map a profile to the storage keys the content script reads.
export function compToStorage(p: CompParams): Record<string, number> {
  return {
    audioCompThreshold: p.threshold,
    audioCompKnee: p.knee,
    audioCompRatio: p.ratio,
    audioCompAttack: p.attack,
    audioCompRelease: p.release,
    audioCompGain: p.gain,
  };
}
