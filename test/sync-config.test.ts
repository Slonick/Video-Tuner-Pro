import { describe, it, expect } from "vitest";
import {
  CATEGORIES, KEY_CATEGORY, KEYS_BY_CATEGORY, categoryOf, normalizeConfig,
  areaForCategory, areaForKey, groupKeysByArea, DEFAULT_SYNC,
} from "../src/shared/sync-config.js";

describe("categoryOf", () => {
  it("maps known keys to their category", () => {
    expect(categoryOf("globalSpeed")).toBe("speeds");
    expect(categoryOf("syncTargets")).toBe("delays");
    expect(categoryOf("audioCompRatio")).toBe("audio");
    expect(categoryOf("keymap")).toBe("shortcuts");
    expect(categoryOf("speedPresets")).toBe("presets");
  });
  it("falls back to general for unknown keys", () => {
    expect(categoryOf("somethingNew")).toBe("general");
    expect(categoryOf("badgePos")).toBe("general");
  });
});

describe("KEYS_BY_CATEGORY", () => {
  it("partitions every registered key exactly once", () => {
    const flat = CATEGORIES.flatMap((c) => KEYS_BY_CATEGORY[c]);
    expect(flat.sort()).toEqual(Object.keys(KEY_CATEGORY).sort());
  });
});

describe("normalizeConfig", () => {
  it("defaults missing categories to synced", () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_SYNC);
    expect(normalizeConfig({})).toEqual(DEFAULT_SYNC);
  });
  it("respects explicit booleans and ignores junk", () => {
    const cfg = normalizeConfig({ speeds: false, audio: false, bogus: 1, delays: "no" });
    expect(cfg.speeds).toBe(false);
    expect(cfg.audio).toBe(false);
    expect(cfg.delays).toBe(true); // non-boolean ignored → default
  });
});

describe("area routing", () => {
  it("sends synced categories to sync, opted-out to local", () => {
    const cfg = normalizeConfig({ speeds: false });
    expect(areaForCategory("speeds", cfg)).toBe("local");
    expect(areaForCategory("audio", cfg)).toBe("sync");
    expect(areaForKey("domains", cfg)).toBe("local");
    expect(areaForKey("audioComp", cfg)).toBe("sync");
  });
  it("groups a mixed key list by area", () => {
    const cfg = normalizeConfig({ speeds: false });
    const { sync, local } = groupKeysByArea(["domains", "audioComp", "globalSpeed"], cfg);
    expect(local.sort()).toEqual(["domains", "globalSpeed"]);
    expect(sync).toEqual(["audioComp"]);
  });
});
