import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (
  msg: Record<string, unknown>,
  sender: Record<string, unknown>,
  sendResponse: (response: unknown) => void,
) => unknown;

const h = vi.hoisted(() => ({
  listener: null as Listener | null,
  values: { domains: { existing: 1 } } as Record<string, Record<string, unknown>>,
  pendingGets: [] as Array<{
    key: string;
    callback: (items: Record<string, unknown>) => void;
  }>,
  writeOk: true,
  getError: null as Error | null,
}));

vi.mock("../src/shared/store.js", () => ({
  STORE: {
    get(keys: string[], callback: (items: Record<string, unknown>) => void) {
      if (h.getError) throw h.getError;
      const key = keys[0];
      h.pendingGets.push({ key, callback });
    },
    set(obj: Record<string, Record<string, number>>, callback?: (ok?: boolean) => void) {
      if (h.writeOk) Object.assign(h.values, obj);
      callback?.(h.writeOk);
    },
    remove(key: string, callback?: (ok?: boolean) => void) {
      if (h.writeOk) delete h.values[key];
      callback?.(h.writeOk);
    },
  },
  whenReady(callback: () => void) {
    callback();
  },
}));

vi.mock("../src/shared/update.js", () => ({
  UPDATE_AVAILABLE_KEY: "updateAvailable",
  UPDATE_LATEST_KEY: "updateLatest",
  UPDATE_ALARM: "updateCheck",
  UPDATE_PERIOD_MIN: 360,
  hasUpdateApi: () => true,
  cmpVersion: () => 0,
  currentVersion: () => "0.0.0",
  fetchAmoLatest: () => Promise.resolve(null),
}));

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

// Answers the oldest queued read with what storage holds for the key it asked for.
function answerGet() {
  const { key, callback } = h.pendingGets.shift()!;
  callback(key in h.values ? { [key]: { ...h.values[key] } } : {});
}

