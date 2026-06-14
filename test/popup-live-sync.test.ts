// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMockChrome } from "./mocks/chrome.js";

// The live-sync card now mirrors the speed card: the allowed delay is saved per
// scope (channel > site > global > 5s) via messaging — dragging previews live
// (setTarget), Save commits (rememberTarget), Reset clears (resetTarget). Stub
// tabs.sendMessage to control the content replies.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const byId = (id: string) => document.getElementById(id) as HTMLInputElement;

let loadSyncSettings: () => Promise<void>;
let sendSpy: ReturnType<typeof vi.fn>;
let replies: Record<string, unknown>;

beforeAll(async () => {
  const html = read("../src/popup/popup.html");
  document.body.innerHTML = html.replace(/[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*/, "")
    .replace(/<script[\s\S]*?<\/script>/g, "");
  const messages = JSON.parse(read("../src/_locales/en/messages.json"));
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
const lastCall = (action: string) =>
  sendSpy.mock.calls.filter((c) => (c[1] as { action: string }).action === action).at(-1)?.[1] as Record<string, unknown> | undefined;

beforeEach(() => {
  globalThis.chrome.runtime.lastError = undefined as unknown as chrome.runtime.LastError;
  globalThis.chrome.storage.sync.set({ liveSync: true, syncTargets: {}, syncTargetChannels: {}, syncTargetGlobal: undefined, liveSyncTarget: undefined });
  replies = { getTarget: { target: 5, scope: null, channel: null, channelName: "", live: false } };
  sendSpy = vi.spyOn(globalThis.chrome.tabs, "sendMessage").mockImplementation(((_id: number, m: { action: string }, cb?: (r?: unknown) => void) => {
    cb?.(replies[m.action]);
  }) as unknown as typeof chrome.tabs.sendMessage) as unknown as ReturnType<typeof vi.fn>;
});
afterEach(() => { sendSpy.mockClear(); });

describe("loadSyncSettings", () => {
  it("reflects the resolved target + scope from getTarget", async () => {
    replies.getTarget = { target: 12, scope: "site", channel: null, channelName: "", live: false };
    await loadSyncSettings();
    expect(byId("syncTarget").value).toBe("12");
    expect(byId("syncTargetVal").textContent).toBe("12");
    expect(byId("syncScopeSite").classList.contains("active")).toBe(true);
  });

  it("shows the Channel segment and preselects it when the target came from the channel", async () => {
    replies.getTarget = { target: 7, scope: "channel", channel: "twitch:x", channelName: "X", live: true };
    await loadSyncSettings();
    expect(byId("syncScopeSeg").classList.contains("has-channel")).toBe(true);
    expect(byId("syncScopeChannel").classList.contains("active")).toBe(true);
  });

  it("dots the slots that hold a saved delay", async () => {
    globalThis.chrome.storage.sync.set({ syncTargets: { "example.com": 8 }, syncTargetGlobal: 12 });
    replies.getTarget = { target: 8, scope: "site", channel: null, channelName: "", live: false };
    await loadSyncSettings();
    expect(byId("syncScopeSite").classList.contains("has-saved")).toBe(true);
    expect(byId("syncScopeGlobal").classList.contains("has-saved")).toBe(true);
    expect(byId("syncScopeChannel").classList.contains("has-saved")).toBe(false);
  });

  it("preselects Site (never Global) when the delay came from the global scope", async () => {
    replies.getTarget = { target: 12, scope: "global", channel: null, channelName: "", live: false };
    await loadSyncSettings();
    expect(byId("syncScopeSite").classList.contains("active")).toBe(true);
    expect(byId("syncScopeGlobal").classList.contains("active")).toBe(false);
  });

  it("clamps an out-of-range target from the page", async () => {
    replies.getTarget = { target: 999, scope: "site", channel: null, channelName: "", live: false };
    await loadSyncSettings();
    expect(byId("syncTarget").value).toBe("30");
  });
});

describe("toggle + slider", () => {
  it("the toggle persists the liveSync flag", () => {
    const t = byId("liveSyncToggle");
    t.checked = false;
    t.dispatchEvent(new Event("change"));
    expect(saved().liveSync).toBe(false);
  });

  it("the +/− buttons nudge the delay (slider + readout) and preview live", async () => {
    await loadSyncSettings();
    vi.useFakeTimers();
    byId("syncTarget").value = "5";
    byId("syncUp").click();
    expect(byId("syncTarget").value).toBe("6");
    expect(byId("syncTargetVal").textContent).toBe("6");
    byId("syncDown").click();
    byId("syncDown").click();
    expect(byId("syncTarget").value).toBe("4");
    vi.advanceTimersByTime(160);
    expect(lastCall("setTarget")).toMatchObject({ action: "setTarget", target: 4 });
    vi.useRealTimers();
  });

  it("the slider previews live (setTarget) without persisting", async () => {
    await loadSyncSettings();
    vi.useFakeTimers();
    const slider = byId("syncTarget");
    slider.value = "9";
    slider.dispatchEvent(new Event("input"));
    expect(byId("syncTargetVal").textContent).toBe("9"); // immediate readout
    vi.advanceTimersByTime(160);
    expect(lastCall("setTarget")).toMatchObject({ action: "setTarget", target: 9 });
    expect((saved().syncTargets as Record<string, number>)["example.com"]).toBeUndefined();
    vi.useRealTimers();
  });
});

describe("save / reset by scope", () => {
  it("Save sends rememberTarget for the selected scope and dots the slot", async () => {
    await loadSyncSettings();
    byId("syncScopeSite").click();
    byId("syncTarget").value = "10";
    byId("syncSetBtn").click();
    expect(lastCall("rememberTarget")).toMatchObject({ action: "rememberTarget", scope: "site", target: 10 });
    expect(byId("syncScopeSite").classList.contains("has-saved")).toBe(true);
  });

  it("Reset clears the slot, sends resetTarget, and pulls the new value back", async () => {
    await loadSyncSettings();
    byId("syncScopeSite").click();
    byId("syncScopeSite").classList.add("has-saved");
    vi.useFakeTimers();
    replies.resetTarget = { success: true };
    replies.getTarget = { target: 5, scope: null, channel: null, channelName: "", live: false };
    byId("syncResetBtn").click();
    expect(lastCall("resetTarget")).toMatchObject({ action: "resetTarget", scope: "site" });
    expect(byId("syncScopeSite").classList.contains("has-saved")).toBe(false);
    vi.advanceTimersByTime(80);
    expect(byId("syncTarget").value).toBe("5");
    vi.useRealTimers();
  });
});

describe("no content script (chrome:// / store pages) — storage fallback", () => {
  it("loadSyncSettings resolves the target from storage when the page doesn't answer", async () => {
    globalThis.chrome.storage.sync.set({ syncTargets: { "example.com": 9 } });
    replies.getTarget = undefined;               // no reply
    await loadSyncSettings();
    expect(byId("syncTarget").value).toBe("9");
    expect(byId("syncScopeSite").classList.contains("active")).toBe(true);  // defaults to Site
  });

  it("Save writes the per-site target straight to storage on messaging failure", async () => {
    await loadSyncSettings();
    globalThis.chrome.runtime.lastError = { message: "no receiver" } as chrome.runtime.LastError;
    byId("syncScopeSite").click();
    byId("syncTarget").value = "11";
    byId("syncSetBtn").click();
    expect((saved().syncTargets as Record<string, number>)["example.com"]).toBe(11);
    globalThis.chrome.runtime.lastError = undefined as unknown as chrome.runtime.LastError;
  });

  it("Save global writes syncTargetGlobal on fallback", async () => {
    await loadSyncSettings();
    globalThis.chrome.runtime.lastError = { message: "x" } as chrome.runtime.LastError;
    byId("syncScopeGlobal").click();
    byId("syncTarget").value = "15";
    byId("syncSetBtn").click();
    expect(saved().syncTargetGlobal).toBe(15);
    globalThis.chrome.runtime.lastError = undefined as unknown as chrome.runtime.LastError;
  });

  it("Reset clears the per-site target from storage on fallback", async () => {
    globalThis.chrome.storage.sync.set({ syncTargets: { "example.com": 9 } });
    await loadSyncSettings();
    globalThis.chrome.runtime.lastError = { message: "x" } as chrome.runtime.LastError;
    byId("syncScopeSite").click();
    byId("syncResetBtn").click();
    expect((saved().syncTargets as Record<string, number>)["example.com"]).toBeUndefined();
    globalThis.chrome.runtime.lastError = undefined as unknown as chrome.runtime.LastError;
  });
});
