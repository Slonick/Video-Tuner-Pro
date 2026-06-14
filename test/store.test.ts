import { describe, it, expect, beforeEach, vi } from "vitest";

// A chrome mock with SEPARATE sync/local backing stores (unlike the shared mock,
// which shares one), so we can observe routing and migration between the two.
function makeChrome() {
  const sync: Record<string, unknown> = {};
  const local: Record<string, unknown> = {};
  const listeners: Array<(c: Record<string, { newValue?: unknown }>, area: string) => void> = [];
  const area = (backing: Record<string, unknown>, name: string) => ({
    get(keys: string | string[] | null, cb: (items: Record<string, unknown>) => void) {
      let out: Record<string, unknown> = {};
      if (keys == null) out = { ...backing };
      else for (const k of (typeof keys === "string" ? [keys] : keys)) if (k in backing) out[k] = backing[k];
      cb(out);
    },
    set(obj: Record<string, unknown>, cb?: () => void) {
      const changes: Record<string, { newValue?: unknown }> = {};
      for (const k of Object.keys(obj)) { backing[k] = obj[k]; changes[k] = { newValue: obj[k] }; }
      cb?.();
      listeners.forEach((l) => l(changes, name));
    },
    remove(keys: string | string[], cb?: () => void) {
      const changes: Record<string, { newValue?: unknown }> = {};
      for (const k of (Array.isArray(keys) ? keys : [keys])) { delete backing[k]; changes[k] = {}; }
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
        onChanged: { addListener: (l: (c: Record<string, { newValue?: unknown }>, a: string) => void) => listeners.push(l) },
      },
    } as unknown as typeof chrome,
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
  beforeEach(() => { env = makeChrome(); });

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
    STORE.get(["globalSpeed", "audioComp"], (r) => { got = r; });
    expect(got).toEqual({ globalSpeed: 2 });
  });

  it("whenReady fires after the config has loaded", async () => {
    const { whenReady } = await freshStore(env.chrome);
    let fired = false;
    whenReady(() => { fired = true; });
    expect(fired).toBe(true); // mock get is synchronous → ready by now
  });

  it("get(null) merges both areas (the export path)", async () => {
    env.backing.sync.audioComp = true;
    env.backing.local.syncCategories = { speeds: false };
    env.backing.local.globalSpeed = 1.5; // speeds opted out → lives in local
    const { STORE } = await freshStore(env.chrome);
    let all: Record<string, unknown> = {};
    STORE.get(null, (r) => { all = r; });
    expect(all.audioComp).toBe(true);
    expect(all.globalSpeed).toBe(1.5);
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
  it("defaults on; turning it off moves every synced category to local", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 1.75; // speeds
    env.backing.sync.audioComp = true;   // audio
    const { getSyncMaster, setMasterSync } = await freshStore(env.chrome);
    expect(getSyncMaster()).toBe(true);

    setMasterSync(false);
    expect(getSyncMaster()).toBe(false);
    expect(env.backing.local.globalSpeed).toBe(1.75);
    expect(env.backing.local.audioComp).toBe(true);
    expect(env.backing.sync.globalSpeed).toBeUndefined();
    expect(env.backing.sync.audioComp).toBeUndefined();
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
    STORE.get(["globalSpeed", "audioComp"], (r) => { got = r; });
    expect(got).toEqual({ globalSpeed: 2, audioComp: true });
  });

  it("turning it back on restores synced categories to sync, leaving opted-out ones local", async () => {
    const env = makeChrome();
    env.backing.local.syncMaster = false;
    env.backing.local.syncCategories = { speeds: false };  // speeds opted out
    env.backing.local.globalSpeed = 1.5;  // speeds → stays local
    env.backing.local.audioComp = true;   // audio synced-pref, local while master off
    const { setMasterSync } = await freshStore(env.chrome);

    setMasterSync(true);
    expect(env.backing.sync.audioComp).toBe(true);       // pulled up
    expect(env.backing.local.audioComp).toBeUndefined();
    expect(env.backing.local.globalSpeed).toBe(1.5);     // opted-out stays put
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
    expect(env.backing.sync.audioComp).toBe(true);    // back in sync
    expect(env.backing.local.globalSpeed).toBe(1.5);  // still local
  });

  it("while master is off, toggling a category only records intent (no migration)", async () => {
    const env = makeChrome();
    env.backing.local.syncMaster = false;
    env.backing.local.audioComp = true;
    const { setCategorySync, getSyncConfig } = await freshStore(env.chrome);

    setCategorySync("audio", false);
    expect(env.backing.local.audioComp).toBe(true);        // unchanged — already local
    expect(env.backing.sync.audioComp).toBeUndefined();
    expect(getSyncConfig().audio).toBe(false);             // preference recorded
    expect((env.backing.local.syncCategories as Record<string, boolean>).audio).toBe(false);
  });

  it("setting the switch to its current value is a no-op (still persisted, nothing moved)", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 2;
    const { setMasterSync } = await freshStore(env.chrome);
    setMasterSync(true); // already on
    expect(env.backing.sync.globalSpeed).toBe(2);   // unmoved
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
    STORE.get(["globalSpeed"], (r) => { got = r; });
    expect(got.globalSpeed).toBeUndefined();
  });
});

describe("setCategorySync migration", () => {
  it("moves a category's keys from sync to local when opted out", async () => {
    const env = makeChrome();
    env.backing.sync.globalSpeed = 1.75;
    env.backing.sync.domains = { a: 1.5 };
    const { STORE, setCategorySync } = await freshStore(env.chrome);
    setCategorySync("speeds", false);
    expect(env.backing.sync.globalSpeed).toBeUndefined();
    expect(env.backing.local.globalSpeed).toBe(1.75);
    expect(env.backing.local.domains).toEqual({ a: 1.5 });
    // The meta itself is recorded in local.
    expect((env.backing.local.syncCategories as Record<string, boolean>).speeds).toBe(false);
    // Subsequent writes for that category now land in local.
    STORE.set({ globalSpeed: 3 });
    expect(env.backing.local.globalSpeed).toBe(3);
    expect(env.backing.sync.globalSpeed).toBeUndefined();
  });

  it("moves keys back to sync when re-enabled", async () => {
    const env = makeChrome();
    env.backing.local.audioComp = true;
    env.backing.local.syncCategories = { audio: false };
    const { setCategorySync } = await freshStore(env.chrome);
    setCategorySync("audio", true);
    expect(env.backing.sync.audioComp).toBe(true);
    expect(env.backing.local.audioComp).toBeUndefined();
  });
});
