// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMockChrome } from "./mocks/chrome.js";

// The live-sync settings card: the allowed-delay target is remembered per site
// (syncTargets), falling back to the legacy global value, then a 5s default.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const byId = (id: string) => document.getElementById(id) as HTMLInputElement;

let loadSyncSettings: () => Promise<void>;

beforeAll(async () => {
  const html = read("../src/popup/popup.html");
  document.body.innerHTML = html.replace(/[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*/, "")
    .replace(/<script[\s\S]*?<\/script>/g, "");
  const messages = JSON.parse(read("../src/_locales/en/messages.json"));
  // example.com host → a clean per-site key for the target.
  const chrome = createMockChrome({ messages, tab: { id: 3, url: "https://example.com/" } });
  (globalThis as unknown as { chrome: typeof chrome }).chrome = chrome;
  ({ loadSyncSettings } = await import("../src/popup/live-sync.js"));
});

const saved = (): Record<string, unknown> => {
  let out: Record<string, unknown> = {};
  (globalThis.chrome.storage.sync as unknown as { get: (k: null, cb: (r: Record<string, unknown>) => void) => void })
    .get(null, (r) => (out = r));
  return out;
};

beforeEach(() => {
  globalThis.chrome.storage.sync.set({ liveSync: true, liveSyncTarget: undefined, syncTargets: {} });
});

describe("loadSyncSettings", () => {
  it("uses the per-site target when one is stored", async () => {
    globalThis.chrome.storage.sync.set({ syncTargets: { "example.com": 12 }, liveSyncTarget: 8 });
    await loadSyncSettings();
    expect(byId("syncTarget").value).toBe("12");
    expect(byId("syncTargetVal").textContent).toBe("12");
  });

  it("falls back to the legacy global target when there's no per-site value", async () => {
    globalThis.chrome.storage.sync.set({ syncTargets: {}, liveSyncTarget: 8 });
    await loadSyncSettings();
    expect(byId("syncTarget").value).toBe("8");
  });

  it("falls back to the 5s default when nothing is stored", async () => {
    globalThis.chrome.storage.sync.set({ syncTargets: {}, liveSyncTarget: undefined });
    await loadSyncSettings();
    expect(byId("syncTarget").value).toBe("5");
  });

  it("reflects the enabled toggle (defaults on)", async () => {
    globalThis.chrome.storage.sync.set({ liveSync: false });
    await loadSyncSettings();
    expect(byId("liveSyncToggle").checked).toBe(false);
  });

  it("clamps an out-of-range stored target to 1..30", async () => {
    globalThis.chrome.storage.sync.set({ syncTargets: { "example.com": 999 } });
    await loadSyncSettings();
    expect(byId("syncTarget").value).toBe("30");
  });
});

describe("toggle + slider persistence", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("the toggle persists the liveSync flag", () => {
    const t = byId("liveSyncToggle");
    t.checked = false;
    t.dispatchEvent(new Event("change"));
    expect(saved().liveSync).toBe(false);
  });

  it("the slider updates the readout live and saves the per-site target (debounced)", async () => {
    await loadSyncSettings();              // resolves the active-tab domain (example.com)
    const slider = byId("syncTarget");
    slider.value = "9";
    slider.dispatchEvent(new Event("input"));
    expect(byId("syncTargetVal").textContent).toBe("9");   // immediate
    vi.advanceTimersByTime(350);
    expect((saved().syncTargets as Record<string, number>)["example.com"]).toBe(9);
  });
});
