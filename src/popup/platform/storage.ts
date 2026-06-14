// Storage access routes through the shared selective-sync layer: each setting
// lives in chrome.storage.sync or .local depending on its category (see
// src/shared/store.ts). STORE keeps the same get/set/remove shape as a storage
// area, so callers are unchanged.
export { STORE, whenReady } from "../../shared/store.js";
