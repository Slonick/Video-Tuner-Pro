// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// autoslow-config.ts owns the per-scope bundle persistence (with top-frame write
// guards), reset, live preview, and resolve-into-S. Mock channel + the rate
// re-apply; test the real storage/resolve logic against in-memory chrome storage.
const h = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("../src/content/channel.js", () => ({ channelKeys: () => h.keys }));
vi.mock("../src/content/speed.js", () => ({ reapplyPrimaryRate: vi.fn() }));

import { S } from "../src/content/state.js";
import { STORE } from "../src/content/platform/storage.js";
import {
  persistSiteAutoSlow,
  persistChannelAutoSlow,
  persistGlobalAutoSlow,
  resetAutoSlowScope,
  setAutoSlowPreview,
  applyResolvedAutoSlowFromStore,
} from "../src/content/audio/autoslow-config.js";

const get = (keys: string[]): Record<string, unknown> => {
  let out: Record<string, unknown> = {};
  STORE.get(keys, (r) => {
    out = r;
  });
  return out;
};
const sites = () => get(["autoSlowSites"]).autoSlowSites as Record<string, unknown>;
const channels = () => get(["autoSlowChannels"]).autoSlowChannels as Record<string, unknown>;

beforeEach(() => {
  STORE.set({ autoSlowSites: {}, autoSlowChannels: {} });
  STORE.remove("autoSlowGlobal");
  h.keys = [];
  S.autoSlowEnabled = false;
  S.autoSlowTarget = 6;
  S.autoSlowFactor = 1;
  S.autoSlowScope = null;
});
afterEach(() => {
  try {
    Object.defineProperty(window, "top", { value: window, configurable: true });
  } catch (e) {
    /* ignore */
  }
});

describe("persist", () => {
  it("writes the site bundle under the normalized domain (top frame)", () => {
    persistSiteAutoSlow({ target: 8 });
    expect(sites().localhost).toEqual({ target: 8 });
  });

  it("does NOT write the site bundle from a subframe", () => {
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    persistSiteAutoSlow({ target: 8 });
    expect(sites()).toEqual({});
  });

  it("stores the channel bundle under the canonical key, dropping the other form", () => {
    STORE.set({ autoSlowChannels: { "@h": { target: 5 } } });
    h.keys = ["UC1", "@h"];
    persistChannelAutoSlow({ target: 7 });
    expect(channels()).toEqual({ UC1: { target: 7 } });
  });

  it("does not mutate the previous maps while preparing a write", () => {
    const siteMap = { localhost: { target: 8 } };
    const channelMap = { UC1: { target: 6 }, "@h": { target: 6 } };
    STORE.set({ autoSlowSites: siteMap, autoSlowChannels: channelMap });
    h.keys = ["UC2", "@h"];

    persistSiteAutoSlow({ target: 9 });
    persistChannelAutoSlow({ target: 7 });

    expect(siteMap).toEqual({ localhost: { target: 8 } });
    expect(channelMap).toEqual({ UC1: { target: 6 }, "@h": { target: 6 } });
    expect(sites()).toEqual({ localhost: { target: 9 } });
    expect(channels()).toEqual({ UC1: { target: 6 }, UC2: { target: 7 } });
  });

  it("channel persist no-ops without a channel", () => {
    persistChannelAutoSlow({ target: 6 });
    expect(channels()).toEqual({});
  });

  it("writes the global bundle", () => {
    persistGlobalAutoSlow({ target: 9 });
    expect(get(["autoSlowGlobal"]).autoSlowGlobal).toEqual({ target: 9 });
  });

  it.each<[string, typeof persistSiteAutoSlow]>([
    ["site", persistSiteAutoSlow],
    ["channel", persistChannelAutoSlow],
    ["global", persistGlobalAutoSlow],
  ])("refuses a %s write from a subframe and reports failure", (_scope, persist) => {
    h.keys = ["UC1"];
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    const done = vi.fn();

    persist({ target: 8 }, done);
    persist({ target: 8 }); // no callback: still a quiet no-op

    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(false);
    expect(sites()).toEqual({});
    expect(channels()).toEqual({});
    expect(get(["autoSlowGlobal"]).autoSlowGlobal).toBeUndefined();
  });

  it("reports failure when there is no channel to write", () => {
    const done = vi.fn();
    persistChannelAutoSlow({ target: 6 }, done);
    expect(done).toHaveBeenCalledWith(false);
  });
});

