import { describe, it, expect } from "vitest";
import {
  COMP_PRESET_DEFAULTS,
  COMP_MAX_PRESETS,
  COMP_QUICK_COUNT,
  compToStorage,
  normalizeCompPresets,
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
  for (const p of COMP_PRESET_DEFAULTS) {
    it(`${p.nameKey} stays within every slider's range`, () => {
      for (const [k, [lo, hi]] of Object.entries(RANGES)) {
        const v = p[k as keyof typeof p] as number;
        expect(v, `${p.nameKey}.${k} below ${lo}`).toBeGreaterThanOrEqual(lo);
        expect(v, `${p.nameKey}.${k} above ${hi}`).toBeLessThanOrEqual(hi);
      }
    });
  }

  it("compToStorage maps a profile to the content-script keys", () => {
    expect(compToStorage(COMP_PRESET_DEFAULTS[2])).toEqual({
      audioCompThreshold: -28,
      audioCompKnee: 30,
      audioCompRatio: 8,
      audioCompAttack: 0.01,
      audioCompRelease: 0.5,
    });
  });

  it("ships three distinct, all-pinned defaults", () => {
    const shapes = COMP_PRESET_DEFAULTS.map((p) => JSON.stringify({ ...p, pin: undefined }));
    expect(new Set(shapes).size).toBe(3);
    expect(COMP_PRESET_DEFAULTS.every((p) => p.pin)).toBe(true);
  });
});

describe("normalizeCompPresets", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(normalizeCompPresets(undefined)).toEqual(COMP_PRESET_DEFAULTS);
  });

  it("validates a stored list: clamps params, coerces pin, drops empty names", () => {
    const out = normalizeCompPresets([
      {
        threshold: -40,
        knee: 99,
        ratio: 8,
        attack: 0.01,
        release: 0.5,
        name: "  Speech  ",
        pin: 1,
      },
      { threshold: -20, knee: 10, ratio: 4, attack: 0, release: 0.3, name: "   ", pin: false },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].threshold).toBe(-40);
    expect(out[0].knee).toBe(40); // clamped to the [0,40] ceiling
    expect(out[0].name).toBe("Speech"); // trimmed
    expect(out[0].pin).toBe(false); // only `true` pins; truthy 1 is not
    expect(out[1].name).toBeUndefined(); // whitespace → no name
  });

  it("migrates the old keyed { voice, night, movie } shape into a pinned list", () => {
    const out = normalizeCompPresets({ voice: { threshold: -40, name: "Speech" } });
    expect(out).toHaveLength(3);
    expect(out[0].threshold).toBe(-40); // override applied
    expect(out[0].knee).toBe(COMP_PRESET_DEFAULTS[0].knee); // untouched default
    expect(out[0].name).toBe("Speech");
    expect(out[0].nameKey).toBe("presetVoice");
    expect(out.every((p) => p.pin)).toBe(true); // popup keeps showing all three
  });

  it("caps the pinned count at COMP_QUICK_COUNT, keeping the earliest", () => {
    const many = Array.from({ length: COMP_QUICK_COUNT + 2 }, () => ({
      threshold: -50,
      knee: 20,
      ratio: 5,
      attack: 0,
      release: 0.3,
      pin: true,
    }));
    const out = normalizeCompPresets(many);
    expect(out.filter((p) => p.pin)).toHaveLength(COMP_QUICK_COUNT);
    expect(out.slice(0, COMP_QUICK_COUNT).every((p) => p.pin)).toBe(true);
  });

  it("caps the list length at COMP_MAX_PRESETS", () => {
    const tooMany = Array.from({ length: COMP_MAX_PRESETS + 4 }, () => ({
      threshold: -50,
      knee: 20,
      ratio: 5,
      attack: 0,
      release: 0.3,
      pin: false,
    }));
    expect(normalizeCompPresets(tooMany)).toHaveLength(COMP_MAX_PRESETS);
  });

  it("falls back to defaults for an empty list", () => {
    expect(normalizeCompPresets([])).toEqual(COMP_PRESET_DEFAULTS);
  });

  it("clamps an optional preset gain and drops an invalid one", () => {
    const out = normalizeCompPresets([
      { threshold: -50, knee: 20, ratio: 5, attack: 0, release: 0.3, gain: 99, pin: false },
      { threshold: -50, knee: 20, ratio: 5, attack: 0, release: 0.3, gain: "x", pin: false },
      { threshold: -50, knee: 20, ratio: 5, attack: 0, release: 0.3, pin: false },
    ]);
    expect(out[0].gain).toBe(24); // clamped to the [0,24] ceiling
    expect(out[1].gain).toBeUndefined(); // non-numeric → no override
    expect(out[2].gain).toBeUndefined(); // absent → no override
  });
});
