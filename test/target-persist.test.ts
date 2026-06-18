// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// live/target.ts owns per-scope allowed-delay persistence (with the top-frame
// write guards), reset, and the live preview. Mock channel + controlLive; test
// the real storage/resolve/clamp logic against in-memory chrome storage.
const h = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("../src/content/channel.js", () => ({ channelKeys: () => h.keys }));
vi.mock("../src/content/live/sync.js", () => ({ controlLive: vi.fn() }));

import { S } from "../src/content/state.js";
import { STORE } from "../src/content/platform/storage.js";
import {
  persistSiteTarget,
  persistChannelTarget,
  persistGlobalTarget,
  resetTargetScope,
  setTarget,
  applyResolvedTargetFromStore,
} from "../src/content/live/target.js";

const get = (keys: string[]): Record<string, unknown> => {
  let out: Record<string, unknown> = {};
  STORE.get(keys, (r) => {
    out = r;
  });
  return out;
};

beforeEach(() => {
  STORE.set({ syncTargets: {}, syncTargetChannels: {} });
  STORE.remove(["syncTargetGlobal", "liveSyncTarget"]);
  h.keys = [];
  S.liveSyncTarget = 5;
  S.targetScope = null;
});
afterEach(() => {
  try {
    Object.defineProperty(window, "top", { value: window, configurable: true });
  } catch (e) {
    /* ignore */
  }
});

describe("persistSiteTarget", () => {
  it("writes under the normalized domain (top frame)", () => {
    persistSiteTarget(8);
    expect((get(["syncTargets"]).syncTargets as Record<string, number>).localhost).toBe(8);
  });

  it("does NOT write from a subframe", () => {
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    persistSiteTarget(8);
    expect(get(["syncTargets"]).syncTargets).toEqual({});
  });
});

describe("persistChannelTarget", () => {
  it("stores under the canonical key, dropping the other form", () => {
    STORE.set({ syncTargetChannels: { "@h": 10 } });
    h.keys = ["UC1", "@h"];
    persistChannelTarget(7);
    expect(get(["syncTargetChannels"]).syncTargetChannels).toEqual({ UC1: 7 });
  });

  it("no-ops without a channel", () => {
    persistChannelTarget(7);
    expect(get(["syncTargetChannels"]).syncTargetChannels).toEqual({});
  });
});

describe("persistGlobalTarget", () => {
  it("writes the global target", () => {
    persistGlobalTarget(12);
    expect(get(["syncTargetGlobal"]).syncTargetGlobal).toBe(12);
  });
});

describe("resetTargetScope", () => {
  it("channel: drops keys and falls back to the site target", () => {
    STORE.set({ syncTargetChannels: { UC1: 3, "@h": 3 }, syncTargets: { localhost: 8 } });
    h.keys = ["UC1", "@h"];
    resetTargetScope("channel");
    expect(get(["syncTargetChannels"]).syncTargetChannels).toEqual({});
    expect(S.liveSyncTarget).toBe(8);
    expect(S.targetScope).toBe("site");
  });

  it("site: clears the domain target and falls back to global", () => {
    STORE.set({ syncTargets: { localhost: 8 }, syncTargetGlobal: 12 });
    resetTargetScope("site");
    expect(get(["syncTargets"]).syncTargets).toEqual({});
    expect(S.liveSyncTarget).toBe(12);
    expect(S.targetScope).toBe("global");
  });

  it("global: clears the new + legacy global and falls back to the 5s default", () => {
    STORE.set({ syncTargetGlobal: 12, liveSyncTarget: 20 });
    resetTargetScope("global");
    expect(get(["syncTargetGlobal"]).syncTargetGlobal).toBeUndefined();
    expect(S.liveSyncTarget).toBe(5);
    expect(S.targetScope).toBeNull();
  });
});

describe("setTarget (live preview)", () => {
  it("clamps and sets the live target without persisting", () => {
    setTarget(0); // floored to 1
    expect(S.liveSyncTarget).toBe(1);
    setTarget(99); // capped at 30
    expect(S.liveSyncTarget).toBe(30);
    expect(get(["syncTargets"]).syncTargets).toEqual({}); // nothing written
  });
});

describe("applyResolvedTargetFromStore", () => {
  it("resolves the chain from storage (channel wins)", () => {
    STORE.set({
      syncTargetChannels: { UC1: 3 },
      syncTargets: { localhost: 8 },
      syncTargetGlobal: 12,
    });
    h.keys = ["UC1"];
    applyResolvedTargetFromStore();
    expect(S.liveSyncTarget).toBe(3);
    expect(S.targetScope).toBe("channel");
  });

  it("folds the legacy liveSyncTarget in as the old global", () => {
    STORE.set({ liveSyncTarget: 18 });
    applyResolvedTargetFromStore();
    expect(S.liveSyncTarget).toBe(18);
    expect(S.targetScope).toBe("global");
  });
});

describe("dead extension context — never writes", () => {
  let savedId: unknown;
  beforeEach(() => {
    savedId = globalThis.chrome.runtime.id;
    (globalThis.chrome.runtime as { id?: unknown }).id = undefined;
  });
  afterEach(() => {
    (globalThis.chrome.runtime as { id?: unknown }).id = savedId;
  });

  it("persistSiteTarget bails", () => {
    persistSiteTarget(8);
    expect(get(["syncTargets"]).syncTargets).toEqual({});
  });

  it("resetTargetScope bails", () => {
    STORE.set({ syncTargets: { localhost: 8 } });
    resetTargetScope("site");
    expect((get(["syncTargets"]).syncTargets as Record<string, number>).localhost).toBe(8);
  });
});
