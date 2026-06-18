import { describe, it, expect } from "vitest";
import {
  normalizePresets,
  normalizeSpeedMax,
  presetFractions,
  DEFAULT_PRESETS,
  PRESET_COUNT,
} from "../src/shared/presets.js";
import {
  normalizeKeymap,
  isBindableCode,
  codeLabel,
  DEFAULT_KEYMAP,
} from "../src/shared/keymap.js";

describe("normalizePresets", () => {
  it("returns the defaults, sorted, for empty/invalid input", () => {
    expect(normalizePresets(undefined)).toEqual([...DEFAULT_PRESETS].sort((a, b) => a - b));
    expect(normalizePresets("nope")).toEqual(DEFAULT_PRESETS);
  });
  it("always yields exactly PRESET_COUNT values, sorted ascending", () => {
    const out = normalizePresets([300, 25, 100]);
    expect(out).toHaveLength(PRESET_COUNT);
    expect([...out]).toEqual([...out].sort((a, b) => a - b));
  });
  it("clamps to the allowed range and snaps to the 5% step", () => {
    const out = normalizePresets([5, 9999, 142, 143]);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(25);
    expect(Math.max(...out)).toBeLessThanOrEqual(1600);
    expect(out.every((v) => v % 5 === 0)).toBe(true);
    expect(out).toContain(140); // 142 → 140
    expect(out).toContain(145); // 143 → 145
    expect(out).toContain(1600); // 9999 → 1600 (absolute ceiling)
  });
  it("fills missing slots from the defaults at that index", () => {
    const out = normalizePresets([60]); // only one provided
    expect(out).toHaveLength(PRESET_COUNT);
    expect(out).toContain(60);
  });
  it("presetFractions divides by 100", () => {
    expect(presetFractions([100, 200])).toContain(1);
    expect(presetFractions([100, 200])).toContain(2);
  });
});

describe("normalizeSpeedMax", () => {
  it("defaults to 500% for missing / invalid input", () => {
    expect(normalizeSpeedMax(undefined)).toBe(500);
    expect(normalizeSpeedMax("nope")).toBe(500);
  });
  it("clamps to [100, 1600] and snaps to the 25% step", () => {
    expect(normalizeSpeedMax(10)).toBe(100); // below floor
    expect(normalizeSpeedMax(99999)).toBe(1600); // above ceiling
    expect(normalizeSpeedMax(400)).toBe(400);
    expect(normalizeSpeedMax(513)).toBe(525); // 513 → nearest 25-step
  });
});

describe("normalizeKeymap", () => {
  it("defaults missing/invalid bindings", () => {
    expect(normalizeKeymap(undefined)).toEqual(DEFAULT_KEYMAP);
    expect(normalizeKeymap({ slower: "Shift", faster: 42 })).toEqual(DEFAULT_KEYMAP);
  });
  it("accepts valid bindable codes", () => {
    expect(normalizeKeymap({ slower: "KeyJ", faster: "KeyK", reset: "Digit0" })).toEqual({
      slower: "KeyJ",
      faster: "KeyK",
      reset: "Digit0",
    });
  });
  it("drops a duplicate binding back to its default", () => {
    const km = normalizeKeymap({ slower: "KeyZ", faster: "KeyZ" });
    expect(km.slower).toBe("KeyZ");
    expect(km.faster).not.toBe("KeyZ");
  });
});

describe("keymap helpers", () => {
  it("isBindableCode accepts letters and digits only", () => {
    expect(isBindableCode("KeyA")).toBe(true);
    expect(isBindableCode("Digit5")).toBe(true);
    expect(isBindableCode("Space")).toBe(false);
    expect(isBindableCode("ArrowUp")).toBe(false);
  });
  it("codeLabel humanises codes", () => {
    expect(codeLabel("KeyA")).toBe("A");
    expect(codeLabel("Digit3")).toBe("3");
    expect(codeLabel("Space")).toBe("Space");
  });
});
