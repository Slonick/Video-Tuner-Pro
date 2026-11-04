// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  whenReady: vi.fn((fn: () => void) => fn()),
  initTheme: vi.fn(),
  render: vi.fn(),
  unmount: vi.fn(),
  observe: vi.fn(),
  postMessage: vi.fn(),
}));

vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: fx.render, unmount: fx.unmount }),
}));
vi.mock("../src/popup/platform/storage.js", () => ({ whenReady: fx.whenReady }));
vi.mock("../src/popup/i18n.js", () => ({ loadLang: (fn: () => void) => fn() }));
vi.mock("../src/shared/theme.js", () => ({ initTheme: fx.initTheme }));
vi.mock("../src/popup/components/App.js", () => ({ App: () => null }));

const parentDescriptor = Object.getOwnPropertyDescriptor(window, "parent");
// The page origin the launcher passes in the iframe URL.
const HOST = "https://www.youtube.com";
let popupModule: typeof import("../src/popup/index.js");

function pointer(type: string, init: Record<string, unknown>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, { value, configurable: true });
  }
  return event;
}

beforeAll(async () => {
  document.body.innerHTML =
    '<div id="root"></div><div class="header"><span>Video Tuner</span></div>';
  document.documentElement.getBoundingClientRect = () => ({ height: 539.4 }) as DOMRect;
  Object.defineProperty(window, "parent", {
    value: { postMessage: fx.postMessage },
    configurable: true,
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        fx.observe(target);
        this.callback([], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    },
  );
  history.replaceState(null, "", "?host=" + encodeURIComponent(HOST));
  popupModule = await import("../src/popup/index.js");
});

afterAll(() => {
  popupModule.unmountPopupForTest();
  if (parentDescriptor) Object.defineProperty(window, "parent", parentDescriptor);
  vi.unstubAllGlobals();
});

describe("embedded popup entry wiring", () => {
  it("boots after storage/language readiness and reports its initial height", () => {
    expect(fx.initTheme).toHaveBeenCalledOnce();
    // The theme is a routed setting: read before the sync config loads, it would come
    // from the default (all-synced) area.
    expect(fx.whenReady.mock.invocationCallOrder[0]).toBeLessThan(
      fx.initTheme.mock.invocationCallOrder[0],
    );
    expect(fx.render).toHaveBeenCalledOnce();
    expect(document.documentElement.classList.contains("vtp-embedded")).toBe(true);
    expect(fx.observe).toHaveBeenCalledWith(document.documentElement);
    expect(fx.postMessage).toHaveBeenCalledWith({ type: "vtp-overlay", height: 540 }, HOST);
  });

  it("forwards Escape to the launcher host", () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(fx.postMessage).toHaveBeenCalledWith({ type: "vtp-overlay", close: true }, HOST);
  });

  it("keeps the overlay open for an Escape a menu or tooltip already handled", () => {
    const before = fx.postMessage.mock.calls.length;
    const handled = (e: Event) => e.preventDefault();
    document.body.addEventListener("keydown", handled);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    document.body.removeEventListener("keydown", handled);
    expect(fx.postMessage.mock.calls.length).toBe(before);
  });

  it("posts drag movement, ignores sub-slop motion, and recognises a double click", () => {
    const headerText = document.querySelector(".header span")!;
    headerText.dispatchEvent(
      pointer("pointerdown", { button: 0, pointerId: 7, screenX: 100, screenY: 200 }),
    );
    document.dispatchEvent(pointer("pointermove", { pointerId: 7, screenX: 102, screenY: 201 }));
    document.dispatchEvent(pointer("pointermove", { pointerId: 7, screenX: 110, screenY: 220 }));
    document.dispatchEvent(pointer("pointerup", { pointerId: 7 }));

    expect(fx.postMessage).toHaveBeenCalledWith(
      { type: "vtp-overlay", drag: "start", sx: 100, sy: 200 },
      HOST,
    );
    expect(fx.postMessage).toHaveBeenCalledWith(
      { type: "vtp-overlay", drag: "move", sx: 110, sy: 220 },
      HOST,
    );
    expect(fx.postMessage).toHaveBeenCalledWith(
      { type: "vtp-overlay", drag: "end", moved: true },
      HOST,
    );

    for (let i = 0; i < 2; i++) {
      headerText.dispatchEvent(
        pointer("pointerdown", { button: 0, pointerId: 8 + i, screenX: 40, screenY: 50 }),
      );
      document.dispatchEvent(pointer("pointerup", { pointerId: 8 + i }));
    }
    expect(fx.postMessage).toHaveBeenCalledWith({ type: "vtp-overlay", drag: "reset" }, HOST);
  });

  it("ignores non-primary and interactive-header pointer starts", () => {
    const before = fx.postMessage.mock.calls.length;
    document.querySelector(".header")!.appendChild(document.createElement("button"));
    document
      .querySelector(".header button")!
      .dispatchEvent(pointer("pointerdown", { button: 0, pointerId: 20 }));
    document
      .querySelector(".header span")!
      .dispatchEvent(pointer("pointerdown", { button: 2, pointerId: 21 }));
    expect(fx.postMessage.mock.calls.length).toBe(before);
  });

  it("exposes a deterministic unmount hook", () => {
    popupModule.unmountPopupForTest();
    popupModule.unmountPopupForTest();
    expect(fx.unmount).toHaveBeenCalledOnce();
  });
});

describe("embedded popup entry on a host whose origin can't be addressed", () => {
  it("posts to any origin rather than to an opaque one", async () => {
    // A fresh load: the entry reads the host origin from its URL while wiring itself up.
    vi.resetModules();
    history.replaceState(null, "", "?host=null");
    fx.postMessage.mockClear();
    const mod = await import("../src/popup/index.js");
    expect(fx.postMessage).toHaveBeenCalledWith({ type: "vtp-overlay", height: 540 }, "*");
    mod.unmountPopupForTest();
  });
});
