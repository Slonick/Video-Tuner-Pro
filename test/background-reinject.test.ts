import { afterEach, describe, expect, it, vi } from "vitest";

async function loadBackgroundWithTabs(tabs: Array<{ id: number; url: string }>) {
  vi.resetModules();
  const installed: Array<() => void> = [];
  const executed: Array<{ tabId: number; files: string[]; world?: string }> = [];
  vi.doMock("../src/shared/store.js", () => ({
    STORE: {
      get(_keys: string[], cb: (items: Record<string, unknown>) => void) {
        cb({ globalSpeed: 1, syncTargetGlobal: 5 });
      },
      set(_obj: Record<string, unknown>, cb?: (ok?: boolean) => void) {
        cb?.(true);
      },
    },
    whenReady(cb: () => void) {
      cb();
    },
  }));
  vi.doMock("../src/shared/update.js", () => ({
    UPDATE_AVAILABLE_KEY: "updateAvailable",
    UPDATE_LATEST_KEY: "updateLatest",
    UPDATE_ALARM: "updateCheck",
    UPDATE_PERIOD_MIN: 360,
    hasUpdateApi: () => true,
    cmpVersion: () => 0,
    currentVersion: () => "0.0.0",
    fetchAmoLatest: () => Promise.resolve(null),
  }));
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      onInstalled: { addListener: (fn: () => void) => installed.push(fn) },
      onStartup: { addListener() {} },
      onUpdateAvailable: { addListener() {} },
      requestUpdateCheck() {},
    },
    action: {
      setBadgeText() {},
      setBadgeBackgroundColor() {},
      setBadgeTextColor() {},
      setIcon() {},
    },
    alarms: {
      onAlarm: { addListener() {} },
      create() {},
    },
    storage: {
      sync: {},
      local: {
        get(_keys: string[], cb: (items: Record<string, unknown>) => void) {
          cb({});
        },
        set() {},
      },
    },
    tabs: {
      onUpdated: { addListener() {} },
      query(_query: unknown, cb: (items: typeof tabs) => void) {
        cb(tabs);
      },
    },
    scripting: {
      executeScript(args: { target: { tabId: number }; files: string[]; world?: string }) {
        executed.push({ tabId: args.target.tabId, files: args.files, world: args.world });
      },
    },
  };

  await import("../src/background/index.js");
  installed.forEach((fn) => fn());
  return executed;
}

afterEach(() => {
  vi.doUnmock("../src/shared/store.js");
  vi.doUnmock("../src/shared/update.js");
});

describe("background reinjection", () => {
  it("reinjects the latency bridge only on the same hosts as the manifest", async () => {
    const executed = await loadBackgroundWithTabs([
      { id: 1, url: "https://example.com/watch" },
      { id: 2, url: "https://www.youtube.com/watch?v=x" },
      { id: 3, url: "https://m.twitch.tv/recrent" },
      { id: 4, url: "https://kick.com/fissure_cs_ru2" },
      { id: 5, url: "https://w.tv/live" },
    ]);

    const latencyTabs = executed
      .filter((x) => x.files.includes("inject.js"))
      .map((x) => x.tabId)
      .sort();

    expect(latencyTabs).toEqual([2, 3, 4, 5]);
    expect(
      executed
        .filter((x) => x.tabId === 1)
        .map((x) => x.files[0])
        .sort(),
    ).toEqual(["content.js", "page-bridge.js"]);
  });
});
