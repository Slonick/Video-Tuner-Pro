// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
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

describe("ensureGlassFilter output", () => {
  afterEach(() => vi.unstubAllGlobals());

  const freshDoc = () => document.implementation.createHTMLDocument("t");

  it("builds a turbulence → blur → displacement chain that refracts the backdrop", () => {
    const doc = freshDoc();
    ensureGlassFilter(doc);
    const filter = doc.querySelector("filter#vtp-glass")!;
    const chain = [...filter.children].map((el) => ({
      name: el.localName,
      in: el.getAttribute("in"),
      in2: el.getAttribute("in2"),
      result: el.getAttribute("result"),
    }));
    expect(chain).toEqual([
      { name: "feTurbulence", in: null, in2: null, result: "noise" },
      { name: "feGaussianBlur", in: "noise", in2: null, result: "soft" },
      { name: "feDisplacementMap", in: "SourceGraphic", in2: "soft", result: null },
    ]);
  });

  it("puts the filter in <body> and the card backdrop rule in <head> of a document", () => {
    const doc = freshDoc();
    ensureGlassFilter(doc);
    expect(doc.querySelector("svg")!.parentNode).toBe(doc.body);
    const style = doc.querySelector("style")!;
    expect(style.parentNode).toBe(doc.head);
    const css = style.textContent!.replace(/\s+/g, "");
    expect(css).toContain(".sync-section,.card,.metercanvas{");
    expect(css).toContain(
      "-webkit-backdrop-filter:blur(var(--card-blur))saturate(var(--glass-saturate))!important;",
    );
    expect(css).toContain(
      ";backdrop-filter:blur(var(--card-blur))saturate(var(--glass-saturate))url(#vtp-glass)!important;",
    );
  });

  it("adds no card rule to a shadow root (its callers style inline)", () => {
    const sr = document.createElement("div").attachShadow({ mode: "open" });
    ensureGlassFilter(sr);
    expect(sr.querySelector("svg")!.parentNode).toBe(sr);
    expect(sr.querySelector("style")).toBeNull();
  });

  it("injects nothing when the filter markup fails to parse", () => {
    const RealParser = DOMParser;
    vi.stubGlobal(
      "DOMParser",
      class {
        parseFromString() {
          return new RealParser().parseFromString("<parsererror/>", "application/xml");
        }
      },
    );
    const doc = freshDoc();
    ensureGlassFilter(doc);
    expect(doc.body.children).toHaveLength(0);
    expect(doc.querySelector("style")).toBeNull();
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
