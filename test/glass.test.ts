// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  clampGlassOpacity,
  applyGlassOpacity,
  ensureGlassFilter,
  DEFAULT_GLASS_OPACITY,
  GLASS_OPACITY_MIN,
  GLASS_OPACITY_MAX,
} from "../src/shared/glass.js";

describe("ensureGlassFilter", () => {
  it("injects the displacement filter once into a document (idempotent)", () => {
    const count = () => document.querySelectorAll("svg filter").length;
    ensureGlassFilter(document);
    const after1 = count();
    expect(after1).toBeGreaterThanOrEqual(1);
    ensureGlassFilter(document); // already present → no duplicate
    expect(count()).toBe(after1);
  });

  it("injects into a shadow root too", () => {
    const sr = document.createElement("div").attachShadow({ mode: "open" });
    ensureGlassFilter(sr);
    expect(sr.querySelector("svg")).toBeTruthy();
  });
});

describe("clampGlassOpacity", () => {
  it("falls back to the default for non-numeric input", () => {
    expect(clampGlassOpacity("nope")).toBe(DEFAULT_GLASS_OPACITY);
    expect(clampGlassOpacity(undefined)).toBe(DEFAULT_GLASS_OPACITY);
    expect(clampGlassOpacity(NaN)).toBe(DEFAULT_GLASS_OPACITY);
  });

  it("clamps to the [min, max] range", () => {
    expect(clampGlassOpacity(0)).toBe(GLASS_OPACITY_MIN);
    expect(clampGlassOpacity(5)).toBe(GLASS_OPACITY_MAX);
  });

  it("passes an in-range value through (number or numeric string)", () => {
    expect(clampGlassOpacity(0.8)).toBe(0.8);
    expect(clampGlassOpacity("1.2")).toBe(1.2);
  });
});

describe("applyGlassOpacity", () => {
  it("sets the --glass-opacity custom property on the element", () => {
    const el = document.createElement("div");
    applyGlassOpacity(el, 0.7);
    expect(el.style.getPropertyValue("--glass-opacity")).toBe("0.7");
  });
});
