import { describe, it, expect } from "vitest";
import { clamp, clampTarget, clampMax, clampNum } from "../src/content/core/clamp.js";
import { normalizeHost } from "../src/content/core/domain.js";
import { normalizeHost as popupNormalizeHost } from "../src/popup/core/domain.js";
import { debounce } from "../src/popup/core/debounce.js";

describe("clamp", () => {
  it("bounds speed to [0.1, 16] and rounds to 2dp", () => {
    expect(clamp(1)).toBe(1);
    expect(clamp(0)).toBe(0.1);
    expect(clamp(99)).toBe(16);
    expect(clamp(1.2345)).toBe(1.23);
  });
  it("clampTarget → [0,15] integer, default 5 on NaN", () => {
    expect(clampTarget(7.4)).toBe(7);
    expect(clampTarget(99)).toBe(15);
    expect(clampTarget(-3)).toBe(0);
    expect(clampTarget("nope")).toBe(5);
  });
  it("clampMax → [1.25,3], default 1.5 on NaN", () => {
    expect(clampMax(1.5)).toBe(1.5);
    expect(clampMax(1)).toBe(1.25);
    expect(clampMax(9)).toBe(3);
    expect(clampMax(undefined)).toBe(1.5);
  });
  it("clampNum → [lo,hi] with fallback", () => {
    expect(clampNum(5, 0, 10, 3)).toBe(5);
    expect(clampNum(-1, 0, 10, 3)).toBe(0);
    expect(clampNum("x", 0, 10, 3)).toBe(3);
  });
});

describe("normalizeHost (content == popup)", () => {
  const cases: [string, string][] = [
    ["www.twitch.tv", "twitch.tv"],
    ["m.youtube.com", "youtube.com"],
    ["twitch.tv", "twitch.tv"],
    ["docs.google.com", "docs.google.com"],
    ["alice.github.io", "alice.github.io"],
    ["mobile.twitter.com", "mobile.twitter.com"],
  ];
  it.each(cases)("%s → %s", (input, expected) => {
    expect(normalizeHost(input)).toBe(expected);
    expect(popupNormalizeHost(input)).toBe(expected); // must stay in sync
  });
});

describe("debounce", () => {
  it("fires once with the latest args after the delay", async () => {
    let calls = 0, lastArg = 0;
    const fn = debounce((n: number) => { calls++; lastArg = n; }, 20);
    fn(1); fn(2); fn(3);
    expect(calls).toBe(0);
    await new Promise((r) => setTimeout(r, 40));
    expect(calls).toBe(1);
    expect(lastArg).toBe(3);
  });
});
