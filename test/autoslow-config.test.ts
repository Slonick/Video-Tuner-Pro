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
    persistSiteAutoSlow({ on: true, target: 8 });
    expect(sites().localhost).toEqual({ on: true, target: 8 });
  });

  it("does NOT write the site bundle from a subframe", () => {
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    persistSiteAutoSlow({ on: true, target: 8 });
    expect(sites()).toEqual({});
  });

  it("stores the channel bundle under the canonical key, dropping the other form", () => {
    STORE.set({ autoSlowChannels: { "@h": { on: true, target: 5 } } });
    h.keys = ["UC1", "@h"];
    persistChannelAutoSlow({ on: false, target: 7 });
    expect(channels()).toEqual({ UC1: { on: false, target: 7 } });
  });

  it("channel persist no-ops without a channel", () => {
    persistChannelAutoSlow({ on: true, target: 6 });
    expect(channels()).toEqual({});
  });

  it("writes the global bundle", () => {
    persistGlobalAutoSlow({ on: true, target: 9 });
    expect(get(["autoSlowGlobal"]).autoSlowGlobal).toEqual({ on: true, target: 9 });
  });
});

describe("applyResolvedAutoSlowFromStore", () => {
  it("resolves the site bundle into S", () => {
    STORE.set({ autoSlowSites: { localhost: { on: true, target: 5 } } });
    applyResolvedAutoSlowFromStore();
    expect(S.autoSlowEnabled).toBe(true);
    expect(S.autoSlowTarget).toBe(5);
    expect(S.autoSlowScope).toBe("site");
  });

  it("a channel bundle wins over site", () => {
    STORE.set({
      autoSlowSites: { localhost: { on: false, target: 4 } },
      autoSlowChannels: { UC1: { on: true, target: 9 } },
    });
    h.keys = ["UC1"];
    applyResolvedAutoSlowFromStore();
    expect(S.autoSlowEnabled).toBe(true);
    expect(S.autoSlowTarget).toBe(9);
    expect(S.autoSlowScope).toBe("channel");
  });

  it("defaults to off when nothing is saved", () => {
    applyResolvedAutoSlowFromStore();
    expect(S.autoSlowEnabled).toBe(false);
    expect(S.autoSlowScope).toBe(null);
  });
});

describe("resetAutoSlowScope", () => {
  it("clears the site entry and re-resolves to off", () => {
    STORE.set({ autoSlowSites: { localhost: { on: true, target: 8 } } });
    resetAutoSlowScope("site");
    expect(sites()).toEqual({});
    expect(S.autoSlowEnabled).toBe(false);
  });

  it("clears the global entry", () => {
    STORE.set({ autoSlowGlobal: { on: true, target: 7 } });
    resetAutoSlowScope("global");
    expect(get(["autoSlowGlobal"]).autoSlowGlobal).toBeUndefined();
  });

  it("clears the channel entry under every key form", () => {
    STORE.set({
      autoSlowChannels: { UC1: { on: true, target: 6 }, "@h": { on: true, target: 6 } },
    });
    h.keys = ["UC1", "@h"];
    resetAutoSlowScope("channel");
    expect(channels()).toEqual({});
  });
});

describe("setAutoSlowPreview", () => {
  it("applies live without persisting", () => {
    setAutoSlowPreview({ on: true, target: 10 });
    expect(S.autoSlowEnabled).toBe(true);
    expect(S.autoSlowTarget).toBe(10);
    expect(get(["autoSlowGlobal"]).autoSlowGlobal).toBeUndefined();
  });

  it("resets the live factor when turned off", () => {
    S.autoSlowFactor = 0.7;
    setAutoSlowPreview({ on: false, target: 6 });
    expect(S.autoSlowEnabled).toBe(false);
    expect(S.autoSlowFactor).toBe(1);
  });
});
