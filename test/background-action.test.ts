import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The manifest has no default_popup, so the toolbar click is the main way to open
// the UI: it must reach only the top frame's content script. So must a click on the
// on-video button inside an embedded player.
type Listener = (
  msg: unknown,
  sender: { tab?: Record<string, unknown>; frameId?: number },
  sendResponse: (resp?: unknown) => void,
) => unknown;

const h = vi.hoisted(() => ({
  clicked: null as ((tab: { id?: number }) => void) | null,
  message: null as Listener | null,
  tabMessages: [] as Array<{ tabId: number; msg: unknown; options: unknown }>,
  optionsOpened: 0,
  consent: (() => Promise.resolve(true)) as () => Promise<boolean>,
}));

describe("toolbar icon click", () => {
  beforeEach(async () => {
    vi.resetModules();
    h.clicked = null;
    h.message = null;
    h.tabMessages = [];
    h.optionsOpened = 0;
    h.consent = () => Promise.resolve(true);
    vi.doMock("../src/shared/sponsor-consent.js", () => ({
      hasSponsorDataConsent: () => h.consent(),
    }));
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
      hasUpdateApi: () => false,
      cmpVersion: () => 0,
      currentVersion: () => "0.0.0",
      fetchAmoLatest: () => Promise.resolve(null),
    }));
    const area = {
      get(_keys: unknown, cb?: (items: Record<string, unknown>) => void) {
        cb?.({});
      },
      set(_obj: unknown, cb?: () => void) {
        cb?.();
      },
    };
    (globalThis as unknown as { browser?: unknown }).browser = undefined;
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        lastError: null,
        onMessage: {
          addListener(fn: Listener) {
            h.message = fn;
          },
        },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onUpdateAvailable: { addListener() {} },
        requestUpdateCheck() {},
        openOptionsPage() {
          h.optionsOpened++;
        },
      },
      action: {
        setBadgeText() {},
        setBadgeBackgroundColor() {},
        setBadgeTextColor() {},
        setIcon() {},
        onClicked: {
          addListener(fn: (tab: { id?: number }) => void) {
            h.clicked = fn;
          },
        },
      },
      alarms: { onAlarm: { addListener() {} }, create() {} },
      storage: { sync: area, local: area, session: area },
      tabs: {
        sendMessage(tabId: number, msg: unknown, options?: unknown) {
          h.tabMessages.push({ tabId, msg, options });
        },
        onUpdated: { addListener() {} },
        onRemoved: { addListener() {} },
      },
    };
    await import("../src/background/index.js");
  });

  afterEach(() => {
    vi.doUnmock("../src/shared/store.js");
    vi.doUnmock("../src/shared/update.js");
    vi.doUnmock("../src/shared/sponsor-consent.js");
  });

  it("asks only the top frame to toggle the in-page overlay", async () => {
    h.clicked!({ id: 5 });
    await vi.waitFor(() => expect(h.tabMessages).toHaveLength(1));

    expect(h.tabMessages).toEqual([
      { tabId: 5, msg: { action: "toggleOverlay" }, options: { frameId: 0 } },
    ]);
  });

  it("ignores a click without a tab id", async () => {
    h.clicked!({});
    await Promise.resolve();

    expect(h.tabMessages).toEqual([]);
  });

  it("opens the overlay an embedded player's button asks for in the top frame", async () => {
    h.message!({ action: "toggleOverlay" }, { tab: { id: 7 }, frameId: 3 }, () => {});
    await vi.waitFor(() => expect(h.tabMessages).toHaveLength(1));

    expect(h.tabMessages).toEqual([
      { tabId: 7, msg: { action: "toggleOverlay" }, options: { frameId: 0 } },
    ]);
  });

  it("ignores an overlay request from outside a tab", async () => {
    h.message!({ action: "toggleOverlay" }, {}, () => {});
    await Promise.resolve();

    expect(h.tabMessages).toEqual([]);
  });

  it("opens the options page the embedded popup's gear asks for", () => {
    h.message!({ action: "openOptions" }, { tab: { id: 7 }, frameId: 3 }, () => {});

    expect(h.optionsOpened).toBe(1);
  });

  it("tells the embedded popup only which tab hosts it", () => {
    const replies: unknown[] = [];
    const tab = { id: 7, url: "https://www.twitch.tv/example", title: "Example", active: true };

    h.message!({ action: "whoami" }, { tab, frameId: 3 }, (r) => replies.push(r));
    h.message!({ action: "whoami" }, {}, (r) => replies.push(r));

    expect(replies).toEqual([
      { tab: { id: 7, url: "https://www.twitch.tv/example" } },
      { tab: undefined },
    ]);
  });

  it("passes on the sponsor-data consent, treating a failed lookup as not granted", async () => {
    const replies: unknown[] = [];

    const keepsChannelOpen = h.message!({ action: "sponsorConsentStatus" }, {}, (r) =>
      replies.push(r),
    );
    h.consent = () => Promise.reject(new Error("permissions.getAll() failed"));
    h.message!({ action: "sponsorConsentStatus" }, {}, (r) => replies.push(r));

    expect(keepsChannelOpen).toBe(true);
    await vi.waitFor(() => expect(replies).toEqual([{ granted: true }, { granted: false }]));
  });
});
