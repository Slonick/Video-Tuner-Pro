import { describe, it, expect, beforeEach, vi } from "vitest";

// A chrome mock with SEPARATE sync/local backing stores (unlike the shared mock,
// which shares one), so we can observe routing and migration between the two.
function makeChrome() {
  const sync: Record<string, unknown> = {};
  const local: Record<string, unknown> = {};
  const listeners: Array<(c: Record<string, { newValue?: unknown }>, area: string) => void> = [];
  const held: Array<() => void> = [];
  const runtime: { lastError?: { message: string } } = {};
  const failNext: Record<
    string,
    Partial<Record<"get" | "set" | "remove", string | null | (string | null)[]>>
  > = {
    sync: {},
    local: {},
  };
  const holdNext: Record<string, Partial<Record<"get" | "set", boolean>>> = {
    sync: {},
    local: {},
  };
  const fail = (name: string, op: "get" | "set" | "remove", cb?: () => void): boolean => {
    const queued = failNext[name][op];
    const message = Array.isArray(queued) ? queued.shift() : queued;
    if (Array.isArray(queued) && !queued.length) delete failNext[name][op];
    if (!message) return false;
    delete failNext[name][op];
    runtime.lastError = { message };
    cb?.();
    delete runtime.lastError;
    return true;
  };
  const area = (backing: Record<string, unknown>, name: string) => ({
    get(keys: string | string[] | null, cb: (items: Record<string, unknown>) => void) {
      // A failed read hands the callback no items, as the browser does.
      if (fail(name, "get", () => cb(undefined as unknown as Record<string, unknown>))) return;
      const read = () => {
        let out: Record<string, unknown> = {};
        if (keys == null) out = { ...backing };
        else
          for (const k of typeof keys === "string" ? [keys] : keys)
            if (k in backing) out[k] = backing[k];
        cb(out);
      };
      if (holdNext[name].get) {
        delete holdNext[name].get;
        held.push(read);
        return;
      }
      read();
    },
    set(obj: Record<string, unknown>, cb?: () => void) {
      if (fail(name, "set", cb)) return;
      const apply = () => {
        const changes: Record<string, { newValue?: unknown }> = {};
        for (const k of Object.keys(obj)) {
          backing[k] = obj[k];
          changes[k] = { newValue: obj[k] };
        }
        cb?.();
        listeners.forEach((l) => l(changes, name));
      };
      if (holdNext[name].set) {
        delete holdNext[name].set;
        held.push(apply);
        return;
      }
      apply();
    },
    remove(keys: string | string[], cb?: () => void) {
      if (fail(name, "remove", cb)) return;
      const changes: Record<string, { newValue?: unknown }> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        delete backing[k];
        changes[k] = {};
      }
      cb?.();
      listeners.forEach((l) => l(changes, name));
    },
  });
  return {
    backing: { sync, local },
    chrome: {
      storage: {
        sync: area(sync, "sync"),
        local: area(local, "local"),
        onChanged: {
          addListener: (l: (c: Record<string, { newValue?: unknown }>, a: string) => void) =>
            listeners.push(l),
          removeListener: (l: (c: Record<string, { newValue?: unknown }>, a: string) => void) => {
            const i = listeners.indexOf(l);
            if (i >= 0) listeners.splice(i, 1);
          },
        },
      },
      runtime,
    } as unknown as typeof chrome,
    failNext,
    holdNext,
    resumeHeld() {
      held.shift()?.();
    },
  };
}

async function freshStore(c: typeof chrome) {
  (globalThis as unknown as { chrome: typeof chrome; browser?: unknown }).chrome = c;
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  vi.resetModules();
  return import("../src/shared/store.js");
}

