import { describe, expect, it, vi, afterEach } from "vitest";

async function loadWithMigrationResult(ok: boolean) {
  vi.resetModules();
  const installed: Array<(details?: { reason?: string }) => void> = [];
  const local: Record<string, unknown> = {
    domains: { "example.com": 1.5 },
  };
  const storeSet = vi.fn((_obj: Record<string, unknown>, cb?: (ok?: boolean) => void) => {
    cb?.(ok);
  });
  vi.doMock("../src/shared/store.js", () => ({
    STORE: {
      get(keys: string[], cb: (items: Record<string, unknown>) => void) {
        if (keys.includes("globalSpeed")) {
          cb({ globalSpeed: 1, syncTargetGlobal: 5 });
        } else {
          cb({});
        }
      },
      set: storeSet,
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
    hasUpdateApi: () => true,
    cmpVersion: () => 0,
    currentVersion: () => "0.0.0",
    fetchAmoLatest: () => Promise.resolve(null),
  }));
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      onInstalled: {
        addListener: (fn: (details?: { reason?: string }) => void) => installed.push(fn),
      },
    },
    action: {
      setBadgeText() {},
      setIcon() {},
    },
    storage: {
      sync: {},
      local: {
        get(keys: string[], cb: (items: Record<string, unknown>) => void) {
          const out: Record<string, unknown> = {};
          for (const k of keys) if (k in local) out[k] = local[k];
          cb(out);
        },
        set(obj: Record<string, unknown>) {
          Object.assign(local, obj);
        },
      },
    },
  };

  await import("../src/background/index.js");
  installed.forEach((fn) => fn({ reason: "install" }));
  return { local, storeSet };
}

// Fires onInstalled("install") against a routed store holding `routed` and the
// pre-router device-local area holding `local`; returns the routed writes.
async function runInstall(routed: Record<string, unknown>, local: Record<string, unknown> = {}) {
  vi.resetModules();
  const installed: Array<(details?: { reason?: string }) => void> = [];
  const writes: Array<Record<string, unknown>> = [];
  // A storage-area read: only the requested keys that hold a value.
  const pick = (items: Record<string, unknown>, keys: string[]) =>
    Object.fromEntries(keys.filter((key) => key in items).map((key) => [key, items[key]]));
  vi.doMock("../src/shared/store.js", () => ({
    STORE: {
      get(keys: string[], cb: (items: Record<string, unknown>) => void) {
        cb(pick(routed, keys));
      },
      set(obj: Record<string, unknown>, cb?: (ok?: boolean) => void) {
        writes.push(obj);
        cb?.(true);
      },
    },
    whenReady(cb: () => void) {
      cb();
    },
  }));
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      onInstalled: {
        addListener: (fn: (details?: { reason?: string }) => void) => installed.push(fn),
      },
    },
    action: { setBadgeText() {}, setIcon() {} },
    storage: {
      sync: {},
      local: {
        get(keys: string[], cb: (items: Record<string, unknown>) => void) {
          cb(pick(local, keys));
        },
        set(obj: Record<string, unknown>) {
          Object.assign(local, obj);
        },
      },
    },
  };

  await import("../src/background/index.js");
  installed.forEach((fn) => fn({ reason: "install" }));
  return { writes, local };
}

afterEach(() => {
  vi.doUnmock("../src/shared/store.js");
  vi.doUnmock("../src/shared/update.js");
});

describe("legacy local settings migration", () => {
  it("does not mark the migration done when the routed copy fails", async () => {
    const { local, storeSet } = await loadWithMigrationResult(false);

    expect(storeSet).toHaveBeenCalledWith(
      { domains: { "example.com": 1.5 } },
      expect.any(Function),
    );
    expect(local.legacyLocalSyncMigrationDone).toBeUndefined();
  });

  it("marks the migration done after a successful routed copy", async () => {
    const { local } = await loadWithMigrationResult(true);

    expect(local.legacyLocalSyncMigrationDone).toBe(true);
  });

  // The shipped defaults are already in place, so seeding adds no routed writes.
  const defaults = { globalSpeed: 1, syncTargetGlobal: 5 };

  it("copies every legacy setting the routed store lacks", async () => {
    const legacy = {
      domains: { "example.com": 1.5 },
      liveSync: true,
      liveSyncTarget: 7,
      liveSyncMax: 2,
    };
    const { writes, local } = await runInstall(defaults, { ...legacy });

    expect(writes).toEqual([legacy]);
    expect(local.legacyLocalSyncMigrationDone).toBe(true);
  });

  it("never overwrites a value the routed store already has", async () => {
    const routed = { ...defaults, domains: { "b.example": 2 } };
    const { writes } = await runInstall(routed, { domains: { "a.example": 1.5 }, liveSync: true });

    expect(writes).toEqual([{ liveSync: true }]);
  });

  it("does not run again once marked done", async () => {
    const { writes } = await runInstall(defaults, {
      legacyLocalSyncMigrationDone: true,
      domains: { "a.example": 1.5 },
    });

    expect(writes).toEqual([]);
  });

  it("marks the migration done even when there is nothing to copy", async () => {
    const { writes, local } = await runInstall(defaults);

    expect(writes).toEqual([]);
    expect(local.legacyLocalSyncMigrationDone).toBe(true);
  });
});

describe("background default seeding", () => {
  it("does not seed shipped defaults on extension update", async () => {
    vi.resetModules();
    const installed: Array<(details?: { reason?: string }) => void> = [];
    const storeSet = vi.fn();
    vi.doMock("../src/shared/store.js", () => ({
      STORE: {
        get(_keys: string[], cb: (items: Record<string, unknown>) => void) {
          cb({});
        },
        set: storeSet,
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
      hasUpdateApi: () => true,
      cmpVersion: () => 0,
      currentVersion: () => "0.0.0",
      fetchAmoLatest: () => Promise.resolve(null),
    }));
    (globalThis as unknown as { browser?: unknown }).browser = undefined;
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        lastError: null,
        onMessage: { addListener() {} },
        onInstalled: {
          addListener(fn: (details?: { reason?: string }) => void) {
            installed.push(fn);
          },
        },
      },
      action: {
        setBadgeText() {},
        setIcon() {},
      },
      storage: {
        sync: {},
        local: {
          get(_keys: string[], cb: (items: Record<string, unknown>) => void) {
            cb({});
          },
          set() {},
        },
      },
    };

    await import("../src/background/index.js");
    installed.forEach((fn) => fn({ reason: "update" }));

    expect(storeSet).not.toHaveBeenCalled();
  });

  it("seeds 100% speed and a 5s live-sync delay on a fresh install", async () => {
    const { writes } = await runInstall({});

    expect(writes).toEqual([{ globalSpeed: 1, syncTargetGlobal: 5 }]);
  });

  it("keeps the speed and delay a user already has", async () => {
    const { writes } = await runInstall({ globalSpeed: 1.5, syncTargetGlobal: 8 });

    expect(writes).toEqual([]);
  });

  it("lets a legacy live-sync target stand in for the delay", async () => {
    const { writes } = await runInstall({ globalSpeed: 1.5, liveSyncTarget: 7 });

    expect(writes).toEqual([]);
  });
});
