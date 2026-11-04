// @vitest-environment jsdom
// Firefox renders backdrop-filter blur but NOT an SVG `url(#…)` filter inside it,
// and one unsupported token drops the WHOLE declaration → no blur. glass.ts must
// therefore omit the refraction token on Gecko (keeping blur) and keep it elsewhere.
import { describe, it, expect, vi, afterEach } from "vitest";

const setUA = (v: string) =>
  Object.defineProperty(navigator, "userAgent", { value: v, configurable: true });

describe("glass refraction gating", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("drops the SVG url() refraction on Firefox so the blur survives", async () => {
    setUA("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0");
    vi.resetModules();
    const { GLASS_REFRACTION } = await import("../src/shared/glass.js");
    expect(GLASS_REFRACTION).toBe("");
  });

  it("keeps the refraction on Chromium (UA says 'like Gecko', not 'Gecko/')", async () => {
    setUA(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    );
    vi.resetModules();
    const { GLASS_REFRACTION } = await import("../src/shared/glass.js");
    expect(GLASS_REFRACTION).toContain("url(#vtp-glass)");
  });

  it("keeps the refraction where there is no navigator to sniff", async () => {
    vi.stubGlobal("navigator", undefined);
    vi.resetModules();
    const { GLASS_REFRACTION } = await import("../src/shared/glass.js");
    expect(GLASS_REFRACTION).toContain("url(#vtp-glass)");
  });
});
