// Provide a global `chrome` before any module that aliases it (platform/browser)
// is imported, so importing such modules in tests doesn't ReferenceError.
import { createMockChrome } from "./mocks/chrome.js";

(globalThis as unknown as { chrome: typeof chrome }).chrome = createMockChrome();

// jsdom has no canvas; return null so the graph code bails cleanly instead of
// logging a "Not implemented: getContext" warning on every popup test.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
}

// jsdom has no ResizeObserver; Radix Slider (via react-use-size) needs it. A
// no-op stub is enough — the tests don't assert on measured sizes.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom lacks pointer capture; Radix Slider calls these when a drag is simulated.
if (typeof Element !== "undefined") {
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  // Return true so Radix's pointermove/up handlers (gated on capture) run in jsdom.
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => true;
}

// jsdom has no matchMedia; report "reduced motion" so slider tweens settle
// synchronously and tests can read the final value right after an action.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: /prefers-reduced-motion/.test(q),
    media: q,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  })) as typeof window.matchMedia;
}
