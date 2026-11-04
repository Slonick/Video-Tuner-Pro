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
import { controlLive } from "../src/content/live/sync.js";
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
    const done = vi.fn();
    persistSiteTarget(8, done);
    expect(done).toHaveBeenCalledWith(false); // the caller learns the save was refused
  });
});

describe("persistChannelTarget", () => {
  it("stores under the canonical key, dropping the other form", () => {
    STORE.set({ syncTargetChannels: { "@h": 10 } });
    h.keys = ["UC1", "@h"];
    persistChannelTarget(7);
    expect(get(["syncTargetChannels"]).syncTargetChannels).toEqual({ UC1: 7 });
  });

  it("does not mutate the previous target maps while preparing a write", () => {
    const siteMap = { localhost: 8 };
    const channelMap = { UC1: 6, "@h": 6 };
    STORE.set({ syncTargets: siteMap, syncTargetChannels: channelMap });
    h.keys = ["UC2", "@h"];

    persistSiteTarget(9);
    persistChannelTarget(7);

    expect(siteMap).toEqual({ localhost: 8 });
    expect(channelMap).toEqual({ UC1: 6, "@h": 6 });
    expect(get(["syncTargets"]).syncTargets).toEqual({ localhost: 9 });
    expect(get(["syncTargetChannels"]).syncTargetChannels).toEqual({ UC1: 6, UC2: 7 });
  });

  it("no-ops without a channel", () => {
    persistChannelTarget(7);
    expect(get(["syncTargetChannels"]).syncTargetChannels).toEqual({});
    const done = vi.fn();
    persistChannelTarget(7, done);
    expect(done).toHaveBeenCalledWith(false);
  });

  it("does NOT write from a subframe", () => {
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    h.keys = ["UC1"];
    const done = vi.fn();
    persistChannelTarget(7);
    persistChannelTarget(7, done);
    expect(done).toHaveBeenCalledWith(false);
    expect(get(["syncTargetChannels"]).syncTargetChannels).toEqual({});
  });
});

describe("persistGlobalTarget", () => {
  it("writes the global target", () => {
    STORE.set({ liveSyncTarget: 20 });
    persistGlobalTarget(12);
    expect(get(["syncTargetGlobal"]).syncTargetGlobal).toBe(12);
    expect(get(["liveSyncTarget"]).liveSyncTarget).toBeUndefined();
  });

  it("does NOT write from a subframe", () => {
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    const done = vi.fn();
    persistGlobalTarget(12);
    persistGlobalTarget(12, done);
    expect(done).toHaveBeenCalledWith(false);
    expect(get(["syncTargetGlobal"]).syncTargetGlobal).toBeUndefined();
  });

  it("reports a failed write and keeps the legacy global it would replace", () => {
    STORE.set({ liveSyncTarget: 20 });
    const set = vi.spyOn(STORE, "set").mockImplementation((_items, cb) => cb?.(false));
    const done = vi.fn();
    try {
      persistGlobalTarget(12);
      persistGlobalTarget(12, done);
    } finally {
      set.mockRestore();
    }
    expect(done).toHaveBeenCalledWith(false);
    expect(get(["liveSyncTarget"]).liveSyncTarget).toBe(20);
  });
});

describe("resetTargetScope", () => {
  it("channel: drops keys and falls back to the site target", () => {
    STORE.set({ syncTargetChannels: { UC1: 3, "@h": 3 }, syncTargets: { localhost: 8 } });
    h.keys = ["UC1", "@h"];
    resetTargetScope("channel");
    expect(get(["syncTargetChannels"]).syncTargetChannels).toBeUndefined();
    expect(S.liveSyncTarget).toBe(8);
    expect(S.targetScope).toBe("site");
  });

  it("does not mutate the previous maps while clearing a scope", () => {
    const siteMap = { localhost: 8 };
    const channelMap = { UC1: 3, "@h": 3 };
    STORE.set({ syncTargets: siteMap, syncTargetChannels: channelMap });
    h.keys = ["UC1", "@h"];

    resetTargetScope("channel");

    expect(siteMap).toEqual({ localhost: 8 });
    expect(channelMap).toEqual({ UC1: 3, "@h": 3 });
    expect(get(["syncTargetChannels"]).syncTargetChannels).toBeUndefined();
  });

  it("site: clears the domain target and falls back to global", () => {
    STORE.set({ syncTargets: { localhost: 8 }, syncTargetGlobal: 12 });
    resetTargetScope("site");
    expect(get(["syncTargets"]).syncTargets).toBeUndefined();
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

  it("channel: refuses without a channel identity, leaving saved channels alone", () => {
    STORE.set({ syncTargetChannels: { UC1: 3 } });
    const done = vi.fn();
    resetTargetScope("channel");
    resetTargetScope("channel", done);
    expect(done).toHaveBeenCalledWith(false);
    expect(get(["syncTargetChannels"]).syncTargetChannels).toEqual({ UC1: 3 });
  });

  it("refuses a missing scope instead of clearing the global target", () => {
    STORE.set({ syncTargetGlobal: 12 });
    const done = vi.fn();
    resetTargetScope(null);
    resetTargetScope(null, done);
    expect(done).toHaveBeenCalledWith(false);
    expect(get(["syncTargetGlobal"]).syncTargetGlobal).toBe(12);
  });

  it("global: reports a failed clear without re-resolving the target", () => {
    STORE.set({ syncTargetGlobal: 12 });
    const remove = vi.spyOn(STORE, "remove").mockImplementation((_keys, cb) => cb?.(false));
    const done = vi.fn();
    try {
      resetTargetScope("global");
      resetTargetScope("global", done);
    } finally {
      remove.mockRestore();
    }
    expect(done).toHaveBeenCalledWith(false);
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

  it("re-runs live control right away with the clamped target", () => {
    const seen: number[] = [];
    vi.mocked(controlLive).mockImplementationOnce(() => {
      seen.push(S.liveSyncTarget);
    });
    setTarget(99);
    expect(seen).toEqual([30]);
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

  it("re-runs live control with the resolved target and reports success", () => {
    STORE.set({ syncTargets: { localhost: 8 } });
    const seen: number[] = [];
    vi.mocked(controlLive).mockImplementationOnce(() => {
      seen.push(S.liveSyncTarget);
    });
    const done = vi.fn();
    applyResolvedTargetFromStore(done);
    expect(seen).toEqual([8]);
    expect(done).toHaveBeenCalledWith(true);
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
    const done = vi.fn();
    resetTargetScope("site", done);
    expect(done).toHaveBeenCalledWith(false);
  });

  it("persistChannelTarget bails", () => {
    h.keys = ["UC1"];
    const done = vi.fn();
    persistChannelTarget(7, done);
    expect(done).toHaveBeenCalledWith(false);
    expect(get(["syncTargetChannels"]).syncTargetChannels).toEqual({});
  });

  it("persistGlobalTarget bails", () => {
    const done = vi.fn();
    persistGlobalTarget(12, done);
    expect(done).toHaveBeenCalledWith(false);
    expect(get(["syncTargetGlobal"]).syncTargetGlobal).toBeUndefined();
  });

  it("applyResolvedTargetFromStore leaves the live target alone", () => {
    STORE.set({ syncTargets: { localhost: 8 } });
    const done = vi.fn();
    applyResolvedTargetFromStore();
    applyResolvedTargetFromStore(done);
    expect(done).toHaveBeenCalledWith(false);
    expect(S.liveSyncTarget).toBe(5);
    expect(S.targetScope).toBeNull();
  });
});
