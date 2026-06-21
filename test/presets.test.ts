import { describe, it, expect } from "vitest";
import {
  normalizePresets,
  normalizePresetSet,
  normalizeSpeedMax,
  normalizeSpeedStep,
  normalizeHoldSpeed,
  presetFractions,
  quickPresetIndices,
  DEFAULT_PRESETS,
  MAX_PRESETS,
} from "../src/shared/presets.js";
import {
  normalizeKeymap,
  isBindableCode,
  codeLabel,
  formatChord,
  parseChord,
  eventChord,
  eventMatchesSpec,
  chordLabel,
  IS_MAC,
  DEFAULT_KEYMAP,
} from "../src/shared/keymap.js";

// The running platform's primary modifier key (⌘ on Mac, Ctrl elsewhere) and the
// blocked secondary one — so these tests pass on either OS.
const PRIMARY: "metaKey" | "ctrlKey" = IS_MAC ? "metaKey" : "ctrlKey";
const SECONDARY: "metaKey" | "ctrlKey" = IS_MAC ? "ctrlKey" : "metaKey";

// A minimal KeyboardEvent-like for the pure matchers (no DOM env needed).
const ev = (code: string, mods: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({
    code,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
  }) as KeyboardEvent;

describe("normalizePresets", () => {
  it("returns the defaults, sorted, for empty/invalid input", () => {
    expect(normalizePresets(undefined)).toEqual([...DEFAULT_PRESETS].sort((a, b) => a - b));
    expect(normalizePresets("nope")).toEqual(DEFAULT_PRESETS);
  });
  it("yields one sorted value per provided entry", () => {
    const out = normalizePresets([300, 25, 100]);
    expect(out).toEqual([25, 100, 300]);
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
  it("keeps the provided count, clamped to [1, MAX_PRESETS]", () => {
    expect(normalizePresets([60])).toEqual([60]); // one in, one out
    expect(normalizePresets(new Array(20).fill(100))).toHaveLength(MAX_PRESETS);
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

describe("normalizeSpeedStep", () => {
  it("defaults to 5% for missing / invalid input", () => {
    expect(normalizeSpeedStep(undefined)).toBe(5);
    expect(normalizeSpeedStep("nope")).toBe(5);
  });
  it("clamps to [1, 50] and rounds to an integer", () => {
    expect(normalizeSpeedStep(0)).toBe(1);
    expect(normalizeSpeedStep(999)).toBe(50);
    expect(normalizeSpeedStep(7.4)).toBe(7);
  });
});

describe("normalizeHoldSpeed", () => {
  it("defaults to 200% for missing / invalid input", () => {
    expect(normalizeHoldSpeed(undefined)).toBe(200);
    expect(normalizeHoldSpeed("nope")).toBe(200);
  });
  it("clamps to [25, 1600] and snaps to the 5% step", () => {
    expect(normalizeHoldSpeed(10)).toBe(25);
    expect(normalizeHoldSpeed(99999)).toBe(1600);
    expect(normalizeHoldSpeed(143)).toBe(145);
  });
});

describe("normalizeKeymap", () => {
  it("defaults missing/invalid bindings", () => {
    expect(normalizeKeymap(undefined)).toEqual(DEFAULT_KEYMAP);
    expect(normalizeKeymap({ slower: "Shift", faster: 42 })).toEqual(DEFAULT_KEYMAP);
  });
  it("accepts valid bindable codes", () => {
    expect(normalizeKeymap({ slower: "KeyJ", faster: "KeyK", reset: "Digit0" })).toEqual({
      ...DEFAULT_KEYMAP,
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

// Tests run in a non-Mac env (navigator.platform empty), so the primary modifier
// resolves to Ctrl and the Meta/Win key is the blocked secondary.
describe("key chords", () => {
  it("formatChord / parseChord round-trip with modifiers", () => {
    const chord = { code: "Digit1", shift: true, mod: false, alt: false };
    expect(formatChord(chord)).toBe("S+Digit1");
    expect(parseChord("S+Digit1")).toEqual(chord);
    expect(parseChord("M+A+KeyM")).toEqual({ code: "KeyM", shift: false, mod: true, alt: true });
  });
  it("parseChord reads the legacy 'C' (Ctrl) prefix as the primary modifier", () => {
    expect(parseChord("C+KeyM")).toEqual({ code: "KeyM", shift: false, mod: true, alt: false });
  });
  it("parseChord rejects malformed / unbindable specs", () => {
    expect(parseChord("Space")).toBe(null);
    expect(parseChord("X+KeyA")).toBe(null);
    expect(parseChord("")).toBe(null);
    expect(parseChord(42)).toBe(null);
  });
  it("eventChord reads an event; the primary key is mod, the secondary is rejected", () => {
    expect(eventChord(ev("KeyA", { shiftKey: true }))).toEqual({
      code: "KeyA",
      shift: true,
      mod: false,
      alt: false,
    });
    expect(eventChord(ev("KeyG", { [PRIMARY]: true }))).toEqual({
      code: "KeyG",
      shift: false,
      mod: true,
      alt: false,
    });
    expect(eventChord(ev("Space"))).toBe(null);
    expect(eventChord(ev("KeyA", { [SECONDARY]: true }))).toBe(null); // secondary modifier blocked
  });
  it("eventMatchesSpec resolves the primary modifier to this platform's key", () => {
    expect(eventMatchesSpec("S+Digit1", ev("Digit1", { shiftKey: true }))).toBe(true);
    expect(eventMatchesSpec("S+Digit1", ev("Digit1"))).toBe(false);
    // A "mod" chord (set as ⌘ on a Mac / Ctrl on Win) matches the running OS's
    // primary key — so it's portable across OSes after sync.
    expect(eventMatchesSpec("M+KeyG", ev("KeyG", { [PRIMARY]: true }))).toBe(true);
    expect(eventMatchesSpec("M+KeyG", ev("KeyG", { [SECONDARY]: true }))).toBe(false);
    expect(eventMatchesSpec("KeyG", ev("KeyG", { [SECONDARY]: true }))).toBe(false);
    expect(eventMatchesSpec(null, ev("KeyG"))).toBe(false);
  });
  it("chordLabel renders per the requested platform", () => {
    expect(chordLabel("S+Digit1", true)).toBe("⇧1");
    expect(chordLabel("S+Digit1", false)).toBe("⇧1");
    expect(chordLabel("M+KeyM", true)).toBe("⌘M");
    expect(chordLabel("M+KeyM", false)).toBe("Ctrl+M");
    expect(chordLabel("M+A+KeyM", true)).toBe("⌘⌥M");
    expect(chordLabel("M+A+KeyM", false)).toBe("Ctrl+Alt+M");
    expect(chordLabel(null, true)).toBe("");
  });
});

describe("normalizePresetSet", () => {
  it("keeps each key + pin attached to its value when sorting", () => {
    const { presets, keys, pinned } = normalizePresetSet(
      [200, 100],
      ["KeyB", "KeyA"],
      [true, false],
    );
    expect(presets).toEqual([100, 200]);
    expect(keys[presets.indexOf(100)]).toBe("KeyA");
    expect(keys[presets.indexOf(200)]).toBe("KeyB");
    expect(pinned[presets.indexOf(200)]).toBe(true); // the pin travelled with 200
    expect(pinned[presets.indexOf(100)]).toBe(false);
  });
  it("drops a duplicate key, keeping the lower-valued preset's", () => {
    const { presets, keys } = normalizePresetSet([100, 200], ["KeyA", "KeyA"]);
    expect(keys[presets.indexOf(100)]).toBe("KeyA");
    expect(keys[presets.indexOf(200)]).toBe(null);
  });
  it("falls back to the default keys when none are stored", () => {
    const { keys, presets } = normalizePresetSet(undefined, undefined);
    expect(presets).toEqual([...DEFAULT_PRESETS].sort((a, b) => a - b));
    expect(keys[0]).toBe("S+Digit1");
  });
  it("coerces invalid stored keys to null", () => {
    const { presets, keys } = normalizePresetSet([100], ["Space"]);
    expect(keys[presets.indexOf(100)]).toBe(null);
  });
  it("pins the default values when no pins are stored", () => {
    const { presets, pinned } = normalizePresetSet(undefined, undefined);
    for (const v of [50, 100, 175, 250]) expect(pinned[presets.indexOf(v)]).toBe(true);
    expect(pinned.filter(Boolean)).toHaveLength(4);
  });
  it("honors an explicit empty pin array (nothing pinned)", () => {
    const { pinned } = normalizePresetSet([50, 100], [null, null], [false, false]);
    expect(pinned).toEqual([false, false]);
  });
  it("caps the pinned presets at eight (two quick rows), keeping the lowest values", () => {
    const vals = [50, 100, 150, 200, 250, 300, 350, 400, 450]; // nine pinned
    const { presets, pinned } = normalizePresetSet(
      vals,
      vals.map(() => null),
      vals.map(() => true),
    );
    expect(pinned.filter(Boolean)).toHaveLength(8);
    expect(pinned[presets.indexOf(450)]).toBe(false); // the highest got dropped
  });
});

describe("quickPresetIndices", () => {
  it("includes the pinned indices and fills to four, sorted", () => {
    // pins at 4 & 5 are kept; fill with the two lowest unpinned (0, 1)
    expect(quickPresetIndices([false, false, false, false, true, true])).toEqual([0, 1, 4, 5]);
  });
  it("fills with the lowest unpinned up to four when fewer are pinned", () => {
    // none pinned → first four
    expect(quickPresetIndices([false, false, false, false, false])).toEqual([0, 1, 2, 3]);
    // one high pin (index 5) + three lowest unpinned (0,1,2)
    const pinned = [false, false, false, false, false, true];
    expect(quickPresetIndices(pinned)).toEqual([0, 1, 2, 5]);
  });
  it("shows all pinned (no padding) when more than four are pinned, up to eight", () => {
    // six pinned → a full second row, no unpinned padding
    expect(quickPresetIndices([true, true, true, true, true, true, false, false])).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    // capped at eight even if more are pinned
    expect(quickPresetIndices(Array(10).fill(true))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