// Only the TARGET resolves per scope now; the enable is a separate global flag.
describe("applyResolvedAutoSlowFromStore", () => {
  it("resolves the site bundle's target into S", () => {
    STORE.set({ autoSlowSites: { localhost: { target: 5 } } });
    applyResolvedAutoSlowFromStore();
    expect(S.autoSlowTarget).toBe(5);
    expect(S.autoSlowScope).toBe("site");
  });

  it("a channel bundle wins over site", () => {
    STORE.set({
      autoSlowSites: { localhost: { target: 4 } },
      autoSlowChannels: { UC1: { target: 9 } },
    });
    h.keys = ["UC1"];
    applyResolvedAutoSlowFromStore();
    expect(S.autoSlowTarget).toBe(9);
    expect(S.autoSlowScope).toBe("channel");
  });

  it("falls back to no scope (default target) when nothing is saved", () => {
    applyResolvedAutoSlowFromStore();
    expect(S.autoSlowScope).toBe(null);
    expect(S.autoSlowTarget).toBe(6);
  });

  it("falls back to the global bundle and confirms once resolved", () => {
    STORE.set({ autoSlowGlobal: { target: 9 } });
    const done = vi.fn();
    applyResolvedAutoSlowFromStore(done);
    expect(S.autoSlowTarget).toBe(9);
    expect(S.autoSlowScope).toBe("global");
    expect(done).toHaveBeenCalledWith(true);
  });
});

