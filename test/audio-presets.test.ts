import { describe, it, expect } from "vitest";
import { COMP_PRESETS, compToStorage } from "../src/popup/audio-presets.js";

// The slider ranges the popup enforces (clampNum) — a preset outside these would
// be silently altered on apply, so every value must already fit.
const RANGES: Record<string, [number, number]> = {
  threshold: [-100, 0],
  knee: [0, 40],
  ratio: [1, 20],
  attack: [0, 1],
  release: [0, 1],
  gain: [0, 24],
};

describe("compressor presets", () => {
  for (const [name, p] of Object.entries(COMP_PRESETS)) {
    it(`${name} stays within every slider's range`, () => {
      for (const [k, [lo, hi]] of Object.entries(RANGES)) {
        const v = p[k as keyof typeof p];
        expect(v, `${name}.${k} below ${lo}`).toBeGreaterThanOrEqual(lo);
        expect(v, `${name}.${k} above ${hi}`).toBeLessThanOrEqual(hi);
      }
    });
  }

  it("compToStorage maps a profile to the content-script keys", () => {
    expect(compToStorage(COMP_PRESETS.movie)).toEqual({
      audioCompThreshold: -28,
      audioCompKnee: 30,
      audioCompRatio: 8,
      audioCompAttack: 0.01,
      audioCompRelease: 0.5,
      audioCompGain: 6,
    });
  });

  it("the three presets are all distinct", () => {
    const shapes = Object.values(COMP_PRESETS).map((p) => JSON.stringify(p));
    expect(new Set(shapes).size).toBe(3);
  });
});
