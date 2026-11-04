import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

type Listener = (
  msg: Record<string, unknown>,
  sender: Record<string, unknown>,
  sendResponse?: (resp?: unknown) => void,
) => unknown;
type TabRemovedListener = (tabId: number) => void;
type TabUpdatedListener = (tabId: number, info: { status?: string; title?: string }) => void;

const h = vi.hoisted(() => ({
  listener: null as Listener | null,
  tabRemoved: null as TabRemovedListener | null,
  tabUpdated: null as TabUpdatedListener | null,
  badgeText: [] as unknown[],
  badgeColors: [] as unknown[],
  badgeTextColors: [] as unknown[],
  icons: [] as unknown[],
  tabMessages: [] as Array<{ tabId: number; msg: unknown; options?: { frameId?: number } }>,
  scriptCalls: [] as unknown[],
  probeResults: [] as Array<{
    frameId?: number;
    result?: { hasVideo?: boolean; score?: number };
  }> | null,
  promiseProbe: false,
  session: {} as Record<string, unknown>,
  sessionSets: [] as unknown[],
  holdSession: false,
  sessionGets: [] as Array<() => void>,
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

// The parts of the chrome mock tests swap after the background bound to it at import.
interface ChromeMock {
  action: Record<string, (...args: unknown[]) => unknown>;
  scripting: {
    executeScript: (args: { func: () => unknown }, cb: (results: unknown[]) => void) => unknown;
  };
  storage: {
    session: { get: (key: string, cb: (items?: Record<string, unknown>) => void) => void };
  };
  tabs: {
    sendMessage: (
      tabId: number,
      msg: unknown,
      options?: { frameId?: number },
      cb?: (resp: unknown) => void,
    ) => void;
  };
}

function chromeApi(): ChromeMock {
  return (globalThis as unknown as { chrome: ChromeMock }).chrome;
}

// The idle worker is unloaded and a fresh one starts with an empty memory: importing
// the module again is that restart (it registers its listeners and reloads saved state).
async function restartWorker(): Promise<void> {
  vi.resetModules();
  await import("../src/background/index.js");
}

const DEFAULT_ICON = {
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
  48: "icons/icon-48.png",
  128: "icons/icon-128.png",
};
const LIVE_ICON = {
  16: "icons/icon-red-16.png",
  32: "icons/icon-red-32.png",
  48: "icons/icon-red-48.png",
  128: "icons/icon-red-128.png",
};

interface FakeVideo {
  readyState: number;
  paused: boolean;
  currentSrc: string;
  src: string;
  getBoundingClientRect: () => { width: number; height: number };
}

function video(
  width: number,
  height: number,
  state: Partial<Omit<FakeVideo, "getBoundingClientRect">> = {},
): FakeVideo {
  return {
    readyState: 1,
    paused: false,
    currentSrc: "",
    src: "",
    ...state,
    getBoundingClientRect: () => ({ width, height }),
  };
}

// Runs the background's page probe in each listed frame, as executeScript({ allFrames }) does.
function probeFrames(frames: Array<[frameId: number, videos: FakeVideo[]]>): void {
  // The probe executes in the page, where it reads the frame's own `document`.
  const page = globalThis as unknown as { document?: unknown };
  chromeApi().scripting.executeScript = (args, cb) => {
    h.scriptCalls.push(args);
    cb(
      frames.map(([frameId, videos]) => {
        page.document = {
          querySelectorAll: (selector: string) => (selector === "video" ? videos : []),
        };
        try {
          return { frameId, result: args.func() };
        } finally {
          delete page.document;
        }
      }),
    );
  };
}

// Sends a popup request routed to "the video" and returns the frame it reached
// (undefined: the whole tab).
function videoRelayTarget(tabId: number): number | undefined {
  const before = h.tabMessages.length;
  h.listener!(
    { action: "relayToTab", tabId, msg: { action: "getMonitor" }, route: "video" },
    {},
    () => {},
  );
  const sent = h.tabMessages.slice(before);
  expect(sent).toHaveLength(1);
  return sent[0].options?.frameId;
}

describe("background toolbar badge frame ownership", () => {
  beforeEach(async () => {
    vi.resetModules();
    h.listener = null;
    h.tabRemoved = null;
    h.tabUpdated = null;
    h.badgeText = [];
    h.badgeColors = [];
    h.badgeTextColors = [];
    h.icons = [];
    h.tabMessages = [];
    h.scriptCalls = [];
    h.probeResults = [{ frameId: 4, result: { hasVideo: true, score: 100 } }];
    h.promiseProbe = false;
    h.session = {};
    h.sessionSets = [];
    h.holdSession = false;
    h.sessionGets = [];
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
        setBadgeBackgroundColor(args: unknown) {
          h.badgeColors.push(args);
        },
        setBadgeTextColor(args: unknown) {
          h.badgeTextColors.push(args);
        },
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
          // A frame whose content script doesn't answer: no reply, but no error either.
          if (options?.frameId === 4 && msg.action === "silent") {
            cb?.(undefined);
            return;
          }
          cb?.({ ok: true, action: msg.action, frameId: options?.frameId ?? null });
        },
        onUpdated: {
          addListener(fn: TabUpdatedListener) {
            h.tabUpdated = fn;
          },
        },
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
      storage: {
        local: { set() {} },
        session: {
          get(key: string, cb: (items: Record<string, unknown>) => void) {
            const reply = () => cb(key in h.session ? { [key]: h.session[key] } : {});
            if (h.holdSession) h.sessionGets.push(reply);
            else reply();
          },
          set(items: Record<string, unknown>) {
            h.sessionSets.push(items);
            Object.assign(h.session, items);
          },
        },
      },
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

  it("ignores a subframe clear while no frame owns the badge", () => {
    h.listener!({ action: "icon", clear: true }, sender(9, 4));

    expect(h.badgeText).toEqual([]);
    expect(h.icons).toHaveLength(0);
  });

  it("accepts a top-frame clear while no frame owns the badge", () => {
    h.listener!({ action: "icon", clear: true }, sender(9, 0));

    expect(h.badgeText).toEqual([{ text: "", tabId: 9 }]);
    expect(h.icons).toHaveLength(1);
  });

  it("saves badge owners to session storage and drops a reset tab", () => {
    h.listener!({ action: "icon", text: "1.25", live: false }, sender(8, 4));
    expect(h.session.badgeOwners).toEqual({ 8: 4 });

    h.tabRemoved!(8);

    expect(h.session.badgeOwners).toEqual({});
  });

  it("restores the badge owner before acting after a service worker restart", async () => {
    h.listener!({ action: "icon", text: "1.5", live: false }, sender(7, 0));

    // The idle worker is unloaded and a fresh one starts with an empty memory.
    h.holdSession = true;
    vi.resetModules();
    await import("../src/background/index.js");
    h.listener!({ action: "icon", text: "1.0", live: false }, sender(7, 3));
    h.listener!({ action: "icon", clear: true }, sender(7, 3));
    h.listener!({ action: "relayToTab", tabId: 7, msg: { action: "setSpeed" } }, {}, () => {});
    expect(h.tabMessages).toEqual([]);

    h.sessionGets.shift()!();

    // The top frame still owns the badge: the ad iframe changed nothing.
    expect(h.badgeText).toEqual([{ text: "1.5", tabId: 7 }]);
    expect(h.tabMessages).toEqual([
      { tabId: 7, msg: { action: "setSpeed" }, options: { frameId: 0 } },
    ]);
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

  describe("badge painting", () => {
    it("paints the badge blue with white text and swaps in the red icon while live", () => {
      h.listener!({ action: "icon", text: "1.5", live: true }, sender(7, 0));
      h.listener!({ action: "icon", text: "1.25", live: false }, sender(7, 0));
      h.tabRemoved!(7);

      expect(h.badgeColors).toEqual([
        { color: "#0a84ff", tabId: 7 },
        { color: "#0a84ff", tabId: 7 },
      ]);
      expect(h.badgeTextColors).toEqual([
        { color: "#ffffff", tabId: 7 },
        { color: "#ffffff", tabId: 7 },
      ]);
      expect(h.icons).toEqual([
        { path: LIVE_ICON, tabId: 7 },
        { path: DEFAULT_ICON, tabId: 7 },
        { path: DEFAULT_ICON, tabId: 7 },
      ]);
      // The paths resolve against the packaged root, which the build copies from src/.
      for (const path of [...Object.values(DEFAULT_ICON), ...Object.values(LIVE_ICON)]) {
        expect(existsSync(join("src", path)), path).toBe(true);
      }
    });

    it("blanks the badge text for an update without a speed", () => {
      h.listener!({ action: "icon", live: true }, sender(7, 0));

      expect(h.badgeText).toEqual([{ text: "", tabId: 7 }]);
    });

    it("replies to icon updates at once and ignores other messages or tab-less senders", () => {
      const tabless = { tab: {}, frameId: 0 };

      expect(h.listener!({ action: "icon", text: "1.5", live: false }, sender(7, 0))).toBe(false);
      expect(h.listener!({ action: "settingsChanged", text: "2" }, sender(7, 0))).toBeUndefined();
      expect(h.listener!({ action: "icon", text: "2", live: false }, tabless)).toBeUndefined();

      expect(h.badgeText).toEqual([{ text: "1.5", tabId: 7 }]);
      expect(h.icons).toHaveLength(1);
    });

    it("treats a sender without a frame id as the top frame", () => {
      h.listener!({ action: "icon", text: "1.25", live: false }, sender(7, 4));
      h.listener!({ action: "icon", text: "2", live: false }, { tab: { id: 7 } });
      h.listener!({ action: "icon", text: "1.5", live: false }, sender(7, 4));

      expect(h.badgeText).toEqual([
        { text: "1.25", tabId: 7 },
        { text: "2", tabId: 7 },
      ]);
    });

    it("keeps an iframe's badge when the top frame reports no video", () => {
      h.listener!({ action: "icon", text: "1.25", live: false }, sender(8, 4));
      h.listener!({ action: "icon", clear: true }, sender(8, 0));

      expect(h.badgeText).toEqual([{ text: "1.25", tabId: 8 }]);
      expect(h.icons).toHaveLength(1);
    });

    it("lets the top frame take over a badge an iframe holds", () => {
      h.listener!({ action: "icon", text: "1.25", live: false }, sender(8, 4));
      h.listener!({ action: "icon", text: "1.5", live: false }, sender(8, 0));
      h.listener!({ action: "icon", text: "2", live: false }, sender(8, 4));

      expect(h.badgeText).toEqual([
        { text: "1.25", tabId: 8 },
        { text: "1.5", tabId: 8 },
      ]);
      expect(h.session.badgeOwners).toEqual({ 8: 0 });
    });

    it("lets the owning iframe keep updating without rewriting the saved owner", () => {
      h.listener!({ action: "icon", text: "1.25", live: false }, sender(8, 4));
      h.listener!({ action: "icon", text: "1.5", live: false }, sender(8, 4));

      expect(h.badgeText).toEqual([
        { text: "1.25", tabId: 8 },
        { text: "1.5", tabId: 8 },
      ]);
      expect(h.sessionSets).toEqual([{ badgeOwners: { 8: 4 } }]);
    });

    it("absorbs the rejection when the tab closed before a badge update landed", async () => {
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      try {
        for (const method of Object.keys(chromeApi().action)) {
          chromeApi().action[method] = () => Promise.reject(new Error("No tab with id: 7."));
        }
        h.listener!({ action: "icon", text: "1.5", live: false }, sender(7, 0));
        h.tabRemoved!(7);
        // Node reports an unhandled rejection only once the microtask queue has drained,
        // so this has to wait a macrotask turn; no promise exposes that moment.
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        process.off("unhandledRejection", unhandled);
      }

      expect(unhandled).not.toHaveBeenCalled();
    });
  });

  describe("navigation", () => {
    it("resets the badge once the tab starts loading a new page", () => {
      h.listener!({ action: "icon", text: "1.5", live: true }, sender(7, 0));
      h.tabUpdated!(7, { title: "Next video" });
      h.tabUpdated!(7, { status: "complete" });
      expect(h.badgeText).toEqual([{ text: "1.5", tabId: 7 }]);

      h.tabUpdated!(7, { status: "loading" });

      expect(h.badgeText).toEqual([
        { text: "1.5", tabId: 7 },
        { text: "", tabId: 7 },
      ]);
      expect(h.icons).toEqual([
        { path: LIVE_ICON, tabId: 7 },
        { path: DEFAULT_ICON, tabId: 7 },
      ]);
    });

    it("probes the video frame afresh after the tab navigates", () => {
      expect(videoRelayTarget(11)).toBe(4);
      h.tabUpdated!(11, { status: "loading" });

      expect(videoRelayTarget(11)).toBe(4);
      expect(h.scriptCalls).toHaveLength(2);
    });
  });

  describe("video frame probe", () => {
    it.each<[string, Array<[number, FakeVideo[]]>, number | undefined]>([
      [
        "tab-wide past a video that has not loaded",
        [[4, [video(640, 360, { readyState: 0 })]]],
        undefined,
      ],
      [
        "to a video that has only resolved its source",
        [[4, [video(640, 360, { readyState: 0, currentSrc: "blob:https://site.example/1" })]]],
        4,
      ],
      [
        "to a video that has only a src attribute",
        [[4, [video(640, 360, { readyState: 0, src: "https://site.example/v.mp4" })]]],
        4,
      ],
      ["tab-wide past a sliver too narrow for a player", [[4, [video(20, 600)]]], undefined],
      ["tab-wide past a sliver too short for a player", [[4, [video(600, 20)]]], undefined],
      ["to a 40px player, the smallest that counts", [[4, [video(40, 40)]]], 4],
      ["tab-wide when the frame has no video", [[4, []]], undefined],
      [
        "to a playing video over a bigger paused one",
        [
          [4, [video(500, 400, { paused: true })]],
          [7, [video(400, 300)]],
        ],
        7,
      ],
      [
        "to the larger of two playing videos",
        [
          [4, [video(300, 600)]],
          [7, [video(400, 300)]],
        ],
        4,
      ],
      [
        "past a small playing video beside a much bigger paused one",
        [
          [4, [video(1000, 1000, { paused: true }), video(100, 100)]],
          [7, [video(1005, 1000, { paused: true })]],
        ],
        7,
      ],
      [
        "to a playing video exactly a quarter the size of the largest",
        [
          [4, [video(200, 200, { paused: true }), video(100, 100)]],
          [7, [video(210, 210, { paused: true })]],
        ],
        4,
      ],
      [
        "by a frame's best video, not its last one",
        [
          [4, [video(1000, 600), video(100, 100, { paused: true })]],
          [7, [video(640, 480)]],
        ],
        4,
      ],
    ])("routes the popup %s", (_case, frames, frameId) => {
      probeFrames(frames);

      expect(videoRelayTarget(20)).toBe(frameId);
    });
  });

  describe("video frame lookup", () => {
    it("picks the best-scoring frame wherever the browser lists it", () => {
      h.probeResults = [
        { frameId: 7, result: { hasVideo: true, score: 500 } },
        { frameId: 4, result: { hasVideo: true, score: 100 } },
      ];

      expect(videoRelayTarget(11)).toBe(7);
    });

    it("keeps the earlier frame when two frames score the same", () => {
      h.probeResults = [
        { frameId: 4, result: { hasVideo: true, score: 300 } },
        { frameId: 7, result: { hasVideo: true, score: 300 } },
      ];

      expect(videoRelayTarget(11)).toBe(4);
    });

    it("skips frames the probe could not run in or attribute", () => {
      h.probeResults = [
        { frameId: 2 },
        { result: { hasVideo: true, score: 900 } },
        { frameId: 4, result: { hasVideo: true, score: 100 } },
      ];

      expect(videoRelayTarget(11)).toBe(4);
    });

    it("probes again once the cached video frame expires", () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(0);
        expect(videoRelayTarget(11)).toBe(4);
        vi.setSystemTime(5000);
        expect(videoRelayTarget(11)).toBe(4);

        expect(h.scriptCalls).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("waits for a probe that reports after executeScript returns", () => {
      let report = () => {};
      chromeApi().scripting.executeScript = (_args, cb) => {
        report = () => cb([{ frameId: 4, result: { hasVideo: true, score: 100 } }]);
      };
      h.listener!(
        { action: "relayToTab", tabId: 11, msg: { action: "getMonitor" }, route: "video" },
        {},
        () => {},
      );
      expect(h.tabMessages).toEqual([]);

      report();

      expect(h.tabMessages).toEqual([
        { tabId: 11, msg: { action: "getMonitor" }, options: { frameId: 4 } },
      ]);
    });

    it("relays once when the probe both calls back and resolves", async () => {
      const results = [{ frameId: 4, result: { hasVideo: true, score: 100 } }];
      chromeApi().scripting.executeScript = (_args, cb) => {
        cb(results);
        return Promise.resolve(results);
      };
      const responses: unknown[] = [];
      h.listener!(
        { action: "relayToTab", tabId: 11, msg: { action: "getMonitor" }, route: "video" },
        {},
        (r) => responses.push(r),
      );
      // The resolved promise's reaction is already queued: one microtask lets it run.
      await Promise.resolve();

      expect(h.tabMessages).toHaveLength(1);
      expect(responses).toEqual([{ ok: true, action: "getMonitor", frameId: 4 }]);
    });

    it("relays tab-wide when the probe is rejected", async () => {
      chromeApi().scripting.executeScript = () =>
        Promise.reject(new Error("Cannot access contents of the page."));
      let response: unknown;
      h.listener!(
        { action: "relayToTab", tabId: 11, msg: { action: "getMonitor" }, route: "video" },
        {},
        (r) => {
          response = r;
        },
      );
      // The rejected promise's reaction is already queued: one microtask lets it run.
      await Promise.resolve();

      expect(h.tabMessages).toEqual([
        { tabId: 11, msg: { action: "getMonitor" }, options: undefined },
      ]);
      expect(response).toEqual({ ok: true, action: "getMonitor", frameId: null });
    });

    it("relays tab-wide when the probe throws", () => {
      chromeApi().scripting.executeScript = () => {
        throw new Error("Missing host permission for the tab.");
      };

      expect(videoRelayTarget(11)).toBeUndefined();
    });

    it("falls back to the badge owner when the probe finds no video", () => {
      h.listener!({ action: "icon", text: "1.25", live: false }, sender(11, 4));
      h.probeResults = [{ frameId: 4, result: { hasVideo: false, score: 0 } }];

      expect(videoRelayTarget(11)).toBe(4);
    });
  });

  describe("popup relays", () => {
    it("forwards only well-formed relayToTab requests", () => {
      const misrouted = { action: "getSpeed", tabId: 11, msg: { action: "getSpeed" } };
      const badTab = { action: "relayToTab", tabId: "11", msg: { action: "getSpeed" } };

      expect(h.listener!(misrouted, {}, () => {})).toBeUndefined();
      expect(h.listener!(badTab, {}, () => {})).toBeUndefined();
      expect(h.tabMessages).toEqual([]);
    });

    it("falls back tab-wide when the owner frame sends no reply", () => {
      let response: unknown;
      h.listener!({ action: "icon", text: "1.25", live: false }, sender(12, 4));

      const keepsChannelOpen = h.listener!(
        { action: "relayToTab", tabId: 12, msg: { action: "silent" } },
        {},
        (r) => {
          response = r;
        },
      );

      expect(keepsChannelOpen).toBe(true);
      expect(h.tabMessages).toEqual([
        { tabId: 12, msg: { action: "silent" }, options: { frameId: 4 } },
        { tabId: 12, msg: { action: "silent" }, options: undefined },
      ]);
      expect(response).toEqual({ ok: true, action: "silent", frameId: null });
    });

    it("probes again after the cached video frame failed to answer", () => {
      h.listener!(
        { action: "relayToTab", tabId: 12, msg: { action: "stale" }, route: "video" },
        {},
        () => {},
      );

      expect(videoRelayTarget(12)).toBe(4);
      expect(h.scriptCalls).toHaveLength(2);
    });

    it("keeps the probed video frame when a badge-owner relay fails", () => {
      h.listener!({ action: "icon", text: "1.25", live: false }, sender(12, 4));
      expect(videoRelayTarget(12)).toBe(4);
      h.listener!({ action: "relayToTab", tabId: 12, msg: { action: "stale" } }, {}, () => {});

      expect(videoRelayTarget(12)).toBe(4);
      expect(h.scriptCalls).toHaveLength(1);
    });

    it("retries tab-wide when sending to the owner frame throws", () => {
      const responses: unknown[] = [];
      const setSpeed = { action: "relayToTab", tabId: 12, msg: { action: "setSpeed" } };
      h.listener!({ action: "icon", text: "1.25", live: false }, sender(12, 4));
      chromeApi().tabs.sendMessage = (tabId, msg, options, cb) => {
        h.tabMessages.push({ tabId, msg, options });
        if (options) throw new Error("No frame with id 4.");
        cb?.({ ok: true });
      };

      h.listener!(setSpeed, {}, (r) => responses.push(r));

      expect(h.tabMessages).toEqual([
        { tabId: 12, msg: { action: "setSpeed" }, options: { frameId: 4 } },
        { tabId: 12, msg: { action: "setSpeed" }, options: undefined },
      ]);
      expect(responses).toEqual([{ ok: true }]);
    });

    it("answers with no reply when the tab cannot be reached at all", () => {
      const responses: unknown[] = [];
      const setSpeed = { action: "relayToTab", tabId: 12, msg: { action: "setSpeed" } };
      h.listener!({ action: "icon", text: "1.25", live: false }, sender(12, 4));
      chromeApi().tabs.sendMessage = (tabId, msg, options) => {
        h.tabMessages.push({ tabId, msg, options });
        throw new Error("No tab with id: 12.");
      };

      h.listener!(setSpeed, {}, (r) => responses.push(r));

      expect(h.tabMessages).toHaveLength(2);
      expect(responses).toEqual([undefined]);
    });
  });

  describe("badge owners across worker restarts", () => {
    it("ignores malformed saved owners", async () => {
      h.session = { badgeOwners: { 7: 3, 8: "3" } };
      await restartWorker();

      h.listener!({ action: "icon", text: "1.0", live: false }, sender(7, 5));
      h.listener!({ action: "icon", text: "1.25", live: false }, sender(8, 5));

      expect(h.badgeText).toEqual([{ text: "1.25", tabId: 8 }]);
    });

    it("applies queued updates when reading the saved owners fails", async () => {
      let fail = () => {};
      chromeApi().storage.session.get = (_key, cb) => {
        fail = () => cb(undefined);
      };
      await restartWorker();
      h.listener!({ action: "icon", text: "1.5", live: false }, sender(7, 0));
      expect(h.badgeText).toEqual([]);

      fail();

      expect(h.badgeText).toEqual([{ text: "1.5", tabId: 7 }]);
    });

    it("falls back to in-memory owners when session storage throws", async () => {
      chromeApi().storage.session.get = () => {
        throw new Error("Access to storage is not allowed from this context.");
      };
      await restartWorker();

      h.listener!({ action: "icon", text: "1.5", live: false }, sender(7, 0));

      expect(h.badgeText).toEqual([{ text: "1.5", tabId: 7 }]);
    });
  });
});