describe("routed STORE", () => {
  let env: ReturnType<typeof makeChrome>;
  beforeEach(() => {
    env = makeChrome();
  });

  it("routes everything to sync by default", async () => {
    const { STORE } = await freshStore(env.chrome);
    STORE.set({ globalSpeed: 1.5, audioComp: true });
    expect(env.backing.sync).toEqual({ globalSpeed: 1.5, audioComp: true });
    expect(env.backing.local).toEqual({});
  });

  it("reads back through the router (merging both areas)", async () => {
    const { STORE } = await freshStore(env.chrome);
    STORE.set({ globalSpeed: 2 });
    let got: Record<string, unknown> = {};
    STORE.get(["globalSpeed", "audioComp"], (r) => {
      got = r;
    });
    expect(got).toEqual({ globalSpeed: 2 });
  });

  it("whenReady fires after the config has loaded", async () => {
    const { whenReady } = await freshStore(env.chrome);
    let fired = false;
    whenReady(() => {
      fired = true;
    });
    expect(fired).toBe(true); // mock get is synchronous → ready by now
  });

  it("becomes ready on the defaults when the startup config read fails", async () => {
    env.backing.local.syncMaster = false;
    env.failNext.local.get = "local read failed";
    const { whenReady, getSyncMaster } = await freshStore(env.chrome);
    let fired = false;
    whenReady(() => {
      fired = true;
    });
    expect(fired).toBe(true);
    expect(getSyncMaster()).toBe(true); // the unread switch keeps its default
  });

  it("routes on the all-synced defaults and queues whenReady until the config loads", async () => {
    env.backing.local.syncMaster = false;
    env.holdNext.local.get = true;
    const { STORE, getSyncConfig, getSyncMaster, whenReady } = await freshStore(env.chrome);
    const ran: string[] = [];
    whenReady(() => ran.push("first"));
    whenReady(() => ran.push("second"));

    expect(ran).toEqual([]);
    expect(getSyncConfig()).toEqual({
      speeds: true,
      delays: true,
      audio: true,
      shortcuts: true,
      general: true,
    });
    STORE.set({ globalSpeed: 2 });
    expect(env.backing.sync.globalSpeed).toBe(2);

    env.resumeHeld();

    expect(ran).toEqual(["first", "second"]);
    expect(getSyncMaster()).toBe(false);
    whenReady(() => ran.push("late"));
    expect(ran).toEqual(["first", "second", "late"]);
  });

  it("becomes ready on the defaults when the startup read yields no items", async () => {
    // No lastError, yet no items either: startup must not trip over the missing result.
    const local = env.chrome.storage.local as unknown as Record<string, unknown>;
    local.get = (_keys: unknown, cb: (items?: unknown) => void) => cb();
    const { whenReady, getSyncMaster } = await freshStore(env.chrome);
    let fired = false;
    whenReady(() => {
      fired = true;
    });
    expect(fired).toBe(true);
    expect(getSyncMaster()).toBe(true);
  });

  it("ignores routing metadata that arrives in the sync area", async () => {
    const { getSyncConfig, getSyncMaster } = await freshStore(env.chrome);

    env.chrome.storage.sync.set({ syncCategories: { speeds: false }, syncMaster: false });

    expect(getSyncConfig().speeds).toBe(true);
    expect(getSyncMaster()).toBe(true);
  });

  it("ignores a non-boolean master switch written by another context", async () => {
    const { getSyncMaster } = await freshStore(env.chrome);

    env.chrome.storage.local.set({ syncMaster: "off" });

    expect(getSyncMaster()).toBe(true);
  });

  it("subscribe fires on a watched key and stops after unsubscribe", async () => {
    const { STORE, subscribe } = await freshStore(env.chrome);
    let hits = 0;
    const off = subscribe(["globalSpeed"], () => hits++);
    STORE.set({ globalSpeed: 2 }); // watched key → fires
    STORE.set({ audioComp: true }); // unwatched key → ignored
    expect(hits).toBe(1);
    off();
    STORE.set({ globalSpeed: 3 }); // unsubscribed → no more hits
    expect(hits).toBe(1);
  });

  it("get(null) merges both areas (the export path)", async () => {
    env.backing.sync.audioComp = true;
    env.backing.local.syncCategories = { speeds: false };
    env.backing.local.globalSpeed = 1.5; // speeds opted out → lives in local
    const { STORE } = await freshStore(env.chrome);
    let all: Record<string, unknown> = {};
    STORE.get(null, (r) => {
      all = r;
    });
    expect(all.audioComp).toBe(true);
    expect(all.globalSpeed).toBe(1.5);
  });

  it("reports a failed routed write to the callback", async () => {
    const { STORE, setCategorySync } = await freshStore(env.chrome);
    setCategorySync("speeds", false); // speeds → local, audio → sync
    env.failNext.sync.set = "quota exceeded";
    let ok: boolean | undefined;

    STORE.set({ globalSpeed: 2, audioComp: true }, (result) => {
      ok = result;
    });

    expect(ok).toBe(false);
    expect(env.backing.local.globalSpeed).toBe(2);
    expect(env.backing.sync.audioComp).toBeUndefined();
  });

  it("reports a failed routed remove to the callback", async () => {
    env.backing.local.syncCategories = { speeds: false };
    env.backing.local.globalSpeed = 2;
    env.backing.sync.audioComp = true;
    const { STORE } = await freshStore(env.chrome);
    env.failNext.sync.remove = "quota exceeded";
    let ok: boolean | undefined;

    STORE.remove(["globalSpeed", "audioComp"], (result) => {
      ok = result;
    });

    expect(ok).toBe(false);
    expect(env.backing.local.globalSpeed).toBeUndefined();
    expect(env.backing.sync.audioComp).toBe(true);
  });

  it("does not remove an opted-out key from sync", async () => {
    env.backing.local.syncCategories = { speeds: false };
    env.backing.local.globalSpeed = 2;
    env.backing.sync.globalSpeed = 1.5;
    const { STORE } = await freshStore(env.chrome);

    STORE.remove("globalSpeed");

    let got: Record<string, unknown> = {};
    STORE.get(["globalSpeed"], (r) => {
      got = r;
    });
    expect(got.globalSpeed).toBeUndefined();
    expect(env.backing.local.globalSpeed).toBeUndefined();
    expect(env.backing.sync.globalSpeed).toBe(1.5);
  });

  it("can remove imported keys from both routed and stale storage areas", async () => {
    env.backing.local.syncCategories = { speeds: false };
    env.backing.local.globalSpeed = 2;
    env.backing.sync.globalSpeed = 1.5;
    const { STORE } = await freshStore(env.chrome);

    STORE.removeEverywhere("globalSpeed");

    expect(env.backing.local.globalSpeed).toBeUndefined();
    expect(env.backing.sync.globalSpeed).toBeUndefined();
  });

  it("drops a failed routed read from the merged result", async () => {
    env.backing.sync.audioComp = true;
    env.backing.local.syncCategories = { speeds: false };
    env.backing.local.globalSpeed = 2;
    const { STORE } = await freshStore(env.chrome);
    env.failNext.sync.get = "sync read failed";
    let got: Record<string, unknown> = {};

    STORE.get(["globalSpeed", "audioComp"], (r) => {
      got = r;
    });

    expect(got).toEqual({ globalSpeed: 2 });
  });

  it("always stores sync routing metadata locally", async () => {
    const { STORE } = await freshStore(env.chrome);

    STORE.set({ syncCategories: { speeds: false }, syncMaster: false });

    expect(env.backing.local.syncCategories).toEqual({ speeds: false });
    expect(env.backing.local.syncMaster).toBe(false);
    expect(env.backing.sync.syncCategories).toBeUndefined();
    expect(env.backing.sync.syncMaster).toBeUndefined();

    STORE.remove(["syncCategories", "syncMaster"]);

    expect(env.backing.local.syncCategories).toBeUndefined();
    expect(env.backing.local.syncMaster).toBeUndefined();
  });

  it("reads a single key and answers an empty key list with no items", async () => {
    env.backing.sync.globalSpeed = 2;
    const { STORE } = await freshStore(env.chrome);
    const single = vi.fn();
    const none = vi.fn();

    STORE.get("globalSpeed", single);
    STORE.get([], none);

    expect(single).toHaveBeenCalledWith({ globalSpeed: 2 });
    expect(none).toHaveBeenCalledOnce();
    expect(none).toHaveBeenCalledWith({});
  });

  it("answers a read spanning both areas once, with the merged items", async () => {
    env.backing.local.syncCategories = { speeds: false };
    env.backing.local.globalSpeed = 2;
    env.backing.sync.audioComp = true;
    const { STORE } = await freshStore(env.chrome);
    const got = vi.fn();

    STORE.get(["globalSpeed", "audioComp"], got);

    expect(got).toHaveBeenCalledOnce();
    expect(got).toHaveBeenCalledWith({ globalSpeed: 2, audioComp: true });
  });

  it("get(null) waits for the sync area even when local answers first", async () => {
    env.backing.sync.audioComp = true;
    env.backing.local.syncCategories = { speeds: false };
    env.backing.local.globalSpeed = 2;
    const { STORE } = await freshStore(env.chrome);
    env.holdNext.sync.get = true;
    const got = vi.fn();

    STORE.get(null, got);
    expect(got).not.toHaveBeenCalled();
    env.resumeHeld();

    expect(got).toHaveBeenCalledOnce();
    expect(got).toHaveBeenCalledWith({
      audioComp: true,
      globalSpeed: 2,
      syncCategories: { speeds: false },
    });
  });

  it("get(null) takes each key only from the area it routes to", async () => {
    env.backing.local.syncCategories = { speeds: false };
    env.backing.sync.globalSpeed = 1.5; // another device's speed; this device keeps speeds local
    env.backing.sync.syncMaster = false; // routing metadata only ever counts from local
    const { STORE } = await freshStore(env.chrome);
    let all: Record<string, unknown> = {};

    STORE.get(null, (r) => {
      all = r;
    });

    // Strict: a key missing from its routed area is absent, not present-but-undefined.
    expect(all).toStrictEqual({ syncCategories: { speeds: false } });
  });

  it("reports a write spanning both areas once, after both have finished", async () => {
    env.backing.local.syncCategories = { speeds: false };
    const { STORE } = await freshStore(env.chrome);
    env.holdNext.local.set = true;
    const done = vi.fn();

    STORE.set({ globalSpeed: 2, audioComp: true }, done);
    expect(done).not.toHaveBeenCalled();
    env.resumeHeld();

    expect(done).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledWith(true);
  });

  it("treats an empty write or removal as a success that touches no storage", async () => {
    const { STORE } = await freshStore(env.chrome);
    // Every storage call would now fail, so success proves none was made.
    for (const area of ["sync", "local"]) {
      env.failNext[area].set = "unexpected write";
      env.failNext[area].remove = "unexpected remove";
    }
    const done = vi.fn();

    STORE.set({}, done);
    STORE.remove([], done);
    STORE.removeEverywhere([], done);

    expect(done.mock.calls).toEqual([[true], [true], [true]]);
    expect(() => STORE.set({})).not.toThrow();
  });
});

