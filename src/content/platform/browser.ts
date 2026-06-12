// Firefox exposes `browser`, Chromium `chrome`; both support the callback style
// we use, so we alias to one.
export const api = (typeof browser !== "undefined") ? browser : chrome;

// The extension context dies when the extension is reloaded/updated; any api.*
// call from this orphaned script then throws. Detect that and shut down cleanly.
export function ctxValid(): boolean {
  try { return !!(api.runtime && api.runtime.id); } catch (e) { return false; }
}
