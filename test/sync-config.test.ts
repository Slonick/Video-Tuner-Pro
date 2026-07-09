import { describe, it, expect } from "vitest";
import {
  CATEGORIES,
  KEY_CATEGORY,
  KEYS_BY_CATEGORY,
  categoryOf,
  normalizeConfig,
  areaForCategory,
  areaForKey,
  groupKeysByArea,
  DEFAULT_SYNC,
  ALL_LOCAL,
  effectiveConfig,
} from "../src/shared/sync-config.js";

describe("categoryOf", () => {
  it("maps known keys to their category", () => {
    expect(categoryOf("globalSpeed")).toBe("speeds");
    expect(categoryOf("syncTargets")).toBe("delays");
    expect(categoryOf("audioCompRatio")).toBe("audio");
    expect(categoryOf("compPresets")).toBe("audio");
    expect(categoryOf("keymap")).toBe("shortcuts");
    expect(categoryOf("theme")).toBe("general");
    expect(categoryOf("speedPresets")).toBe("speeds");
    expect(categoryOf("speedMax")).toBe("speeds");
    expect(categoryOf("speedStep")).toBe("speeds");
    expect(categoryOf("holdSpeed")).toBe("speeds");
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

  it("includes general settings that category migration must carry between areas", () => {
    expect(KEYS_BY_CATEGORY.general).toEqual(
      expect.arrayContaining(["glassOpacity", "sponsorMarks", "overlayPanelPos"]),
    );
  });
});

describe("effectiveConfig", () => {
  it("returns the per-category preferences when the master switch is on", () => {
    const prefs = { ...DEFAULT_SYNC, speeds: false };
    expect(effectiveConfig(prefs, true)).toEqual(prefs);
  });

  it("forces every category local when the master switch is off", () => {
    expect(effectiveConfig({ ...DEFAULT_SYNC }, false)).toEqual(ALL_LOCAL);
    expect(ALL_LOCAL).toEqual(CATEGORIES.reduce((a, c) => ({ ...a, [c]: false }), {}));
  });

  it("does not mutate its input", () => {
    const prefs = { ...DEFAULT_SYNC };
    effectiveConfig(prefs, false);
    effectiveConfig(prefs, true);
    expect(prefs).toEqual(DEFAULT_SYNC);
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
  it("keeps sync routing metadata local even when general settings sync", () => {
    const cfg = normalizeConfig({ general: true });
    expect(areaForKey("syncCategories", cfg)).toBe("local");
    expect(areaForKey("syncMaster", cfg)).toBe("local");
  });
  it("groups a mixed key list by area", () => {
    const cfg = normalizeConfig({ speeds: false });
    const { sync, local } = groupKeysByArea(["domains", "audioComp", "globalSpeed"], cfg);
    expect(local.sort()).toEqual(["domains", "globalSpeed"]);
    expect(sync).toEqual(["audioComp"]);
  });
});
