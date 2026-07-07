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
});

describe("setAutoSlowPreview", () => {
  it("applies the target live without persisting", () => {
    setAutoSlowPreview({ target: 10 });
    expect(S.autoSlowTarget).toBe(10);
    expect(get(["autoSlowGlobal"]).autoSlowGlobal).toBeUndefined();
  });
});
