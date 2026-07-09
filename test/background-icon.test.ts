import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (
  msg: Record<string, unknown>,
  sender: Record<string, unknown>,
  sendResponse?: (resp?: unknown) => void,
) => void;
type TabRemovedListener = (tabId: number) => void;

const h = vi.hoisted(() => ({
  listener: null as Listener | null,
  tabRemoved: null as TabRemovedListener | null,
  badgeText: [] as unknown[],
  icons: [] as unknown[],
  tabMessages: [] as unknown[],
  scriptCalls: [] as unknown[],
  probeResults: [] as Array<{
    frameId?: number;
    result?: { hasVideo?: boolean; score?: number };
  }> | null,
  promiseProbe: false,
}));

vi.mock("../src/shared/store.js", () => ({
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

vi.mock("../src/shared/update.js", () => ({
  UPDATE_AVAILABLE_KEY: "updateAvailable",
  UPDATE_LATEST_KEY: "updateLatest",
  UPDATE_ALARM: "updateCheck",
  UPDATE_PERIOD_MIN: 360,
  hasUpdateApi: () => true,
  cmpVersion: () => 0,
  currentVersion: () => "0.0.0",
  fetchAmoLatest: () => Promise.resolve(null),
}));

function sender(tabId: number, frameId: number): Record<string, unknown> {
  return { tab: { id: tabId }, frameId };
}

describe("background toolbar badge frame ownership", () => {
  beforeEach(async () => {
    vi.resetModules();
    h.listener = null;
    h.tabRemoved = null;
    h.badgeText = [];
    h.icons = [];
    h.tabMessages = [];
    h.scriptCalls = [];
    h.probeResults = [{ frameId: 4, result: { hasVideo: true, score: 100 } }];
    h.promiseProbe = false;
    (globalThis as unknown as { browser?: unknown }).browser = undefined;
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        lastError: null,
        onMessage: {
          addListener(fn: Listener) {
            h.listener = fn;
          },
        },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onUpdateAvailable: { addListener() {} },
        requestUpdateCheck() {},
      },
      action: {
        setBadgeText(args: unknown) {
          h.badgeText.push(args);
        },
        setBadgeBackgroundColor() {},
        setBadgeTextColor() {},
        setIcon(args: unknown) {
          h.icons.push(args);
        },
      },
      tabs: {
        sendMessage(
          tabId: number,
          msg: Record<string, unknown>,
          optionsOrCb?: { frameId?: number } | ((resp?: unknown) => void),
          cbArg?: (resp?: unknown) => void,
        ) {
          const options = typeof optionsOrCb === "function" ? undefined : optionsOrCb;
          const cb = typeof optionsOrCb === "function" ? optionsOrCb : cbArg;
          h.tabMessages.push({ tabId, msg, options });
          if (options?.frameId === 4 && msg.action === "stale") {
            (globalThis.chrome.runtime as { lastError: unknown }).lastError = {
              message: "No receiver",
            };
            cb?.(undefined);
            (globalThis.chrome.runtime as { lastError: unknown }).lastError = null;
            return;
          }
          cb?.({ ok: true, action: msg.action, frameId: options?.frameId ?? null });
        },
        onUpdated: { addListener() {} },
        onRemoved: {
          addListener(fn: TabRemovedListener) {
            h.tabRemoved = fn;
          },
        },
      },
      scripting: {
        executeScript(args: unknown, cb: (results?: typeof h.probeResults) => void) {
          h.scriptCalls.push(args);
          const results =
            h.probeResults ??
            ([
              {
                frameId: 4,
                result: (args as { func: () => { hasVideo?: boolean; score?: number } }).func(),
              },
            ] as typeof h.probeResults);
          if (h.promiseProbe) return Promise.resolve(results);
          cb(results);
        },
      },
      alarms: {
        onAlarm: { addListener() {} },
        create() {},
      },
      storage: { local: { set() {} } },
    };

    await import("../src/background/index.js");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not let an iframe overwrite or clear a top-frame badge", () => {
    h.listener!({ action: "icon", text: "1.5", live: false }, sender(7, 0));
    h.listener!({ action: "icon", text: "1.0", live: false }, sender(7, 3));
    h.listener!({ action: "icon", clear: true }, sender(7, 3));

    expect(h.badgeText).toEqual([{ text: "1.5", tabId: 7 }]);
    expect(h.icons).toHaveLength(1);
  });

  it("lets an iframe own and clear the badge when it is the only video frame", () => {
    h.listener!({ action: "icon", text: "1.25", live: false }, sender(8, 4));
    h.listener!({ action: "icon", clear: true }, sender(8, 4));

    expect(h.badgeText).toEqual([
      { text: "1.25", tabId: 8 },
      { text: "", tabId: 8 },
    ]);
    expect(h.icons).toHaveLength(2);
  });

  it("accepts a clear when the service worker forgot the badge owner", () => {
    h.listener!({ action: "icon", clear: true }, sender(9, 4));

    expect(h.badgeText).toEqual([{ text: "", tabId: 9 }]);
    expect(h.icons).toHaveLength(1);
  });

  it("forgets frame ownership when a tab is removed", () => {
    h.listener!({ action: "icon", text: "1.25", live: false }, sender(10, 4));
    h.tabRemoved!(10);
    h.listener!({ action: "icon", text: "1.5", live: false }, sender(10, 0));

    expect(h.badgeText).toEqual([
      { text: "1.25", tabId: 10 },
      { text: "", tabId: 10 },
      { text: "1.5", tabId: 10 },
    ]);
  });

  it("routes video-frame popup messages to the probed video frame", () => {
    let response: unknown;
    h.probeResults = [
      { frameId: 4, result: { hasVideo: true, score: 100 } },
      { frameId: 7, result: { hasVideo: true, score: 500 } },
    ];
    h.listener!({ action: "icon", text: "1.25", live: false }, sender(11, 4));
    h.listener!(
      { action: "relayToTab", tabId: 11, msg: { action: "getMonitor" }, route: "video" },
      {},
      (r) => {
        response = r;
      },
    );

    expect(h.tabMessages).toEqual([
      { tabId: 11, msg: { action: "getMonitor" }, options: { frameId: 7 } },
    ]);
    expect(response).toEqual({ ok: true, action: "getMonitor", frameId: 7 });
    expect(h.scriptCalls).toHaveLength(1);
  });

  it("keeps a probed video frame cached across idle monitor polls", () => {
    vi.useFakeTimers();
    try {
      let first: unknown;
      let second: unknown;
      vi.setSystemTime(0);
      h.probeResults = [{ frameId: 4, result: { hasVideo: true, score: 100 } }];

      h.listener!(
        { action: "relayToTab", tabId: 11, msg: { action: "getMonitor" }, route: "video" },
        {},
        (r) => {
          first = r;
        },
      );
      vi.setSystemTime(4000);
      h.listener!(
        { action: "relayToTab", tabId: 11, msg: { action: "getMonitor" }, route: "video" },
        {},
        (r) => {
          second = r;
        },
      );

      expect(h.scriptCalls).toHaveLength(1);
      expect(h.tabMessages).toEqual([
        { tabId: 11, msg: { action: "getMonitor" }, options: { frameId: 4 } },
        { tabId: 11, msg: { action: "getMonitor" }, options: { frameId: 4 } },
      ]);
      expect(first).toEqual({ ok: true, action: "getMonitor", frameId: 4 });
      expect(second).toEqual({ ok: true, action: "getMonitor", frameId: 4 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("briefly caches a no-video probe miss across idle monitor polls", () => {
    vi.useFakeTimers();
    try {
      let first: unknown;
      let second: unknown;
      let third: unknown;
      vi.setSystemTime(0);
      h.probeResults = [{ frameId: 4, result: { hasVideo: false, score: 0 } }];

      h.listener!(
        { action: "relayToTab", tabId: 11, msg: { action: "getMonitor" }, route: "video" },
        {},
        (r) => {
          first = r;
        },
      );
      vi.setSystemTime(1000);
      h.listener!(
        { action: "relayToTab", tabId: 11, msg: { action: "getMonitor" }, route: "video" },
        {},
        (r) => {
          second = r;
        },
      );
      vi.setSystemTime(1600);
      h.probeResults = [{ frameId: 7, result: { hasVideo: true, score: 200 } }];
      h.listener!(
        { action: "relayToTab", tabId: 11, msg: { action: "getMonitor" }, route: "video" },
        {},
        (r) => {
          third = r;
        },
      );

      expect(h.scriptCalls).toHaveLength(2);
      expect(h.tabMessages).toEqual([
        { tabId: 11, msg: { action: "getMonitor" }, options: undefined },
        { tabId: 11, msg: { action: "getMonitor" }, options: undefined },
        { tabId: 11, msg: { action: "getMonitor" }, options: { frameId: 7 } },
      ]);
      expect(first).toEqual({ ok: true, action: "getMonitor", frameId: null });
      expect(second).toEqual({ ok: true, action: "getMonitor", frameId: null });
      expect(third).toEqual({ ok: true, action: "getMonitor", frameId: 7 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("scores video frames like the content primary-video picker", async () => {
    let response: unknown;
    h.probeResults = null;
    h.promiseProbe = true;
    const tinyPlaying = {
      readyState: 1,
      paused: false,
      currentSrc: "",
      src: "",
      getBoundingClientRect: () => ({ width: 20, height: 20 }),
    };
    const largePaused = {
      readyState: 1,
      paused: true,
      currentSrc: "",
      src: "",
      getBoundingClientRect: () => ({ width: 1000, height: 600 }),
    };
    (globalThis as unknown as { document: unknown }).document = {
      querySelectorAll: () => [tinyPlaying, largePaused],
    };

    try {
      h.listener!(
        { action: "relayToTab", tabId: 13, msg: { action: "getMonitor" }, route: "video" },
        {},
        (r) => {
          response = r;
        },
      );
      await Promise.resolve();

      expect(h.tabMessages).toEqual([
        { tabId: 13, msg: { action: "getMonitor" }, options: { frameId: 4 } },
      ]);
      expect(response).toEqual({ ok: true, action: "getMonitor", frameId: 4 });
    } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  });

  it("keeps using the badge owner for non-video relays", () => {
    let response: unknown;
    h.listener!({ action: "icon", text: "1.25", live: false }, sender(11, 4));
    h.listener!({ action: "relayToTab", tabId: 11, msg: { action: "setSpeed" } }, {}, (r) => {
      response = r;
    });

    expect(h.tabMessages).toEqual([
      { tabId: 11, msg: { action: "setSpeed" }, options: { frameId: 4 } },
    ]);
    expect(response).toEqual({ ok: true, action: "setSpeed", frameId: 4 });
    expect(h.scriptCalls).toHaveLength(0);
  });

  it("falls back to a tab-wide relay when the remembered frame is stale", () => {
    let response: unknown;
    h.listener!({ action: "icon", text: "1.25", live: false }, sender(12, 4));
    h.listener!(
      { action: "relayToTab", tabId: 12, msg: { action: "stale" }, route: "video" },
      {},
      (r) => {
        response = r;
      },
    );

    expect(h.tabMessages).toEqual([
      { tabId: 12, msg: { action: "stale" }, options: { frameId: 4 } },
      { tabId: 12, msg: { action: "stale" }, options: undefined },
    ]);
    expect(response).toEqual({ ok: true, action: "stale", frameId: null });
  });
});
