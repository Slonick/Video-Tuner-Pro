// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockChrome } from "./mocks/chrome.js";

// Fresh theme module over a fresh chrome mock (so the routed STORE re-inits and
// reads the seeded settings).
async function fresh(settings: Record<string, unknown> = {}) {
  (globalThis as unknown as { chrome: typeof chrome; browser?: unknown }).chrome = createMockChrome(
    { settings },
  );
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  vi.resetModules();
  return import("../src/shared/theme.js");
}

describe("theme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("applyTheme sets data-theme for explicit themes and clears it for system", async () => {
    const { applyTheme } = await fresh();
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    applyTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("initTheme applies the saved theme", async () => {
    const { initTheme } = await fresh({ theme: "dark" });
    initTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("initTheme falls back to system (no attribute) when nothing is saved", async () => {
    const { initTheme } = await fresh({});
    initTheme();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("setTheme applies immediately and persists the choice", async () => {
    const { setTheme } = await fresh({});
    setTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    let got: Record<string, unknown> = {};
    (globalThis.chrome.storage.sync as chrome.storage.StorageArea).get(["theme"], (r) => {
      got = r;
    });
    expect(got.theme).toBe("light");
  });
});
