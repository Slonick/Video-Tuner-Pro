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
  areaForKey,
  groupKeysByArea,
  type Category,
  type SyncConfig,
} from "./sync-config.js";
import { getExtensionApi } from "./extension-api.js";

const api = getExtensionApi();

const LOCAL = api.storage.local;
// Fall back to local when sync is unavailable; then both "areas" are the same
// object and migrations become no-ops (guarded below).
const SYNC = api.storage && api.storage.sync ? api.storage.sync : LOCAL;
const HAS_SYNC = SYNC !== LOCAL;

type Items = Record<string, unknown>;
type GetCb = (items: Items) => void;
type DoneCb = (ok?: boolean) => void;
type ResultCb = (ok: boolean) => void;

const areaObj = (name: "sync" | "local") => (name === "sync" ? SYNC : LOCAL);

function storageOk(): boolean {
  return !api.runtime?.lastError;
}

function areaSet(area: Area, obj: Items, done: ResultCb): void {
  area.set(obj, () => done(storageOk()));
}

function areaRemove(area: Area, keys: string | string[], done: ResultCb): void {
  area.remove(keys, () => done(storageOk()));
}

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

// Call `cb` whenever any of `keys` changes in storage (in either area — a key's
// area depends on the sync config). Lets an open popup re-read a setting when
// another context (the options page) edits it; the on-video overlay especially
// needs this, since it stays open across tab switches. Returns an unsubscribe.
export function subscribe(keys: string[], cb: DoneCb): () => void {
  const watch = new Set(keys);
  const listener = (changes: Record<string, unknown>) => {
    for (const k in changes) {
      if (watch.has(k)) {
        cb();
        return;
      }
    }
  };
  api.storage.onChanged.addListener(listener);
  return () => api.storage.onChanged.removeListener(listener);
}

// --- Multi-area fan-out, collapsed to a single callback ----------------------
function routedMerge(syncItems: Items, localItems: Items): Items {
  const out: Items = {};
  const keys = new Set([...Object.keys(syncItems), ...Object.keys(localItems)]);
  for (const k of keys) {
    if (k === SYNC_META_KEY || k === SYNC_MASTER_KEY) {
      if (k in localItems) out[k] = localItems[k];
      continue;
    }
    const area = areaForKey(k, cfg);
    if (area === "sync" && k in syncItems) out[k] = syncItems[k];
    if (area === "local" && k in localItems) out[k] = localItems[k];
  }
  return out;
}

function fanGet(plan: Array<["sync" | "local", string[] | null]>, cb: GetCb): void {
  const out: Items = {};
  if (!plan.length) {
    cb(out);
    return;
  }
  let pending = plan.length;
  for (const [name, keys] of plan) {
    areaObj(name).get(keys as string[], (items) => {
      if (storageOk()) Object.assign(out, items);
      if (--pending === 0) cb(out);
    });
  }
}

function fanDone(calls: Array<(done: ResultCb) => void>, cb?: DoneCb): void {
  if (!calls.length) {
    cb?.(true);
    return;
  }
  let pending = calls.length;
  let ok = true;
  const one = (result: boolean) => {
    ok = ok && result;
    if (--pending === 0) cb?.(ok);
  };
  for (const run of calls) run(one);
}