describe("routed STORE without a sync area", () => {
  it("routes everything to local and migration is a no-op", async () => {
    const env = makeChrome();
    // Drop the sync area entirely (some Firefox configs).
    (env.chrome.storage as { sync?: unknown }).sync = undefined;
    const { STORE, setCategorySync } = await freshStore(env.chrome);
    STORE.set({ globalSpeed: 2 });
    expect(env.backing.local.globalSpeed).toBe(2);
    setCategorySync("speeds", false); // nowhere to migrate to — just records intent
    expect(env.backing.local.globalSpeed).toBe(2);
  });

  it("master switch without a sync area just records the choice", async () => {
    const env = makeChrome();
    (env.chrome.storage as { sync?: unknown }).sync = undefined;
    const { STORE, setMasterSync, getSyncMaster } = await freshStore(env.chrome);
    STORE.set({ globalSpeed: 2 });
    setMasterSync(false);
    expect(getSyncMaster()).toBe(false);
    expect(env.backing.local.syncMaster).toBe(false);
    expect(env.backing.local.globalSpeed).toBe(2); // nowhere to migrate
  });
});

describe("master sync switch", () => {
  it("defaults on; turning it off copies every synced category to local", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 1.75; // speeds
    env.backing.sync.audioComp = true; // audio
    const { getSyncMaster, setMasterSync } = await freshStore(env.chrome);
    expect(getSyncMaster()).toBe(true);

    setMasterSync(false);
    expect(getSyncMaster()).toBe(false);
    expect(env.backing.local.globalSpeed).toBe(1.75);
    expect(env.backing.local.audioComp).toBe(true);
    expect(env.backing.sync.globalSpeed).toBe(1.75);
    expect(env.backing.sync.audioComp).toBe(true);
    expect(env.backing.local.syncMaster).toBe(false);
  });

  it("with the switch off, every write lands in local regardless of category", async () => {
    const env = makeChrome();
    env.backing.local.syncMaster = false;
    const { STORE } = await freshStore(env.chrome);
    STORE.set({ globalSpeed: 2, audioComp: true, keymap: { slower: "KeyA" } });
    expect(env.backing.local).toMatchObject({ globalSpeed: 2, audioComp: true });
    expect(env.backing.sync).toEqual({});
    // Reads come back from local.
    let got: Record<string, unknown> = {};
    STORE.get(["globalSpeed", "audioComp"], (r) => {
      got = r;
    });
    expect(got).toEqual({ globalSpeed: 2, audioComp: true });
  });

  it("does not delete a synced key while the master switch is off", async () => {
    const env = makeChrome();
    env.backing.local.syncMaster = false;
    env.backing.local.globalSpeed = 2;
    env.backing.sync.globalSpeed = 1.5;
    const { STORE, setMasterSync } = await freshStore(env.chrome);

    STORE.remove("globalSpeed");
    setMasterSync(true);

    let got: Record<string, unknown> = {};
    STORE.get(["globalSpeed"], (r) => {
      got = r;
    });
    expect(got.globalSpeed).toBe(1.5);
    expect(env.backing.local.globalSpeed).toBeUndefined();
    expect(env.backing.sync.globalSpeed).toBe(1.5);
  });

  it("turning it back on restores synced categories to sync, leaving opted-out ones local", async () => {
    const env = makeChrome();
    env.backing.local.syncMaster = false;
    env.backing.local.syncCategories = { speeds: false }; // speeds opted out
    env.backing.local.globalSpeed = 1.5; // speeds → stays local
    env.backing.local.audioComp = true; // audio synced-pref, local while master off
    const { setMasterSync } = await freshStore(env.chrome);

    setMasterSync(true);
    expect(env.backing.sync.audioComp).toBe(true); // pulled up
    expect(env.backing.local.audioComp).toBe(true); // stale source copy is left in place
    expect(env.backing.local.globalSpeed).toBe(1.5); // opted-out stays put
    expect(env.backing.sync.globalSpeed).toBeUndefined();
    expect(env.backing.local.syncMaster).toBe(true);
  });

  it("remembers per-category preferences across an off→on round trip", async () => {
    const env = makeChrome();
    env.backing.sync.audioComp = true;
    env.backing.local.syncCategories = { audio: true, speeds: false };
    env.backing.local.globalSpeed = 1.5; // speeds opted out
    const { getSyncConfig, setMasterSync } = await freshStore(env.chrome);

    setMasterSync(false);
    expect(getSyncConfig()).toMatchObject({ audio: true, speeds: false }); // prefs untouched
    setMasterSync(true);
    expect(getSyncConfig()).toMatchObject({ audio: true, speeds: false });
    expect(env.backing.sync.audioComp).toBe(true); // back in sync
    expect(env.backing.local.globalSpeed).toBe(1.5); // still local
  });

  it("while master is off, toggling a category only records intent (no migration)", async () => {
    const env = makeChrome();
    env.backing.local.syncMaster = false;
    env.backing.local.audioComp = true;
    const { setCategorySync, getSyncConfig } = await freshStore(env.chrome);

    setCategorySync("audio", false);
    expect(env.backing.local.audioComp).toBe(true); // unchanged — already local
    expect(env.backing.sync.audioComp).toBeUndefined();
    expect(getSyncConfig().audio).toBe(false); // preference recorded
    expect((env.backing.local.syncCategories as Record<string, boolean>).audio).toBe(false);
  });

  it("setting the switch to its current value is a no-op (still persisted, nothing moved)", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 2;
    env.backing.local.globalSpeed = 1.5; // stale copy left by an earlier off period
    const { setMasterSync } = await freshStore(env.chrome);
    const done = vi.fn();
    setMasterSync(true, done); // already on
    expect(done).toHaveBeenCalledWith(true);
    expect(env.backing.sync.globalSpeed).toBe(2); // unmoved
    expect(env.backing.local.syncMaster).toBe(true); // recorded
  });

  it("reacts to an external master-switch change (live recompute)", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 2;
    const { STORE } = await freshStore(env.chrome);
    // Another context flips the switch off via local storage.
    env.chrome.storage.local.set({ syncMaster: false });
    // The router now reads speeds from local (where the value isn't) instead of sync.
    let got: Record<string, unknown> = {};
    STORE.get(["globalSpeed"], (r) => {
      got = r;
    });
    expect(got.globalSpeed).toBeUndefined();
  });

  it("while master is off, a toggle applies by done and copies no stale synced data", async () => {
    const env = makeChrome();
    env.backing.local.syncMaster = false;
    env.backing.local.audioComp = true; // live value: everything is local while off
    env.backing.sync.audioComp = false; // stale copy from before the switch went off
    const { getSyncConfig, setCategorySync } = await freshStore(env.chrome);
    let seen: unknown;

    setCategorySync("audio", false, (ok) => {
      seen = { ok, audio: getSyncConfig().audio };
    });

    expect(seen).toEqual({ ok: true, audio: false });
    expect(env.backing.local.audioComp).toBe(true);
  });

  it("while master is off, a toggle that fails to save keeps the old preference", async () => {
    const env = makeChrome();
    env.backing.local.syncMaster = false;
    const { getSyncConfig, setCategorySync } = await freshStore(env.chrome);
    env.failNext.local.set = "quota exceeded";
    const done = vi.fn();

    setCategorySync("audio", false, done);

    expect(done).toHaveBeenCalledWith(false);
    expect(getSyncConfig().audio).toBe(true);
  });

  it("routes everything locally by the time done reports the switch off", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 1.75;
    const { getSyncMaster, routedChanges, setMasterSync } = await freshStore(env.chrome);
    let seen: unknown;

    setMasterSync(false, (ok) => {
      seen = { ok, master: getSyncMaster(), synced: routedChanges({ globalSpeed: 1 }, "sync") };
    });

    expect(seen).toEqual({ ok: true, master: false, synced: {} });
  });

  it("flips at once when no category is synced, keeping the switch if saving fails", async () => {
    const env = makeChrome();
    env.backing.local.syncCategories = {
      speeds: false,
      delays: false,
      audio: false,
      shortcuts: false,
      general: false,
    };
    const { getSyncMaster, setMasterSync } = await freshStore(env.chrome);
    env.failNext.local.set = "quota exceeded";
    const failed = vi.fn();

    setMasterSync(false, failed);

    expect(failed).toHaveBeenCalledWith(false);
    expect(getSyncMaster()).toBe(true);

    let seen: unknown;
    setMasterSync(false, (ok) => {
      seen = { ok, master: getSyncMaster() };
    });

    expect(seen).toEqual({ ok: true, master: false });
    expect(env.backing.local.syncMaster).toBe(false);
  });
});

