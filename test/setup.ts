// Provide a global `chrome` before any module that aliases it (platform/browser)
// is imported, so importing such modules in tests doesn't ReferenceError.
import { createMockChrome } from "./mocks/chrome.js";

(globalThis as unknown as { chrome: typeof chrome }).chrome = createMockChrome();

// jsdom has no canvas; return null so the graph code bails cleanly instead of
// logging a "Not implemented: getContext" warning on every popup test.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
}
