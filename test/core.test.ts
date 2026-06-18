import { describe, it, expect } from "vitest";
import { clamp, clampTarget, clampNum, resolveTarget } from "../src/content/core/clamp.js";
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
  it("clampTarget → [1,30] integer, default 5 on NaN", () => {
    expect(clampTarget(7.4)).toBe(7);
    expect(clampTarget(99)).toBe(30);
    expect(clampTarget(0)).toBe(1);
    expect(clampTarget(-3)).toBe(1);
    expect(clampTarget("nope")).toBe(5);
  });
  it("clampNum → [lo,hi] with fallback", () => {
    expect(clampNum(5, 0, 10, 3)).toBe(5);
    expect(clampNum(-1, 0, 10, 3)).toBe(0);
    expect(clampNum("x", 0, 10, 3)).toBe(3);
  });
  it("resolveTarget → per-site value, else legacy, else 5 (all clamped)", () => {
    expect(resolveTarget({ "a.com": 10 }, "a.com")).toBe(10); // per-site wins
    expect(resolveTarget({ "a.com": 10 }, "b.com", 8)).toBe(8); // unset domain → legacy
    expect(resolveTarget({}, "a.com", 8)).toBe(8); // empty map → legacy
    expect(resolveTarget({}, "a.com")).toBe(5); // nothing → default
    expect(resolveTarget(undefined, "a.com")).toBe(5); // no map at all
    expect(resolveTarget({ "a.com": 99 }, "a.com")).toBe(30); // clamped to the cap
    expect(resolveTarget({ "a.com": 0 }, "a.com")).toBe(1); // clamped to the floor
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
    let calls = 0,
      lastArg = 0;
    const fn = debounce((n: number) => {
      calls++;
      lastArg = n;
    }, 20);
    fn(1);
    fn(2);
    fn(3);
    expect(calls).toBe(0);
    await new Promise((r) => setTimeout(r, 40));
    expect(calls).toBe(1);
    expect(lastArg).toBe(3);
  });
});
