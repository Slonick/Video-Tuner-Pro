import { api } from "./browser.js";

export const STORE = (api.storage && api.storage.sync) ? api.storage.sync : api.storage.local;
