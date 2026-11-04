import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (
  msg: Record<string, unknown>,
  sender: Record<string, unknown>,
  sendResponse: (resp?: unknown) => void,
) => unknown;

const h = vi.hoisted(() => ({
  listener: null as Listener | null,
  injections: [] as unknown[],
  rejectInjection: false,
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

// Swaps the injection API on the chrome object the background bound to at import.
function injectWith(executeScript: (args: unknown, cb?: () => void) => unknown): void {
  const api = globalThis as unknown as { chrome: { scripting: { executeScript: unknown } } };
  api.chrome.scripting.executeScript = executeScript;
}

describe("background quality bridge injection", () => {
  beforeEach(async () => {
    vi.resetModules();
    h.listener = null;
    h.injections = [];
    h.rejectInjection = false;
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
        setBadgeText() {},
        setBadgeBackgroundColor() {},
        setBadgeTextColor() {},
        setIcon() {},
      },
      tabs: {
        onUpdated: { addListener() {} },
        onRemoved: { addListener() {} },
      },
      scripting: {
        executeScript(args: unknown, cb?: () => void) {
          h.injections.push(args);
          // Firefox's promise-returning API, failing because the frame is gone.
          if (h.rejectInjection) return Promise.reject(new Error("No frame"));
          cb?.();
        },
      },
      alarms: {
        onAlarm: { addListener() {} },
        create() {},
      },
      storage: { local: { set() {} } },
    };

    // Fresh per test, after the mock: the background registers its listeners on import.
    await import("../src/background/index.js");
  });

  it("injects the bridge into the page world of only the frame that asked", () => {
    let response: unknown;
    const reply = (r: unknown) => {
      response = r;
    };

    const keepsChannelOpen = h.listener!({ action: "injectQualityBridge" }, sender(7, 3), reply);

    expect(h.injections).toEqual([
      { target: { tabId: 7, frameIds: [3] }, world: "MAIN", files: ["quality-inject.js"] },
    ]);
    expect(response).toEqual({ ok: true });
    expect(keepsChannelOpen).toBe(true);
  });

  it("reports a failed injection so the page loader can ask again", async () => {
    h.rejectInjection = true;
    let response: unknown;

    h.listener!({ action: "injectQualityBridge" }, sender(7, 0), (r) => {
      response = r;
    });

    await vi.waitFor(() => expect(response).toEqual({ ok: false }));
  });

  it("does not inject for a sender outside a tab frame", () => {
    let response: unknown;

    h.listener!({ action: "injectQualityBridge" }, {}, (r) => {
      response = r;
    });

    expect(h.injections).toEqual([]);
    expect(response).toEqual({ ok: false });
  });

  it("refuses a sender it cannot address by both tab and frame", () => {
    const responses: unknown[] = [];

    h.listener!({ action: "injectQualityBridge" }, { tab: { id: 7 } }, (r) => responses.push(r));
    h.listener!({ action: "injectQualityBridge" }, { frameId: 0 }, (r) => responses.push(r));

    expect(h.injections).toEqual([]);
    expect(responses).toEqual([{ ok: false }, { ok: false }]);
  });

  it("waits for a callback that arrives after executeScript returns", () => {
    const responses: unknown[] = [];
    let complete = () => {};
    injectWith((args, cb) => {
      h.injections.push(args);
      complete = () => cb?.();
    });

    h.listener!({ action: "injectQualityBridge" }, sender(7, 3), (r) => responses.push(r));
    expect(responses).toEqual([]);
    complete();

    expect(responses).toEqual([{ ok: true }]);
  });

  it("answers once when the browser both calls back and resolves", async () => {
    const responses: unknown[] = [];
    injectWith((_args, cb) => {
      cb?.();
      return Promise.resolve([]);
    });

    h.listener!({ action: "injectQualityBridge" }, sender(7, 3), (r) => responses.push(r));
    // The resolved promise's reaction is already queued: one microtask lets it run.
    await Promise.resolve();

    expect(responses).toEqual([{ ok: true }]);
  });

  it("reports a promise-only injection once it resolves", async () => {
    const responses: unknown[] = [];
    injectWith(() => Promise.resolve([]));

    h.listener!({ action: "injectQualityBridge" }, sender(7, 3), (r) => responses.push(r));

    await vi.waitFor(() => expect(responses).toEqual([{ ok: true }]));
  });

  it("reports an injection the browser refuses outright", () => {
    const responses: unknown[] = [];
    injectWith(() => {
      throw new Error("No frame with id 3 in tab 7.");
    });

    h.listener!({ action: "injectQualityBridge" }, sender(7, 3), (r) => responses.push(r));

    expect(responses).toEqual([{ ok: false }]);
  });
});
