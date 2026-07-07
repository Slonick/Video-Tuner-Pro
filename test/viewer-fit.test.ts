// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("../src/content/channel.js", () => ({ channelKeys: () => h.keys }));

import { S } from "../src/content/state.js";
import { STORE } from "../src/content/platform/storage.js";
import {
  applyResolvedViewerFitFromStore,
  persistChannelViewerFit,
  persistGlobalViewerFit,
  persistSiteViewerFit,
  resetViewerFitScope,
} from "../src/content/viewer-fit.js";

const get = (keys: string[]): Record<string, unknown> => {
  let out: Record<string, unknown> = {};
  STORE.get(keys, (r) => {
    out = r;
  });
  return out;
};
const sites = () => get(["viewerFitSites"]).viewerFitSites as Record<string, unknown>;
const channels = () => get(["viewerFitChannels"]).viewerFitChannels as Record<string, unknown>;

beforeEach(() => {
  STORE.set({ viewerFitSites: {}, viewerFitChannels: {} });
  STORE.remove(["viewerFitGlobal"]);
  h.keys = [];
  S.viewerFit = "contain";
  S.viewerFitScope = null;
});
afterEach(() => {
  try {
    Object.defineProperty(window, "top", { value: window, configurable: true });
  } catch (e) {
    /* ignore */
  }
});

describe("viewer fit persistence", () => {
  it("writes the site mode under the normalized domain", () => {
    persistSiteViewerFit("cover");
    expect(sites().localhost).toBe("cover");
  });

  it("does not write site mode from a subframe", () => {
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    persistSiteViewerFit("fill");
    expect(sites()).toEqual({});
  });

  it("stores the channel mode under the canonical key", () => {
    STORE.set({ viewerFitChannels: { "@h": "cover" } });
    h.keys = ["UC1", "@h"];
    persistChannelViewerFit("fill");
    expect(channels()).toEqual({ UC1: "fill" });
  });

  it("writes the global mode", () => {
    persistGlobalViewerFit("cover");
    expect(get(["viewerFitGlobal"]).viewerFitGlobal).toBe("cover");
  });
});

describe("applyResolvedViewerFitFromStore", () => {
  it("resolves site mode into state", () => {
    STORE.set({ viewerFitSites: { localhost: "cover" } });
    applyResolvedViewerFitFromStore();
    expect(S.viewerFit).toBe("cover");
    expect(S.viewerFitScope).toBe("site");
  });

  it("channel mode wins over site mode", () => {
    STORE.set({
      viewerFitSites: { localhost: "cover" },
      viewerFitChannels: { UC1: "fill" },
    });
    h.keys = ["UC1"];
    applyResolvedViewerFitFromStore();
    expect(S.viewerFit).toBe("fill");
    expect(S.viewerFitScope).toBe("channel");
  });
});

describe("resetViewerFitScope", () => {
  it("clears the site entry and re-resolves to global", () => {
    STORE.set({ viewerFitGlobal: "fill", viewerFitSites: { localhost: "cover" } });
    resetViewerFitScope("site");
    expect(sites()).toBeUndefined();
    expect(S.viewerFit).toBe("fill");
    expect(S.viewerFitScope).toBe("global");
  });

  it("clears all channel aliases and re-resolves to site", () => {
    STORE.set({
      viewerFitSites: { localhost: "cover" },
      viewerFitChannels: { UC1: "fill", "@h": "fill" },
    });
    h.keys = ["UC1", "@h"];
    resetViewerFitScope("channel");
    expect(channels()).toBeUndefined();
    expect(S.viewerFit).toBe("cover");
    expect(S.viewerFitScope).toBe("site");
  });

  it("clears global mode and falls back to contain", () => {
    STORE.set({ viewerFitGlobal: "fill" });
    resetViewerFitScope("global");
    expect(get(["viewerFitGlobal"]).viewerFitGlobal).toBeUndefined();
    expect(S.viewerFit).toBe("contain");
    expect(S.viewerFitScope).toBeNull();
  });
});
