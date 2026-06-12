// Shared content-script environment: the browser API alias, storage, constants,
// and small guarded helpers used across modules.
export const api = (typeof browser !== "undefined") ? browser : chrome;

// Settings sync across the user's devices (Chrome Sync / Firefox Sync). Falls
// back to device-local storage if sync is missing.
export const STORE = (api.storage && api.storage.sync) ? api.storage.sync : api.storage.local;
export const STORE_AREA = (api.storage && STORE === api.storage.sync) ? "sync" : "local";

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 16;

// --- Live-sync tuning ---
export const MIN_FORWARD_BUFFER = 0.3;    // smallest buffer we'll ever drain down to
export const LIVE_MAX_FLOOR = 1.25;       // catch-up rate can never be set below 125%
export const CATCHUP_START = 2.0;         // begin catching up once this many seconds beyond the target
export const CATCHUP_STOP = 0.3;          // stop once back within this of the target

export function getDomain() {
  return window.location.hostname;
}

// The extension context dies when the extension is reloaded/updated; any api.*
// call from this orphaned script then throws. Detect that and shut down cleanly.
export function ctxValid() {
  try { return !!(api.runtime && api.runtime.id); } catch (e) { return false; }
}

// Localized string, guarded so a dead context never throws an uncaught error.
export function i18n(key, subs) {
  try { return api.i18n.getMessage(key, subs) || ""; } catch (e) { return ""; }
}

export function clamp(speed) {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 100) / 100));
}

export function clampTarget(n) {
  n = Number(n);
  if (Number.isNaN(n)) return 5;
  return Math.min(15, Math.max(0, Math.round(n)));
}

export function clampMax(n) {
  n = Number(n);
  if (Number.isNaN(n)) return 1.5;
  return Math.min(3, Math.max(LIVE_MAX_FLOOR, Math.round(n * 100) / 100));
}

// Clamp a numeric setting to [lo, hi], falling back to def when not a number.
export function clampNum(v, lo, hi, def) {
  const n = Number(v);
  if (Number.isNaN(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}

export function alog(...args) { try { console.info("[Video Tuner]", ...args); } catch (e) {} }