describe("resetAutoSlowScope", () => {
  it("clears the site entry and re-resolves to no scope", () => {
    STORE.set({ autoSlowSites: { localhost: { target: 8 } } });
    resetAutoSlowScope("site");
    expect(sites()).toBeUndefined();
    expect(S.autoSlowScope).toBe(null);
  });

  it("clears the global entry", () => {
    STORE.set({ autoSlowGlobal: { target: 7 } });
    resetAutoSlowScope("global");
    expect(get(["autoSlowGlobal"]).autoSlowGlobal).toBeUndefined();
  });

  it("clears the channel entry under every key form", () => {
    STORE.set({
      autoSlowChannels: { UC1: { target: 6 }, "@h": { target: 6 } },
    });
    h.keys = ["UC1", "@h"];
    resetAutoSlowScope("channel");
    expect(channels()).toBeUndefined();
  });

  it("does not mutate the previous maps while clearing a scope", () => {
    const siteMap = { localhost: { target: 8 } };
    const channelMap = { UC1: { target: 6 }, "@h": { target: 6 } };
    STORE.set({ autoSlowSites: siteMap, autoSlowChannels: channelMap });
    h.keys = ["UC1", "@h"];

    resetAutoSlowScope("channel");

    expect(siteMap).toEqual({ localhost: { target: 8 } });
    expect(channelMap).toEqual({ UC1: { target: 6 }, "@h": { target: 6 } });
    expect(channels()).toBeUndefined();
  });

  it("does not attempt a channel reset when no channel identity exists", () => {
    const done = vi.fn();
    STORE.set({ autoSlowChannels: { UC1: { target: 6 } } });

    resetAutoSlowScope("channel", done);

    expect(done).toHaveBeenCalledWith(false);
    expect(channels()).toEqual({ UC1: { target: 6 } });
  });

  it("re-resolves to the next scope in the chain and confirms", () => {
    STORE.set({ autoSlowSites: { localhost: { target: 8 } }, autoSlowGlobal: { target: 7 } });
    applyResolvedAutoSlowFromStore();
    expect(S.autoSlowScope).toBe("site");
    const done = vi.fn();

    resetAutoSlowScope("site", done);

    expect(S.autoSlowScope).toBe("global");
    expect(S.autoSlowTarget).toBe(7);
    expect(done).toHaveBeenCalledWith(true);
  });

  it("reports a failed clear without re-resolving", () => {
    STORE.set({ autoSlowSites: { localhost: { target: 8 } } });
    applyResolvedAutoSlowFromStore();
    const failing = (_msg: unknown, reply?: (r: unknown) => void) => reply?.({ success: false });
    const send = vi.spyOn(globalThis.chrome.runtime, "sendMessage");
    send.mockImplementation(failing as never);
    try {
      const done = vi.fn();
      resetAutoSlowScope("site", done);
      expect(done).toHaveBeenCalledTimes(1);
      expect(done).toHaveBeenCalledWith(false);
      expect(sites()).toEqual({ localhost: { target: 8 } });
      expect(S.autoSlowScope).toBe("site");
    } finally {
      send.mockRestore();
    }
  });

  it("tolerates a missing callback when a clear fails asynchronously", () => {
    vi.useFakeTimers();
    const failing = (_msg: unknown, reply?: (r: unknown) => void) => {
      setTimeout(() => reply?.({ success: false }), 0);
    };
    const send = vi.spyOn(globalThis.chrome.runtime, "sendMessage");
    send.mockImplementation(failing as never);
    try {
      resetAutoSlowScope("site");
      expect(() => vi.runAllTimers()).not.toThrow();
    } finally {
      send.mockRestore();
      vi.useRealTimers();
    }
  });

  it("tolerates a missing callback when there is no channel to clear", () => {
    expect(() => resetAutoSlowScope("channel")).not.toThrow();
  });
});

describe("setAutoSlowPreview", () => {
  it("applies the target live without persisting", () => {
    setAutoSlowPreview({ target: 10 });
    expect(S.autoSlowTarget).toBe(10);
    expect(get(["autoSlowGlobal"]).autoSlowGlobal).toBeUndefined();
  });
});

describe("dead extension context", () => {
  it("rejects writes and resolution when the runtime id disappears", () => {
    const done = vi.fn();
    const runtime = globalThis.chrome.runtime as { id?: string };
    const saved = runtime.id;
    runtime.id = undefined;
    try {
      persistGlobalAutoSlow({ target: 8 }, done);
      applyResolvedAutoSlowFromStore(done);
      expect(done).toHaveBeenNthCalledWith(1, false);
      expect(done).toHaveBeenNthCalledWith(2, false);
      expect(get(["autoSlowGlobal"]).autoSlowGlobal).toBeUndefined();
    } finally {
      runtime.id = saved;
    }
  });

  it("refuses channel writes and scope clears, tolerating missing callbacks, when the runtime id disappears", () => {
    STORE.set({ autoSlowSites: { localhost: { target: 8 } } });
    h.keys = ["UC1"];
    const done = vi.fn();
    const runtime = globalThis.chrome.runtime as { id?: string };
    const saved = runtime.id;
    runtime.id = undefined;
    try {
      persistChannelAutoSlow({ target: 7 }, done);
      resetAutoSlowScope("site", done);
      expect(done).toHaveBeenNthCalledWith(1, false);
      expect(done).toHaveBeenNthCalledWith(2, false);
      expect(channels()).toEqual({});
      expect(sites()).toEqual({ localhost: { target: 8 } });
      expect(() => {
        resetAutoSlowScope("site");
        applyResolvedAutoSlowFromStore();
        persistGlobalAutoSlow({ target: 8 });
      }).not.toThrow();
    } finally {
      runtime.id = saved;
    }
  });
});
