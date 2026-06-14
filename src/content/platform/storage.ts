// Storage access routes through the shared selective-sync layer: each setting
// lives in chrome.storage.sync or .local depending on its category (see
// src/shared/store.ts). STORE keeps the same get/set/remove shape as a storage
// area, so callers are unchanged. With selective sync a key can live in either
// area, so onChanged listeners react to both "sync" and "local" (see OUR_AREAS).
export { STORE, whenReady } from "../../shared/store.js";

// A storage change is ours if it came from either area we route into.
export const OUR_AREAS = new Set(["sync", "local"]);