// --- The routed area object (matches chrome.storage.StorageArea shape) --------
export const STORE = {
  get(keys: string | string[] | null | undefined, cb: GetCb): void {
    if (keys == null) {
      let syncItems: Items | null = null;
      let localItems: Items | null = null;
      const finish = () => {
        if (syncItems && localItems) cb(routedMerge(syncItems, localItems));
      };
      SYNC.get(null, (items) => {
        syncItems = storageOk() ? items : {};
        finish();
      });
      LOCAL.get(null, (items) => {
        localItems = storageOk() ? items : {};
        finish();
      });
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
    const calls: Array<(done: ResultCb) => void> = [];
    if (Object.keys(bySync).length) calls.push((d) => areaSet(SYNC, bySync, d));
    if (Object.keys(byLocal).length) calls.push((d) => areaSet(LOCAL, byLocal, d));
    fanDone(calls, cb);
  },

  remove(keys: string | string[], cb?: DoneCb): void {
    const list = typeof keys === "string" ? [keys] : keys;
    const { sync, local } = groupKeysByArea(list, cfg);
    const calls: Array<(done: ResultCb) => void> = [];
    if (sync.length) calls.push((d) => areaRemove(SYNC, sync, d));
    if (local.length) calls.push((d) => areaRemove(LOCAL, local, d));
    fanDone(calls, cb);
  },

  removeEverywhere(keys: string | string[], cb?: DoneCb): void {
    const list = Array.from(new Set(typeof keys === "string" ? [keys] : keys));
    const calls: Array<(done: ResultCb) => void> = [];
    if (list.length) calls.push((d) => areaRemove(LOCAL, list, d));
    if (HAS_SYNC && list.length) calls.push((d) => areaRemove(SYNC, list, d));
    fanDone(calls, cb);
  },
};

// --- Migrating keys between the two areas as preferences change --------------
type Area = typeof SYNC | typeof LOCAL;

function commitPrefs(next: SyncConfig): void {
  prefs = next;
  recompute();
}

function commitMaster(next: boolean): void {
  master = next;
  recompute();
}

function persistPrefs(next: SyncConfig, done?: DoneCb): void {
  areaSet(LOCAL, { [SYNC_META_KEY]: next }, (ok) => done?.(ok));
}
function persistMaster(next: boolean, done?: DoneCb): void {
  areaSet(LOCAL, { [SYNC_MASTER_KEY]: next }, (ok) => done?.(ok));
}

// Copy one category's stored keys to the newly-routed area. We deliberately keep
// the source copy: storage.onChanged remove events look identical to a user reset
// for live content scripts, while the router ignores the stale area anyway.
function migrateCategory(cat: Category, from: Area, to: Area, done: ResultCb): void {
  const keys = KEYS_BY_CATEGORY[cat];
  from.get(keys, (items) => {
    if (!storageOk()) {
      done(false);
      return;
    }
    const present = Object.keys(items);
    if (!present.length) {
      done(true);
      return;
    }
    areaSet(to, items, done);
  });
}

export function setCategorySync(cat: Category, synced: boolean, done?: DoneCb): void {
  const was = prefs[cat];
  const nextPrefs = { ...prefs, [cat]: synced };
  // Nothing to migrate when there's no sync area, the master switch already keeps
  // everything local, or the preference didn't actually change — just record it.
  if (!HAS_SYNC || !master || was === synced) {
    persistPrefs(nextPrefs, (ok) => {
      if (ok) commitPrefs(nextPrefs);
      done?.(ok);
    });
    return;
  }
  const from = synced ? LOCAL : SYNC; // where the keys currently live
  const to = synced ? SYNC : LOCAL; // where they should move to
  migrateCategory(cat, from, to, (ok) => {
    if (ok) {
      persistPrefs(nextPrefs, (saved) => {
        if (saved) commitPrefs(nextPrefs);
        done?.(saved);
      });
      return;
    }
    done?.(false);
  });
}

// Flip the master switch: categories the user wants synced migrate between local
// and sync; categories already kept local don't move. Preferences are untouched,
// so turning the switch back on restores exactly what was synced before.
export function setMasterSync(on: boolean, done?: DoneCb): void {
  if (master === on) {
    persistMaster(on, (ok) => {
      if (ok) commitMaster(on);
      done?.(ok);
    });
    return;
  }
  const cats = (Object.keys(prefs) as Category[]).filter((c) => prefs[c]);
  if (!HAS_SYNC || !cats.length) {
    persistMaster(on, (ok) => {
      if (ok) commitMaster(on);
      done?.(ok);
    });
    return;
  }
  const from = on ? LOCAL : SYNC; // on: pull synced categories up; off: push them down
  const to = on ? SYNC : LOCAL;
  let pending = cats.length;
  let ok = true;
  const one = (moved: boolean) => {
    ok = ok && moved;
    if (--pending !== 0) return;
    if (ok) {
      persistMaster(on, (saved) => {
        if (saved) commitMaster(on);
        done?.(saved);
      });
      return;
    }
    done?.(false);
  };
  for (const c of cats) migrateCategory(c, from, to, one);
}
