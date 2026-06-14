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
  KEYS_BY_CATEGORY, SYNC_META_KEY, DEFAULT_SYNC,
  normalizeConfig, groupKeysByArea, type Category, type SyncConfig,
} from "./sync-config.js";

const api = (typeof browser !== "undefined") ? browser : chrome;

const LOCAL = api.storage.local;
// Fall back to local when sync is unavailable; then both "areas" are the same
// object and migrations become no-ops (guarded below).
const SYNC = (api.storage && api.storage.sync) ? api.storage.sync : LOCAL;
const HAS_SYNC = SYNC !== LOCAL;

type Items = Record<string, unknown>;
type GetCb = (items: Items) => void;
type DoneCb = () => void;

const areaObj = (name: "sync" | "local") => (name === "sync" ? SYNC : LOCAL);

// --- Cached config -----------------------------------------------------------
let cfg: SyncConfig = { ...DEFAULT_SYNC };
let ready = false;
const readyWaiters: DoneCb[] = [];

function applyConfig(raw: unknown): void {
  cfg = normalizeConfig(raw);
}

LOCAL.get([SYNC_META_KEY], (r) => {
  applyConfig(r[SYNC_META_KEY]);
  ready = true;
  while (readyWaiters.length) readyWaiters.shift()!();
});

// Keep the cached config live when another context (the options page) changes it.
api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SYNC_META_KEY]) applyConfig(changes[SYNC_META_KEY].newValue);
});

// Run cb once the sync config has loaded (immediately if it already has).
export function whenReady(cb: DoneCb): void {
  if (ready) cb();
  else readyWaiters.push(cb);
}

export function getSyncConfig(): SyncConfig {
  return { ...cfg };
}

// --- Multi-area fan-out, collapsed to a single callback ----------------------
function fanGet(plan: Array<["sync" | "local", string[] | null]>, cb: GetCb): void {
  const out: Items = {};
  if (!plan.length) { cb(out); return; }
  let pending = plan.length;
  for (const [name, keys] of plan) {
    areaObj(name).get(keys as string[], (items) => {
      Object.assign(out, items);
      if (--pending === 0) cb(out);
    });
  }
}

function fanDone(calls: Array<(done: DoneCb) => void>, cb?: DoneCb): void {
  if (!calls.length) { cb?.(); return; }
  let pending = calls.length;
  const one = () => { if (--pending === 0) cb?.(); };
  for (const run of calls) run(one);
}

// --- The routed area object (matches chrome.storage.StorageArea shape) --------
export const STORE = {
  get(keys: string | string[] | null | undefined, cb: GetCb): void {
    if (keys == null) { fanGet([["sync", null], ["local", null]], cb); return; }
    const list = typeof keys === "string" ? [keys] : keys;
    const { sync, local } = groupKeysByArea(list, cfg);
    const plan: Array<["sync" | "local", string[]]> = [];
    if (sync.length) plan.push(["sync", sync]);
    if (local.length) plan.push(["local", local]);
    fanGet(plan, cb);
  },

  set(obj: Items, cb?: DoneCb): void {
    const bySync: Items = {}, byLocal: Items = {};
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

// --- Toggling a category's sync: migrate its keys between the two areas -------
function persistConfig(done?: DoneCb): void {
  LOCAL.set({ [SYNC_META_KEY]: cfg }, () => done?.());
}

export function setCategorySync(cat: Category, synced: boolean, done?: DoneCb): void {
  const was = cfg[cat];
  cfg = { ...cfg, [cat]: synced };
  // No sync area, or no actual change → just record the preference.
  if (!HAS_SYNC || was === synced) { persistConfig(done); return; }

  const from = synced ? LOCAL : SYNC;   // where the keys currently live
  const to = synced ? SYNC : LOCAL;     // where they should move to
  const keys = KEYS_BY_CATEGORY[cat];
  from.get(keys, (items) => {
    const present = Object.keys(items);
    const finish = () => persistConfig(done);
    if (!present.length) { finish(); return; }
    to.set(items, () => from.remove(present, finish));
  });
}

export function loadSyncConfig(cb: (cfg: SyncConfig) => void): void {
  whenReady(() => cb(getSyncConfig()));
}
