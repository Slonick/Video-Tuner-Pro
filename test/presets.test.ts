import { describe, it, expect, vi, afterEach } from "vitest";
import {
  normalizePresets,
  normalizePresetSet,
  normalizeSpeedMax,
  normalizeSpeedStep,
  normalizeHoldSpeed,
  quickPresetIndices,
  DEFAULT_PRESETS,
  DEFAULT_PRESET_KEYS,
  MAX_PRESETS,
} from "../src/shared/presets.js";
import {
  normalizeKeymap,
  normalizeSeekStep,
  isBindableCode,
  codeLabel,
  formatChord,
  parseChord,
  eventChord,
  eventMatchesChord,
  eventMatchesSpec,
  actionConflictsWithSpec,
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
  it("ignores non-numeric entries instead of turning them into a preset", () => {
    expect(normalizePresets(["x", 100])).toEqual([100]);
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

describe("normalizeSeekStep", () => {
  it("defaults to 10 s and clamps whole seconds to [1, 60]", () => {
    expect(normalizeSeekStep(undefined)).toBe(10);
    expect(normalizeSeekStep("abc")).toBe(10);
    expect(normalizeSeekStep(0)).toBe(1);
    expect(normalizeSeekStep(999)).toBe(60);
    expect(normalizeSeekStep(4.6)).toBe(5);
  });
});

describe("normalizeKeymap", () => {
  it("defaults missing/invalid bindings", () => {
    expect(normalizeKeymap(undefined)).toEqual(DEFAULT_KEYMAP);
    expect(normalizeKeymap("bad")).toEqual(DEFAULT_KEYMAP);
  });
  it("accepts valid bindable codes", () => {
    expect(normalizeKeymap({ slower: "KeyJ", faster: "KeyK", reset: "Digit0" })).toEqual({
      ...DEFAULT_KEYMAP,
      slower: "KeyJ",
      faster: "KeyK",
      reset: "Digit0",
      viewer: "",
      theater: "",
      chat: "",
    });
  });
  it("does not add viewer or chat shortcuts to an existing stored keymap", () => {
    const km = normalizeKeymap({
      slower: "KeyJ",
      faster: "KeyK",
      reset: "Digit0",
      toggle: "KeyS",
      hold: "KeyX",
      overlay: "KeyO",
    });
    expect(km.viewer).toBe("");
    expect(km.theater).toBe("");
    expect(km.chat).toBe("");
  });
  it("keeps a stored chat binding and defaults chat only for fresh installs", () => {
    expect(normalizeKeymap({ slower: "KeyJ", chat: "KeyH" }).chat).toBe("KeyH");
    expect(normalizeKeymap(undefined).chat).toBe(DEFAULT_KEYMAP.chat);
  });
  it("drops a duplicate binding back to its default", () => {
    const km = normalizeKeymap({ slower: "KeyZ", faster: "KeyZ" });
    expect(km.slower).toBe("KeyZ");
    expect(km.faster).not.toBe("KeyZ");
  });
  it("keeps a core action bound when a corrupt blob duplicates its default key", () => {
    const km = normalizeKeymap({ slower: "KeyD", faster: "KeyD" });
    expect(km.slower).toBe("KeyA");
    expect(km.faster).toBe("KeyD");
  });
  it("keeps later core actions bound when a corrupt blob duplicates their default key", () => {
    const km = normalizeKeymap({ reset: "KeyV", viewer: "KeyV" });
    expect(km.reset).toBe("KeyR");
    expect(km.viewer).toBe("KeyV");
  });
  it("keeps a later core action bound when a partial blob takes its default key", () => {
    const km = normalizeKeymap({ slower: "KeyD" });
    expect(km.slower).toBe("KeyA");
    expect(km.faster).toBe("KeyD");
  });
  it("does not let a default binding shadow a later stored action", () => {
    const km = normalizeKeymap({ reset: "KeyO", viewer: "KeyV", theater: "KeyT" });
    expect(km.reset).toBe("KeyO");
    expect(km.overlay).toBe("");
  });
  it("binds Q / E seek keys for an existing stored keymap", () => {
    const km = normalizeKeymap({ slower: "KeyJ", faster: "KeyK", chat: "" });
    expect(km.rewind).toBe("KeyQ");
    expect(km.advance).toBe("KeyE");
  });
  it("leaves a seek key unbound when the user already uses its default", () => {
    const km = normalizeKeymap({ slower: "KeyQ", reset: "KeyE" });
    expect(km.slower).toBe("KeyQ");
    expect(km.reset).toBe("KeyE");
    expect(km.rewind).toBe("");
    expect(km.advance).toBe("");
  });
  it("ships the documented default bindings on a fresh install", () => {
    expect(normalizeKeymap(undefined)).toEqual({
      slower: "KeyA",
      faster: "KeyD",
      reset: "KeyR",
      toggle: "KeyS",
      hold: "KeyX",
      overlay: "KeyO",
      viewer: "KeyV",
      theater: "KeyT",
      chat: "KeyC",
      rewind: "KeyQ",
      advance: "KeyE",
    });
  });
  it("treats a stored null like nothing stored", () => {
    expect(normalizeKeymap(null)).toEqual(normalizeKeymap(undefined));
  });
  it("rejects non-string bindings even if they stringify to a bindable code", () => {
    const km = normalizeKeymap({ slower: ["KeyJ"], faster: 7 });
    expect(km.slower).toBe("KeyA");
    expect(km.faster).toBe("KeyD");
  });
  it("lets an action take another's default key when that action is explicitly unbound", () => {
    const km = normalizeKeymap({ slower: "KeyD", faster: "" });
    expect(km.slower).toBe("KeyD");
    expect(km.faster).toBe("");
  });
  it("lets an action take another's default key when that action is rebound elsewhere", () => {
    const km = normalizeKeymap({ slower: "KeyD", faster: "KeyK" });
    expect(km.slower).toBe("KeyD");
    expect(km.faster).toBe("KeyK");
  });
  it("yields a default key back to its owner when the owner's stored binding is invalid", () => {
    const km = normalizeKeymap({ slower: "KeyD", faster: "Space" });
    expect(km.slower).toBe("KeyA");
    expect(km.faster).toBe("KeyD");
  });
  it("yields a default key back to its owner when the owner's stored binding is not a string", () => {
    const km = normalizeKeymap({ slower: "KeyD", faster: ["KeyK"] });
    expect(km.slower).toBe("KeyA");
    expect(km.faster).toBe("KeyD");
  });
  it("keeps a stored binding over a later action's default when that action isn't stored", () => {
    const km = normalizeKeymap({ slower: "KeyR" });
    expect(km.slower).toBe("KeyR");
    expect(km.reset).toBe("");
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
  it("isBindableCode / codeLabel only accept a whole letter or digit code", () => {
    for (const code of ["xKeyA", "KeyAB", "Digit10", "NumDigit1"]) {
      expect(isBindableCode(code)).toBe(false);
      expect(codeLabel(code)).toBe(code);
    }
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
  it("eventMatchesChord reuses a parsed chord without reparsing the stored spec", () => {
    const chord = parseChord("S+Digit1");
    expect(eventMatchesChord(chord, ev("Digit1", { shiftKey: true }))).toBe(true);
    expect(eventMatchesChord(chord, ev("Digit1"))).toBe(false);
    expect(eventMatchesChord(null, ev("Digit1", { shiftKey: true }))).toBe(false);
  });
  it("detects preset/action conflicts without shadowing shifted speed-step chords", () => {
    expect(actionConflictsWithSpec("slower", "KeyA", "S+KeyA")).toBe(false);
    expect(actionConflictsWithSpec("slower", "KeyA", "KeyA")).toBe(true);
    expect(actionConflictsWithSpec("slower", "KeyA", "M+KeyA")).toBe(false);
    expect(actionConflictsWithSpec("reset", "KeyR", "S+KeyR")).toBe(false);
    expect(actionConflictsWithSpec("reset", "KeyR", "KeyR")).toBe(true);
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
  it("formatChord writes every modifier in the fixed S+M+A order", () => {
    expect(formatChord({ code: "KeyM", shift: true, mod: true, alt: true })).toBe("S+M+A+KeyM");
    expect(formatChord({ code: "KeyM", shift: false, mod: true, alt: false })).toBe("M+KeyM");
    expect(formatChord({ code: "KeyM", shift: false, mod: false, alt: true })).toBe("A+KeyM");
  });
  it("eventMatchesSpec requires Alt to match exactly", () => {
    expect(eventMatchesSpec("A+KeyG", ev("KeyG", { altKey: true }))).toBe(true);
    expect(eventMatchesSpec("A+KeyG", ev("KeyG"))).toBe(false);
    expect(eventMatchesSpec("KeyG", ev("KeyG", { altKey: true }))).toBe(false);
  });
  it("reports no conflict for another key, no chord, or an unbound action", () => {
    expect(actionConflictsWithSpec("slower", "KeyA", "KeyB")).toBe(false);
    expect(actionConflictsWithSpec("slower", "KeyA", null)).toBe(false);
    expect(actionConflictsWithSpec("slower", "", "KeyA")).toBe(false);
  });
});

// IS_MAC is resolved once at import, so each case re-imports the module under a
// stubbed navigator.
describe("platform detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  const load = async (nav: unknown) => {
    vi.resetModules();
    vi.stubGlobal("navigator", nav);
    return import("../src/shared/keymap.js");
  };

  it("detects a Mac from navigator.platform", async () => {
    expect((await load({ platform: "MacIntel" })).IS_MAC).toBe(true);
    expect((await load({ platform: "Win32" })).IS_MAC).toBe(false);
  });
  it("prefers userAgentData.platform over navigator.platform", async () => {
    expect((await load({ userAgentData: { platform: "macOS" }, platform: "Win32" })).IS_MAC).toBe(
      true,
    );
    expect((await load({ userAgentData: { platform: "macOS" }, platform: "" })).IS_MAC).toBe(true);
    expect(
      (await load({ userAgentData: { platform: "Windows" }, platform: "MacIntel" })).IS_MAC,
    ).toBe(false);
  });
  it("is not a Mac without a navigator or a platform", async () => {
    expect((await load(undefined)).IS_MAC).toBe(false);
    expect((await load({})).IS_MAC).toBe(false);
  });
  it("maps the mod chord to ⌘ on Mac and Ctrl elsewhere", async () => {
    const mac = await load({ platform: "MacIntel" });
    expect(mac.eventMatchesSpec("M+KeyG", ev("KeyG", { metaKey: true }))).toBe(true);
    expect(mac.eventMatchesSpec("M+KeyG", ev("KeyG", { ctrlKey: true }))).toBe(false);
    const win = await load({ platform: "Win32" });
    expect(win.eventMatchesSpec("M+KeyG", ev("KeyG", { ctrlKey: true }))).toBe(true);
    expect(win.eventMatchesSpec("M+KeyG", ev("KeyG", { metaKey: true }))).toBe(false);
  });
});

describe("normalizePresetSet", () => {
  it("keeps keys and pins on their own preset when a stored value is not a number", () => {
    const { presets, keys, pinned } = normalizePresetSet(
      ["x", 150, 200],
      ["S+Digit1", "S+Digit2", "S+Digit3"],
      [true, false, true],
    );
    expect(presets).toEqual([150, 200]);
    expect(keys).toEqual(["S+Digit2", "S+Digit3"]);
    expect(pinned).toEqual([false, true]);
  });
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
  it("ignores non-numeric stored values instead of turning them into a preset", () => {
    const { presets } = normalizePresetSet(["x", 150], []);
    expect(presets).toEqual([150]);
  });
  it("keeps at most MAX_PRESETS presets", () => {
    const { presets, keys, pinned } = normalizePresetSet(new Array(20).fill(100), [], []);
    expect(presets).toHaveLength(MAX_PRESETS);
    expect(keys).toHaveLength(MAX_PRESETS);
    expect(pinned).toHaveLength(MAX_PRESETS);
  });
  it("ships ⇧1…⇧9 for the nine lowest default presets and no key for the rest", () => {
    expect(DEFAULT_PRESET_KEYS).toEqual([
      ...Array.from({ length: 9 }, (_, i) => `S+Digit${i + 1}`),
      ...Array(DEFAULT_PRESETS.length - 9).fill(null),
    ]);
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
  it("never repeats a pinned index when padding the row", () => {
    expect(quickPresetIndices([true, false, false, false, false])).toEqual([0, 1, 2, 3]);
  });
});
