// Provide a global `chrome` before any module that aliases it (platform/browser)
// is imported, so importing such modules in tests doesn't ReferenceError.
import { createMockChrome } from "./mocks/chrome.js";

(globalThis as unknown as { chrome: typeof chrome }).chrome = createMockChrome();
