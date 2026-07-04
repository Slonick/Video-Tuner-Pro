// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("../src/content/channel.js", () => ({ channelKeys: () => h.keys }));

import { S } from "../src/content/state.js";
import { STORE } from "../src/content/platform/storage.js";
import {
  applyResolvedViewerAutoFromStore,
  persistChannelViewerAuto,
  persistGlobalViewerAuto,
  persistSiteViewerAuto,
  resetViewerAutoScope,
} from "../src/content/viewer-auto.js";

const get = (keys: string[]): Record<string, unknown> => {
  let out: Record<string, unknown> = {};
  STORE.get(keys, (r) => {
    out = r;
  });
  return out;
};
const sites = () => get(["viewerAutoSites"]).viewerAutoSites as Record<string, unknown>;
const channels = () => get(["viewerAutoChannels"]).viewerAutoChannels as Record<string, unknown>;

beforeEach(() => {
  STORE.set({ viewerAutoSites: {}, viewerAutoChannels: {} });
  STORE.remove(["viewerAutoGlobal", "viewerAuto"]);
  h.keys = [];
  S.viewerAuto = "off";
  S.viewerAutoScope = null;
});
afterEach(() => {
  try {
    Object.defineProperty(window, "top", { value: window, configurable: true });
  } catch (e) {
    /* ignore */
  }
});

describe("viewer auto persistence", () => {
  it("writes the site mode under the normalized domain", () => {
    persistSiteViewerAuto("normal");
    expect(sites().localhost).toBe("normal");
  });

  it("does not write site mode from a subframe", () => {
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    persistSiteViewerAuto("theater");
    expect(sites()).toEqual({});
  });

  it("stores the channel mode under the canonical key", () => {
    STORE.set({ viewerAutoChannels: { "@h": "off" } });
    h.keys = ["UC1", "@h"];
    persistChannelViewerAuto("theater");
    expect(channels()).toEqual({ UC1: "theater" });
  });

  it("writes the global mode", () => {
    persistGlobalViewerAuto("normal");
    expect(get(["viewerAutoGlobal"]).viewerAutoGlobal).toBe("normal");
  });
});

describe("applyResolvedViewerAutoFromStore", () => {
  it("resolves site mode into state", () => {
    STORE.set({ viewerAutoSites: { localhost: "normal" } });
    applyResolvedViewerAutoFromStore();
    expect(S.viewerAuto).toBe("normal");
    expect(S.viewerAutoScope).toBe("site");
  });

  it("channel mode wins over site mode", () => {
    STORE.set({
      viewerAutoSites: { localhost: "normal" },
      viewerAutoChannels: { UC1: "off" },
    });
    h.keys = ["UC1"];
    applyResolvedViewerAutoFromStore();
    expect(S.viewerAuto).toBe("off");
    expect(S.viewerAutoScope).toBe("channel");
  });

  it("uses legacy viewerAuto as a global fallback", () => {
    STORE.set({ viewerAuto: "theater" });
    applyResolvedViewerAutoFromStore();
    expect(S.viewerAuto).toBe("theater");
    expect(S.viewerAutoScope).toBe("global");
  });
});

describe("resetViewerAutoScope", () => {
  it("clears the site entry and re-resolves", () => {
    STORE.set({ viewerAutoGlobal: "theater", viewerAutoSites: { localhost: "normal" } });
    resetViewerAutoScope("site");
    expect(sites()).toEqual({});
    expect(S.viewerAuto).toBe("theater");
    expect(S.viewerAutoScope).toBe("global");
  });

  it("clears global and legacy entries", () => {
    STORE.set({ viewerAutoGlobal: "normal", viewerAuto: "theater" });
    resetViewerAutoScope("global");
    expect(get(["viewerAutoGlobal", "viewerAuto"]).viewerAutoGlobal).toBeUndefined();
    expect(get(["viewerAutoGlobal", "viewerAuto"]).viewerAuto).toBeUndefined();
    expect(S.viewerAuto).toBe("off");
  });
});
