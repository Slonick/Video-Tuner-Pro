import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (msg: Record<string, unknown>, sender: Record<string, unknown>) => void;

const h = vi.hoisted(() => ({
  listener: null as Listener | null,
  badgeText: [] as unknown[],
  icons: [] as unknown[],
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
    h.badgeText = [];
    h.icons = [];
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
        onUpdated: { addListener() {} },
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
});
