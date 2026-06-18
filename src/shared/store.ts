// Routed storage — a drop-in replacement for a chrome.storage area that sends
// each key to chrome.storage.sync or .local based on its category's sync setting
// (see ./sync-config.ts). The get/set/remove signatures match a storage area, so
// existing `STORE.get(keys, cb)` call sites keep working unchanged.
//
// Routing is synchronous over a cached config (defaulting to "all synced", which
// matches the pre-feature behaviour). The config is loaded from local storage at
// startup; entry points call whenReady() before their first read so an opted-out
// category isn't briefly read from the wrong area on a cold load.
import {
  KEYS_BY_CATEGORY,
  SYNC_META_KEY,
  SYNC_MASTER_KEY,
  DEFAULT_SYNC,
  DEFAULT_MASTER,
  normalizeConfig,
  effectiveConfig,
  groupKeysByArea,
  type Category,
  type SyncConfig,
} from "./sync-config.js";

const api = typeof browser !== "undefined" ? browser : chrome;

const LOCAL = api.storage.local;
// Fall back to local when sync is unavailable; then both "areas" are the same
// object and migrations become no-ops (guarded below).
const SYNC = api.storage && api.storage.sync ? api.storage.sync : LOCAL;
const HAS_SYNC = SYNC !== LOCAL;

type Items = Record<string, unknown>;
type GetCb = (items: Items) => void;
type DoneCb = () => void;

const areaObj = (name: "sync" | "local") => (name === "sync" ? SYNC : LOCAL);

// --- Cached config -----------------------------------------------------------
// `prefs` is the user's per-category intent; `master` is the global switch. The
// router uses their combination (`cfg` — everything-local while master is off).
let prefs: SyncConfig = { ...DEFAULT_SYNC };
let master = DEFAULT_MASTER;
let cfg: SyncConfig = effectiveConfig(prefs, master);
let ready = false;
const readyWaiters: DoneCb[] = [];

function recompute(): void {
  cfg = effectiveConfig(prefs, master);
}

LOCAL.get([SYNC_META_KEY, SYNC_MASTER_KEY], (r) => {
  prefs = normalizeConfig(r[SYNC_META_KEY]);
  if (typeof r[SYNC_MASTER_KEY] === "boolean") master = r[SYNC_MASTER_KEY] as boolean;
  recompute();
  ready = true;
  while (readyWaiters.length) readyWaiters.shift()!();
});

// Keep the cached config live when another context (the options page) changes it.
api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[SYNC_META_KEY]) prefs = normalizeConfig(changes[SYNC_META_KEY].newValue);
  if (changes[SYNC_MASTER_KEY] && typeof changes[SYNC_MASTER_KEY].newValue === "boolean") {
    master = changes[SYNC_MASTER_KEY].newValue as boolean;
  }
  if (changes[SYNC_META_KEY] || changes[SYNC_MASTER_KEY]) recompute();
});

// Run cb once the sync config has loaded (immediately if it already has).
export function whenReady(cb: DoneCb): void {
  if (ready) cb();
  else readyWaiters.push(cb);
}

// The per-category preferences (what the UI shows), independent of the master
// switch. Use getSyncMaster() for the switch state itself.
export function getSyncConfig(): SyncConfig {
  return { ...prefs };
}

export function getSyncMaster(): boolean {
  return master;
}

// --- Multi-area fan-out, collapsed to a single callback ----------------------
function fanGet(plan: Array<["sync" | "local", string[] | null]>, cb: GetCb): void {
  const out: Items = {};
  if (!plan.length) {
    cb(out);
    return;
  }
  let pending = plan.length;
  for (const [name, keys] of plan) {
    areaObj(name).get(keys as string[], (items) => {
      Object.assign(out, items);
      if (--pending === 0) cb(out);
    });
  }
}

function fanDone(calls: Array<(done: DoneCb) => void>, cb?: DoneCb): void {
  if (!calls.length) {
    cb?.();
    return;
  }
  let pending = calls.length;
  const one = () => {
    if (--pending === 0) cb?.();
  };
  for (const run of calls) run(one);
}