describe("background stored-map mutations", () => {
  beforeEach(async () => {
    vi.resetModules();
    h.listener = null;
    h.values = { domains: { existing: 1 } };
    h.pendingGets = [];
    h.writeOk = true;
    h.getError = null;
    (globalThis as unknown as { browser?: unknown }).browser = undefined;
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        lastError: null,
        onMessage: { addListener: (listener: Listener) => (h.listener = listener) },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onUpdateAvailable: { addListener() {} },
        requestUpdateCheck() {},
      },
      action: { setBadgeText() {}, setIcon() {} },
      tabs: {
        onUpdated: { addListener() {} },
        onRemoved: { addListener() {} },
      },
      storage: { local: { set() {} } },
    };
    await import("../src/background/index.js");
  });

  afterEach(() => vi.clearAllMocks());

  it("serializes concurrent writes so both tab entries survive", async () => {
    const responses: unknown[] = [];
    expect(
      h.listener?.(
        { action: "mutateStoredMap", map: "domains", set: { "one.example": 1.25 } },
        {},
        (response) => responses.push(response),
      ),
    ).toBe(true);
    expect(
      h.listener?.(
        { action: "mutateStoredMap", map: "domains", set: { "two.example": 1.5 } },
        {},
        (response) => responses.push(response),
      ),
    ).toBe(true);

    await flush();
    expect(h.pendingGets).toHaveLength(1);
    h.pendingGets.shift()!.callback({ domains: { ...h.values.domains } });
    await flush();
    expect(h.pendingGets).toHaveLength(1);
    h.pendingGets.shift()!.callback({ domains: { ...h.values.domains } });
    await flush();

    expect(h.values.domains).toEqual({
      existing: 1,
      "one.example": 1.25,
      "two.example": 1.5,
    });
    expect(responses).toEqual([{ success: true }, { success: true }]);
  });

  it("serializes scoped viewer settings without accepting invalid values", async () => {
    const responses: unknown[] = [];
    expect(
      h.listener?.(
        { action: "mutateStoredMap", map: "viewerAutoSites", set: { "one.example": "normal" } },
        {},
        (response) => responses.push(response),
      ),
    ).toBe(true);
    h.listener?.(
      { action: "mutateStoredMap", map: "viewerAutoSites", set: { "two.example": "broken" } },
      {},
      (response) => responses.push(response),
    );

    await flush();
    expect(h.pendingGets).toHaveLength(1);
    h.pendingGets.shift()!.callback({ viewerAutoSites: {} });
    await flush();

    expect(h.values.viewerAutoSites).toEqual({ "one.example": "normal" });
    expect(responses).toEqual([{ success: false }, { success: true }]);
  });

  it("rejects saved speeds outside the playback clamp", () => {
    const responses: unknown[] = [];
    h.listener?.(
      { action: "mutateStoredMap", map: "domains", set: { "slow.example": 0.07 } },
      {},
      (response) => responses.push(response),
    );

    expect(responses).toEqual([{ success: false }]);
    expect(h.pendingGets).toHaveLength(0);
  });

  it("rounds a dragged position to four decimals before storing it", async () => {
    const position = { fx: 0.123456789, fy: 0.333333333 };
    h.listener?.(
      { action: "mutateStoredMap", map: "badgePos", set: { "one.example": position } },
      {},
      () => {},
    );

    await flush();
    h.pendingGets.shift()!.callback({});
    await flush();

    expect(h.values.badgePos).toEqual({ "one.example": { fx: 0.1235, fy: 0.3333 } });
  });

  it("serializes clearing a whole map with adjacent writes", async () => {
    h.values.domains = { old: 1 };
    const responses: unknown[] = [];
    h.listener?.({ action: "mutateStoredMap", map: "domains", clear: true }, {}, (response) =>
      responses.push(response),
    );
    h.listener?.(
      { action: "mutateStoredMap", map: "domains", set: { fresh: 1.5 } },
      {},
      (response) => responses.push(response),
    );

    await flush();
    expect(h.values.domains).toBeUndefined();
    await flush();
    expect(h.pendingGets).toHaveLength(1);
    h.pendingGets.shift()!.callback({});
    await flush();

    expect(h.values.domains).toEqual({ fresh: 1.5 });
    expect(responses).toEqual([{ success: true }, { success: true }]);
  });

  it.each([
    ["an unknown map", { map: "evil", set: { "a.example": { fx: 0.5, fy: 0.5 } } }],
    ["only unsafe keys to remove", { map: "domains", remove: [5, "__proto__", ""] }],
    ["nothing to write", { map: "domains", set: null }],
  ])("rejects a mutation with %s without touching storage", async (_case, mutation) => {
    const responses: unknown[] = [];
    h.listener?.({ action: "mutateStoredMap", ...mutation }, {}, (response) =>
      responses.push(response),
    );

    expect(responses).toEqual([{ success: false }]);
    await flush();
    expect(h.pendingGets).toHaveLength(0);
  });

  it("removes the listed entries, skipping keys that are not safe strings", async () => {
    h.values.domains = { "gone.example": 1.5, "5": 2, "kept.example": 1.25 };
    const responses: unknown[] = [];
    h.listener?.(
      { action: "mutateStoredMap", map: "domains", remove: ["gone.example", 5] },
      {},
      (response) => responses.push(response),
    );

    await flush();
    answerGet();

    await vi.waitFor(() => expect(responses).toEqual([{ success: true }]));
    expect(h.values.domains).toEqual({ "5": 2, "kept.example": 1.25 });
  });

  it("drops the whole map once its last entry is removed", async () => {
    h.values.domains = { "only.example": 1.5 };
    const responses: unknown[] = [];
    h.listener?.(
      { action: "mutateStoredMap", map: "domains", remove: ["only.example"] },
      {},
      (response) => responses.push(response),
    );

    await flush();
    answerGet();

    await vi.waitFor(() => expect(responses).toEqual([{ success: true }]));
    expect(h.values).not.toHaveProperty("domains");
  });

  it("reports a write or a clear that storage refused", async () => {
    h.writeOk = false;
    const responses: unknown[] = [];
    h.listener?.(
      { action: "mutateStoredMap", map: "domains", set: { "one.example": 1.25 } },
      {},
      (response) => responses.push(response),
    );
    await flush();
    answerGet();
    await vi.waitFor(() => expect(responses).toEqual([{ success: false }]));

    h.listener?.({ action: "mutateStoredMap", map: "domains", clear: true }, {}, (response) =>
      responses.push(response),
    );

    await vi.waitFor(() => expect(responses).toEqual([{ success: false }, { success: false }]));
    expect(h.values.domains).toEqual({ existing: 1 });
  });

  it("answers a write whose storage read throws, then keeps serving the map", async () => {
    h.getError = new Error("Extension context invalidated.");
    const responses: unknown[] = [];
    h.listener?.(
      { action: "mutateStoredMap", map: "domains", set: { "one.example": 1.25 } },
      {},
      (response) => responses.push(response),
    );
    await vi.waitFor(() => expect(responses).toEqual([{ success: false }]));

    h.getError = null;
    h.listener?.(
      { action: "mutateStoredMap", map: "domains", set: { "two.example": 1.5 } },
      {},
      (response) => responses.push(response),
    );
    await flush();
    answerGet();

    await vi.waitFor(() => expect(responses).toEqual([{ success: false }, { success: true }]));
    expect(h.values.domains).toEqual({ existing: 1, "two.example": 1.5 });
  });
});
