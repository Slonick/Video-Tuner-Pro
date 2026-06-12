// Shared popup environment: the browser API alias, storage, i18n, constants,
// a small mutable state bag (set by init, read by the poll loops), and helpers.
export const api = (typeof browser !== "undefined") ? browser : chrome;

// Settings sync across devices (Chrome Sync / Firefox Sync); falls back to local.
export const STORE = (api.storage && api.storage.sync) ? api.storage.sync : api.storage.local;

export const msg = (key, subs) => api.i18n.getMessage(key, subs);

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 16;

// Mutable state shared across modules (init writes it; the poll loops read it).
export const ctx = { activeTabId: null, currentDomain: "", liveMisses: 0 };

export function clamp(speed) {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 100) / 100));
}

export function clampNum(v, lo, hi, def) {
  const n = Number(v);
  if (Number.isNaN(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}

// Debounce writes — storage.sync rate-limits how often you may write, and the
// range sliders fire many "input" events while dragging.
export function debounce(fn, ms) {
  let timer = null;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

export function getActiveTab() {
  return new Promise((resolve) => {
    api.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}
