// Prefer cross-device sync storage; fall back to device-local when sync is absent.
import { api } from "./browser.js";

export const STORE = (api.storage && api.storage.sync) ? api.storage.sync : api.storage.local;
export const STORE_AREA = (api.storage && STORE === api.storage.sync) ? "sync" : "local";