// --- The routed area object (matches chrome.storage.StorageArea shape) --------
export const STORE = {
  get(keys: string | string[] | null | undefined, cb: GetCb): void {
    if (keys == null) {
      fanGet(
        [
          ["sync", null],
          ["local", null],
        ],
        cb,
      );
      return;
    }
    const list = typeof keys === "string" ? [keys] : keys;
    const { sync, local } = groupKeysByArea(list, cfg);
    const plan: Array<["sync" | "local", string[]]> = [];
    if (sync.length) plan.push(["sync", sync]);
    if (local.length) plan.push(["local", local]);
    fanGet(plan, cb);
  },

  set(obj: Items, cb?: DoneCb): void {
    const bySync: Items = {},
      byLocal: Items = {};
    const grouped = groupKeysByArea(Object.keys(obj), cfg);
    for (const k of grouped.sync) bySync[k] = obj[k];
    for (const k of grouped.local) byLocal[k] = obj[k];
    const calls: Array<(done: DoneCb) => void> = [];
    if (Object.keys(bySync).length) calls.push((d) => SYNC.set(bySync, d));
    if (Object.keys(byLocal).length) calls.push((d) => LOCAL.set(byLocal, d));
    fanDone(calls, cb);
  },

  remove(keys: string | string[], cb?: DoneCb): void {
    const list = typeof keys === "string" ? [keys] : keys;
    const { sync, local } = groupKeysByArea(list, cfg);
    const calls: Array<(done: DoneCb) => void> = [];
    if (sync.length) calls.push((d) => SYNC.remove(sync, d));
    if (local.length) calls.push((d) => LOCAL.remove(local, d));
    fanDone(calls, cb);
  },
};

// --- Migrating keys between the two areas as preferences change --------------
type Area = typeof SYNC | typeof LOCAL;

function persistPrefs(done?: DoneCb): void {
  LOCAL.set({ [SYNC_META_KEY]: prefs }, () => done?.());
}
function persistMaster(done?: DoneCb): void {
  LOCAL.set({ [SYNC_MASTER_KEY]: master }, () => done?.());
}

// Move one category's stored keys from one area to the other (a no-op when none
// are present). Persisting the new preference is the caller's job.
function migrateCategory(cat: Category, from: Area, to: Area, done: DoneCb): void {
  const keys = KEYS_BY_CATEGORY[cat];
  from.get(keys, (items) => {
    const present = Object.keys(items);
    if (!present.length) {
      done();
      return;
    }
    to.set(items, () => from.remove(present, done));
  });
}

export function setCategorySync(cat: Category, synced: boolean, done?: DoneCb): void {
  const was = prefs[cat];
  prefs = { ...prefs, [cat]: synced };
  recompute();
  // Nothing to migrate when there's no sync area, the master switch already keeps
  // everything local, or the preference didn't actually change — just record it.
  if (!HAS_SYNC || !master || was === synced) {
    persistPrefs(done);
    return;
  }
  const from = synced ? LOCAL : SYNC; // where the keys currently live
  const to = synced ? SYNC : LOCAL; // where they should move to
  migrateCategory(cat, from, to, () => persistPrefs(done));
}

// Flip the master switch: categories the user wants synced migrate between local
// and sync; categories already kept local don't move. Preferences are untouched,
// so turning the switch back on restores exactly what was synced before.
export function setMasterSync(on: boolean, done?: DoneCb): void {
  if (master === on) {
    persistMaster(done);
    return;
  }
  master = on;
  recompute();
  const cats = (Object.keys(prefs) as Category[]).filter((c) => prefs[c]);
  if (!HAS_SYNC || !cats.length) {
    persistMaster(done);
    return;
  }
  const from = on ? LOCAL : SYNC; // on: pull synced categories up; off: push them down
  const to = on ? SYNC : LOCAL;
  let pending = cats.length;
  const one = () => {
    if (--pending === 0) persistMaster(done);
  };
  for (const c of cats) migrateCategory(c, from, to, one);
}