describe("setCategorySync migration", () => {
  it("copies a category's keys from sync to local when opted out", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 1.75;
    env.backing.sync.domains = { a: 1.5 };
    const { STORE, setCategorySync } = await freshStore(env.chrome);
    setCategorySync("speeds", false);
    expect(env.backing.sync.globalSpeed).toBe(1.75);
    expect(env.backing.local.globalSpeed).toBe(1.75);
    expect(env.backing.local.domains).toEqual({ a: 1.5 });
    // The meta itself is recorded in local.
    expect((env.backing.local.syncCategories as Record<string, boolean>).speeds).toBe(false);
    // Subsequent writes for that category now land in local.
    STORE.set({ globalSpeed: 3 });
    expect(env.backing.local.globalSpeed).toBe(3);
    expect(env.backing.sync.globalSpeed).toBe(1.75);
  });

  it("moves keys back to sync when re-enabled", async () => {
    const env = makeChrome();
    env.backing.local.audioComp = true;
    env.backing.local.syncCategories = { audio: false };
    const { setCategorySync } = await freshStore(env.chrome);
    setCategorySync("audio", true);
    expect(env.backing.sync.audioComp).toBe(true);
    expect(env.backing.local.audioComp).toBe(true);
  });

  it("get(null) prefers the currently routed area when stale copies exist", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 1.5;
    env.backing.local.globalSpeed = 2;
    const { STORE, setCategorySync } = await freshStore(env.chrome);

    let all: Record<string, unknown> = {};
    STORE.get(null, (r) => {
      all = r;
    });
    expect(all.globalSpeed).toBe(1.5);

    setCategorySync("speeds", false);
    env.backing.local.globalSpeed = 2.5;
    STORE.get(null, (r) => {
      all = r;
    });
    expect(all.globalSpeed).toBe(2.5);
  });

  it("get(null) omits stale copies from non-routed areas", async () => {
    const env = makeChrome();
    env.backing.local.globalSpeed = 2;
    env.backing.sync.audioComp = true;
    env.backing.local.audioComp = false;
    const { STORE } = await freshStore(env.chrome);

    let all: Record<string, unknown> = {};
    STORE.get(null, (r) => {
      all = r;
    });

    expect(all.globalSpeed).toBeUndefined();
    expect(all.audioComp).toBe(true);
  });

  it("keeps the source data and preference when the target write fails", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 1.75;
    env.failNext.local.set = "quota exceeded";
    const { getSyncConfig, setCategorySync } = await freshStore(env.chrome);

    setCategorySync("speeds", false);

    expect(env.backing.sync.globalSpeed).toBe(1.75);
    expect(env.backing.local.globalSpeed).toBeUndefined();
    expect(env.backing.local.syncCategories).toBeUndefined();
    expect(getSyncConfig().speeds).toBe(true);
  });

  it("keeps routing to the source area until category migration finishes", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 1.75;
    env.holdNext.local.set = true;
    const { STORE, getSyncConfig, setCategorySync } = await freshStore(env.chrome);

    setCategorySync("speeds", false);

    expect(getSyncConfig().speeds).toBe(true);
    let got: Record<string, unknown> = {};
    STORE.get(["globalSpeed"], (r) => {
      got = r;
    });
    expect(got.globalSpeed).toBe(1.75);

    env.resumeHeld();

    expect(getSyncConfig().speeds).toBe(false);
    STORE.get(["globalSpeed"], (r) => {
      got = r;
    });
    expect(got.globalSpeed).toBe(1.75);
  });

  it("keeps the copied data stale when persisting the category preference fails", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 1.75;
    env.failNext.local.set = [null, "quota exceeded"];
    const { STORE, getSyncConfig, setCategorySync } = await freshStore(env.chrome);
    let ok: boolean | undefined;

    setCategorySync("speeds", false, (result) => {
      ok = result;
    });

    expect(ok).toBe(false);
    expect(env.backing.sync.globalSpeed).toBe(1.75);
    expect(env.backing.local.globalSpeed).toBe(1.75);
    expect(env.backing.local.syncCategories).toBeUndefined();
    expect(getSyncConfig().speeds).toBe(true);
    let got: Record<string, unknown> = {};
    STORE.get(["globalSpeed"], (r) => {
      got = r;
    });
    expect(got.globalSpeed).toBe(1.75);
  });

  it("keeps the master switch on when moving synced categories to local fails", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 1.75;
    env.failNext.local.set = "quota exceeded";
    const { getSyncMaster, setMasterSync } = await freshStore(env.chrome);
    let ok: boolean | undefined;

    setMasterSync(false, (result) => {
      ok = result;
    });

    expect(ok).toBe(false);
    expect(env.backing.sync.globalSpeed).toBe(1.75);
    expect(env.backing.local.globalSpeed).toBeUndefined();
    expect(env.backing.local.syncMaster).toBeUndefined();
    expect(getSyncMaster()).toBe(true);
  });

  it("tolerates a missing callback when moving synced categories to local fails", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 1.75;
    env.failNext.local.set = "quota exceeded";
    const { getSyncMaster, setMasterSync } = await freshStore(env.chrome);

    expect(() => setMasterSync(false)).not.toThrow();
    expect(getSyncMaster()).toBe(true);
  });

  it("keeps routing to sync until the master switch migration finishes", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 1.75;
    env.holdNext.local.set = true;
    const { STORE, getSyncMaster, setMasterSync } = await freshStore(env.chrome);

    setMasterSync(false);

    expect(getSyncMaster()).toBe(true);
    let got: Record<string, unknown> = {};
    STORE.get(["globalSpeed"], (r) => {
      got = r;
    });
    expect(got.globalSpeed).toBe(1.75);

    env.resumeHeld();

    expect(getSyncMaster()).toBe(false);
    STORE.get(["globalSpeed"], (r) => {
      got = r;
    });
    expect(got.globalSpeed).toBe(1.75);
  });

  it("keeps the master switch on when persisting the switch fails after copying", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 1.75;
    env.failNext.local.set = [null, "quota exceeded"];
    const { STORE, getSyncMaster, setMasterSync } = await freshStore(env.chrome);
    let ok: boolean | undefined;

    setMasterSync(false, (result) => {
      ok = result;
    });

    expect(ok).toBe(false);
    expect(env.backing.sync.globalSpeed).toBe(1.75);
    expect(env.backing.local.globalSpeed).toBe(1.75);
    expect(env.backing.local.syncMaster).toBeUndefined();
    expect(getSyncMaster()).toBe(true);
    let got: Record<string, unknown> = {};
    STORE.get(["globalSpeed"], (r) => {
      got = r;
    });
    expect(got.globalSpeed).toBe(1.75);
  });

  it("routes the category to its new area by the time done reports success", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 1.75;
    const { getSyncConfig, routedChanges, setCategorySync } = await freshStore(env.chrome);
    let seen: unknown;

    setCategorySync("speeds", false, (ok) => {
      seen = {
        ok,
        speeds: getSyncConfig().speeds,
        local: routedChanges({ globalSpeed: 1 }, "local"),
      };
    });

    expect(seen).toEqual({ ok: true, speeds: false, local: { globalSpeed: 1 } });
  });

  it("re-asserting a category's current preference moves nothing", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 2;
    env.backing.local.globalSpeed = 1.5; // stale copy left by an earlier opt-out
    const { setCategorySync } = await freshStore(env.chrome);
    const done = vi.fn();

    setCategorySync("speeds", true, done);

    expect(done).toHaveBeenCalledWith(true);
    expect(env.backing.sync.globalSpeed).toBe(2);
  });

  it("reports failure and keeps routing when reading the category to move fails", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 1.75;
    const { getSyncConfig, setCategorySync } = await freshStore(env.chrome);
    env.failNext.sync.get = "sync read failed";
    const done = vi.fn();

    setCategorySync("speeds", false, done);

    expect(done).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledWith(false);
    expect(getSyncConfig().speeds).toBe(true);
    expect(env.backing.local).toEqual({});
  });

  it("opting an empty category into sync needs no write there", async () => {
    const env = makeChrome();
    env.backing.local.syncCategories = { audio: false };
    const { getSyncConfig, setCategorySync } = await freshStore(env.chrome);
    // Sync is refusing writes (say, rate-limited); with no audio settings stored, none is needed.
    env.failNext.sync.set = "sync write quota exceeded";
    const done = vi.fn();

    setCategorySync("audio", true, done);

    expect(done).toHaveBeenCalledWith(true);
    expect(getSyncConfig().audio).toBe(true);
  });
});

