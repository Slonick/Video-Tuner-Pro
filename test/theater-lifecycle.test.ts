// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stream: false,
  values: {} as Record<string, unknown>,
  storageListener: null as
    | ((changes: Record<string, { newValue?: unknown }>, area: string) => void)
    | null,
  removeListener: vi.fn(),
  signal: null as unknown as AbortSignal,
  abortListener: null as (() => void) | null,
  ready: true,
  readyWaiters: [] as Array<() => void>,
}));

vi.mock("../src/content/platform/browser.js", () => ({
  api: {
    storage: {
      onChanged: {
        addListener: (listener: typeof h.storageListener) => {
          h.storageListener = listener;
        },
        removeListener: h.removeListener,
      },
    },
  },
}));
vi.mock("../src/content/platform/storage.js", () => ({
  // Default routing: every key lives in sync, so only sync-area changes are routed.
  routedChanges: (changes: Record<string, unknown>, area: string) =>
    area === "sync" ? changes : {},
  whenReady: (cb: () => void) => (h.ready ? cb() : h.readyWaiters.push(cb)),
  STORE: {
    get: (_keys: string[], callback: (values: Record<string, unknown>) => void) =>
      callback(h.values),
  },
}));
vi.mock("../src/content/live/detection.js", () => ({
  onStreamPage: () => h.stream,
}));
vi.mock("../src/content/lifecycle.js", () => ({
  contentSignal: h.signal,
}));

const load = async () => {
  vi.resetModules();
  return import("../src/content/theater.js");
};

beforeEach(() => {
  h.stream = false;
  h.values = {};
  h.storageListener = null;
  h.removeListener.mockClear();
  h.abortListener = null;
  h.ready = true;
  h.readyWaiters = [];
  h.signal = {
    addEventListener: (_type: string, listener: () => void) => {
      h.abortListener = listener;
    },
  } as unknown as AbortSignal;
  document.documentElement.removeAttribute("vtp-super-theater");
  document.head.innerHTML = "";
  vi.stubGlobal("location", { hostname: "www.youtube.com", pathname: "/watch" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("vtp-super-theater");
  document.head.innerHTML = "";
});

describe("super-theater lifecycle", () => {
  it("loads the regular setting and installs one listener", async () => {
    h.values = { superTheater: true, superTheaterStream: false };
    await load();

    expect(document.documentElement.hasAttribute("vtp-super-theater")).toBe(true);
    expect(document.querySelectorAll("#vtp-super-theater-style")).toHaveLength(1);
    expect(h.storageListener).toEqual(expect.any(Function));
  });

  it("switches to the stream setting when the live marker changes", async () => {
    h.values = { superTheater: true, superTheaterStream: false };
    await load();
    h.stream = true;
    document.documentElement.setAttribute("data-vtp-live", "1");
    await Promise.resolve();

    expect(document.documentElement.hasAttribute("vtp-super-theater")).toBe(false);
  });

  it("syncSuperTheater follows the site state: off drops the layout, on restores it", async () => {
    h.values = { superTheater: true, superTheaterStream: false };
    const mod = await load();
    const { S } = await import("../src/content/state.js"); // same registry as the module above
    expect(document.documentElement.hasAttribute("vtp-super-theater")).toBe(true);

    S.siteDisabled = true;
    mod.syncSuperTheater();
    expect(document.documentElement.hasAttribute("vtp-super-theater")).toBe(false);

    S.siteDisabled = false;
    mod.syncSuperTheater();
    expect(document.documentElement.hasAttribute("vtp-super-theater")).toBe(true);
  });

  it("reacts only to routed storage changes of the theater keys", async () => {
    h.values = { superTheater: false, superTheaterStream: false };
    await load();
    expect(h.storageListener).toEqual(expect.any(Function));

    h.values = { superTheater: true, superTheaterStream: false };
    h.storageListener!({ superTheater: { newValue: true } }, "managed");
    expect(document.documentElement.hasAttribute("vtp-super-theater")).toBe(false);

    // The stale copy in the area the key doesn't route to (another device's edit).
    h.storageListener!({ superTheater: { newValue: true } }, "local");
    expect(document.documentElement.hasAttribute("vtp-super-theater")).toBe(false);

    h.storageListener!({ unrelated: { newValue: true } }, "sync");
    expect(document.documentElement.hasAttribute("vtp-super-theater")).toBe(false);

    h.storageListener!({ superTheater: { newValue: true } }, "sync");
    expect(document.documentElement.hasAttribute("vtp-super-theater")).toBe(true);
  });

  it("reads the setting only once the sync config has loaded", async () => {
    h.ready = false;
    h.values = { superTheater: true, superTheaterStream: false };
    await load();
    expect(document.documentElement.hasAttribute("vtp-super-theater")).toBe(false);

    h.ready = true;
    h.readyWaiters.splice(0).forEach((cb) => cb());
    expect(document.documentElement.hasAttribute("vtp-super-theater")).toBe(true);
  });

  it("disconnects the live observer and storage listener on content teardown", async () => {
    await load();
    h.abortListener?.();
    expect(h.removeListener).toHaveBeenCalledTimes(1);
    expect(h.removeListener).toHaveBeenCalledWith(h.storageListener);

    h.stream = true;
    document.documentElement.setAttribute("data-vtp-live", "1");
    await Promise.resolve();
    expect(document.documentElement.hasAttribute("vtp-super-theater")).toBe(false);
  });
});
