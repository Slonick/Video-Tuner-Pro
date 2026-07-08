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
});
