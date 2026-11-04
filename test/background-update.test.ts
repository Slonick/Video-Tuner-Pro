import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type UpdateListener = (details: { version: string }) => void;
type UpdateCheck = (status: string, details?: { version: string }) => void;
type InstalledListener = (details: { reason: string }) => void;
type AlarmListener = (alarm: { name: string }) => void;

// Loads the background with the given extra runtime APIs: Chrome has
// requestUpdateCheck, Firefox doesn't (both fire onUpdateAvailable). `apis` adds or
// replaces whole extension namespaces.
async function loadBackground(
  runtime: Record<string, unknown>,
  apis: Record<string, unknown> = {},
) {
  vi.resetModules();
  const updateListeners: UpdateListener[] = [];
  const localSets: Array<Record<string, unknown>> = [];
  vi.doMock("../src/shared/store.js", () => ({
    STORE: { get() {}, set() {} },
    whenReady() {},
  }));
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      onUpdateAvailable: { addListener: (fn: UpdateListener) => updateListeners.push(fn) },
      ...runtime,
    },
    action: { setBadgeText() {}, setIcon() {} },
    storage: { local: { set: (items: Record<string, unknown>) => localSets.push(items) } },
    ...apis,
  };
  await import("../src/background/index.js");
  return { updateListeners, localSets };
}

// Adds the alarms API and the install/startup events the update scheduler hangs off.
async function loadScheduler(runtime: Record<string, unknown>) {
  const installed: InstalledListener[] = [];
  const started: Array<() => void> = [];
  const alarmListeners: AlarmListener[] = [];
  const alarms: unknown[][] = [];
  const loaded = await loadBackground(
    {
      onInstalled: { addListener: (fn: InstalledListener) => installed.push(fn) },
      onStartup: { addListener: (fn: () => void) => started.push(fn) },
      ...runtime,
    },
    {
      alarms: {
        onAlarm: { addListener: (fn: AlarmListener) => alarmListeners.push(fn) },
        create: (...args: unknown[]) => alarms.push(args),
      },
    },
  );
  return { ...loaded, installed, started, alarmListeners, alarms };
}

afterEach(() => {
  vi.doUnmock("../src/shared/store.js");
});

describe("background update listener", () => {
  it("records an update Chrome has staged", async () => {
    const { updateListeners, localSets } = await loadBackground({ requestUpdateCheck() {} });

    expect(updateListeners).toHaveLength(1);
    updateListeners[0]({ version: "9.9.9" });
    expect(localSets).toEqual([{ updateAvailable: true, updateLatestVersion: "9.9.9" }]);
  });

  it("skips the listener on Firefox, where it would defer updates to a restart", async () => {
    const { updateListeners } = await loadBackground({});

    expect(updateListeners).toHaveLength(0);
  });
});

describe("background update checks", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks Chrome at startup and schedules a check every six hours", async () => {
    const checks: UpdateCheck[] = [];
    const { started, alarms, localSets } = await loadScheduler({
      requestUpdateCheck: (cb: UpdateCheck) => checks.push(cb),
    });

    started.forEach((fn) => fn());
    expect(alarms).toEqual([["vtp-update-check", { periodInMinutes: 360 }]]);
    expect(checks).toHaveLength(1);
    checks[0]("update_available", { version: "9.9.9" });

    expect(localSets).toEqual([{ updateAvailable: true, updateLatestVersion: "9.9.9" }]);
  });

  it("records that Chrome has no update staged, without a version", async () => {
    const checks: UpdateCheck[] = [];
    const { started, localSets } = await loadScheduler({
      requestUpdateCheck: (cb: UpdateCheck) => checks.push(cb),
    });

    started.forEach((fn) => fn());
    checks[0]("no_update");

    expect(localSets).toStrictEqual([{ updateAvailable: false }]);
  });

  it("schedules the same check right after an install", async () => {
    const checks: UpdateCheck[] = [];
    const { installed, alarms } = await loadScheduler({
      requestUpdateCheck: (cb: UpdateCheck) => checks.push(cb),
    });

    installed.forEach((fn) => fn({ reason: "install" }));

    expect(alarms).toEqual([["vtp-update-check", { periodInMinutes: 360 }]]);
    expect(checks).toHaveLength(1);
  });

  it("re-checks when its own alarm fires, and only then", async () => {
    const checks: UpdateCheck[] = [];
    const { alarmListeners } = await loadScheduler({
      requestUpdateCheck: (cb: UpdateCheck) => checks.push(cb),
    });

    alarmListeners.forEach((fn) => fn({ name: "some-other-alarm" }));
    expect(checks).toHaveLength(0);
    alarmListeners.forEach((fn) => fn({ name: "vtp-update-check" }));

    expect(checks).toHaveLength(1);
  });

  it.each([
    ["3.4.0", true],
    ["3.3.0", false],
    ["3.2.9", false],
  ])("records AMO's %s against the running 3.3.0 on Firefox", async (latest, available) => {
    const amo = { current_version: { version: latest } };
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: true, json: () => Promise.resolve(amo) }));
    const { started, localSets } = await loadScheduler({
      getManifest: () => ({ version: "3.3.0" }),
    });

    started.forEach((fn) => fn());

    await vi.waitFor(() =>
      expect(localSets).toEqual([{ updateAvailable: available, updateLatestVersion: latest }]),
    );
  });

  it("leaves the last result alone when AMO can't be reached on Firefox", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { started, localSets } = await loadScheduler({
        getManifest: () => ({ version: "3.3.0" }),
      });
      started.forEach((fn) => fn());
      // The failed lookup settles through promise reactions alone, and Node reports an
      // unhandled rejection only once they drain: wait out one macrotask turn.
      await new Promise((resolve) => setImmediate(resolve));

      expect(localSets).toEqual([]);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("keeps checking on its alarm where install and startup events are missing", async () => {
    const checks: UpdateCheck[] = [];
    const alarmListeners: AlarmListener[] = [];
    await loadBackground(
      { requestUpdateCheck: (cb: UpdateCheck) => checks.push(cb) },
      {
        alarms: {
          onAlarm: { addListener: (fn: AlarmListener) => alarmListeners.push(fn) },
          create() {},
        },
        scripting: {},
        tabs: {},
        storage: { local: { set() {} }, sync: {} },
      },
    );

    alarmListeners.forEach((fn) => fn({ name: "vtp-update-check" }));

    expect(checks).toHaveLength(1);
  });
});
