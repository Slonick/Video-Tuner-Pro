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
