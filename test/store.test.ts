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
  const holdNext: Record<string, Partial<Record<"set", boolean>>> = {
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
      if (fail(name, "get", () => cb({}))) return;
      let out: Record<string, unknown> = {};
      if (keys == null) out = { ...backing };
      else
        for (const k of typeof keys === "string" ? [keys] : keys)
          if (k in backing) out[k] = backing[k];
      cb(out);
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
    const { setMasterSync } = await freshStore(env.chrome);
    setMasterSync(true); // already on
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

    setMasterSync(false);

    expect(env.backing.sync.globalSpeed).toBe(1.75);
    expect(env.backing.local.globalSpeed).toBeUndefined();
    expect(env.backing.local.syncMaster).toBeUndefined();
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
});
