import { describe, it, expect } from "vitest";
import {
  COMP_PRESET_DEFAULTS as COMP_PRESETS,
  compToStorage,
  resolvePresets,
} from "../src/shared/comp-presets.js";

// The slider ranges the popup enforces (clampNum) — a preset outside these would
// be silently altered on apply, so every value must already fit.
const RANGES: Record<string, [number, number]> = {
  threshold: [-100, 0],
  knee: [0, 40],
  ratio: [1, 20],
  attack: [0, 1],
  release: [0, 1],
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
    });
  });

  it("the three presets are all distinct", () => {
    const shapes = Object.values(COMP_PRESETS).map((p) => JSON.stringify(p));
    expect(new Set(shapes).size).toBe(3);
  });

  it("resolvePresets overlays stored values + name on the defaults", () => {
    const r = resolvePresets({ voice: { threshold: -40, name: "Speech" } });
    expect(r.voice.threshold).toBe(-40); // overridden
    expect(r.voice.knee).toBe(COMP_PRESETS.voice.knee); // untouched default
    expect(r.voice.name).toBe("Speech");
    expect(r.night.name).toBeUndefined(); // no override → default name
    expect(r.movie).toEqual({ ...COMP_PRESETS.movie });
  });

  it("resolvePresets returns the defaults when nothing is stored", () => {
    const r = resolvePresets(undefined);
    expect(r.voice).toEqual({ ...COMP_PRESETS.voice });
    expect(r.voice.name).toBeUndefined();
  });
});