describe("routedChanges", () => {
  const change = { newValue: 2 };

  it("keeps each change only from the area its key routes to", async () => {
    const env = makeChrome();
    env.backing.local.syncCategories = { speeds: false }; // speeds local, audio synced
    const { routedChanges } = await freshStore(env.chrome);

    // Another device's speed edit still syncs into storage.sync, but isn't ours.
    expect(routedChanges({ globalSpeed: change, audioComp: change }, "sync")).toEqual({
      audioComp: change,
    });
    expect(routedChanges({ globalSpeed: change, audioComp: change }, "local")).toEqual({
      globalSpeed: change,
    });
    expect(routedChanges({ syncMaster: change }, "local")).toEqual({ syncMaster: change });
    expect(routedChanges({ syncMaster: change }, "sync")).toEqual({});
    expect(routedChanges({ audioComp: change }, "managed")).toEqual({});
  });

  it("drops every synced change while the master switch is off", async () => {
    const env = makeChrome();
    env.backing.local.syncMaster = false;
    const { routedChanges } = await freshStore(env.chrome);

    expect(routedChanges({ siteBlacklist: change, keymap: change }, "sync")).toEqual({});
    expect(routedChanges({ siteBlacklist: change }, "local")).toEqual({ siteBlacklist: change });
  });

  it("follows a routing change made in another context", async () => {
    const env = makeChrome();
    const { routedChanges } = await freshStore(env.chrome);
    expect(routedChanges({ globalSpeed: change }, "sync")).toEqual({ globalSpeed: change });

    env.chrome.storage.local.set({ syncCategories: { speeds: false } });

    expect(routedChanges({ globalSpeed: change }, "sync")).toEqual({});
    expect(routedChanges({ globalSpeed: change }, "local")).toEqual({ globalSpeed: change });
  });

  it("keeps local changes when there is no sync area", async () => {
    const env = makeChrome();
    (env.chrome.storage as { sync?: unknown }).sync = undefined;
    const { routedChanges } = await freshStore(env.chrome);

    expect(routedChanges({ globalSpeed: change }, "local")).toEqual({ globalSpeed: change });
  });
});
