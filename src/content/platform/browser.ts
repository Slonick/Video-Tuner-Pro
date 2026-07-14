// Firefox exposes `browser`, Chromium `chrome`; validate the runtime before
// choosing because host pages may publish an unrelated global named `browser`.
import { getExtensionApi } from "../../shared/extension-api.js";

export const api = getExtensionApi();

// The extension context dies when the extension is reloaded/updated; any api.*
// call from this orphaned script then throws. Detect that and shut down cleanly.
export function ctxValid(): boolean {
  try {
    return !!(api.runtime && api.runtime.id);
  } catch (e) {
    return false;
  }
}
