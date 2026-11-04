// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

// The on-video overlay iframe gets `#vtp-<host scheme>-<os scheme>` from the launcher.
describe("initTheme in the overlay iframe", () => {
  const realParent = Object.getOwnPropertyDescriptor(window, "parent")!;
  const root = document.documentElement;

  function frame(hash: string, embedded: boolean) {
    history.replaceState(null, "", hash);
    if (embedded) Object.defineProperty(window, "parent", { value: {}, configurable: true });
  }

  beforeEach(() => {
    root.removeAttribute("data-theme");
    root.style.colorScheme = "";
  });

  afterEach(() => {
    Object.defineProperty(window, "parent", realParent);
    history.replaceState(null, "", location.pathname);
  });

  it("matches the host's color-scheme and lets 'system' follow the passed OS scheme", async () => {
    const { initTheme } = await fresh({});
    frame("#vtp-dark-light", true);
    initTheme();
    expect(root.style.colorScheme).toBe("dark");
    expect(root.getAttribute("data-theme")).toBe("light");
  });

  it("an explicit saved theme wins over the passed OS scheme", async () => {
    const { initTheme } = await fresh({ theme: "dark" });
    frame("#vtp-light-light", true);
    initTheme();
    expect(root.style.colorScheme).toBe("light");
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("ignores the hash in a top-level page", async () => {
    const { initTheme } = await fresh({});
    frame("#vtp-dark-light", false);
    initTheme();
    expect(root.style.colorScheme).toBe("");
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it.each(["#vtp-dark-light-x", "#x#vtp-dark-light"])(
    "ignores a malformed hash %s",
    async (hash) => {
      const { initTheme } = await fresh({});
      frame(hash, true);
      initTheme();
      expect(root.style.colorScheme).toBe("");
      expect(root.hasAttribute("data-theme")).toBe(false);
    },
  );
});
