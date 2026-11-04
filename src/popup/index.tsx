// Popup entry. Once the selective-sync config has loaded (so the theme and language
// are read from the area they're routed to), apply the theme and the saved language,
// then render the React app (so msg() returns text in the chosen language during
// the first render).
import { createRoot, type Root } from "react-dom/client";
import { whenReady } from "./platform/storage.js";
import { loadLang } from "./i18n.js";
import { initTheme } from "../shared/theme.js";
import { App } from "./components/App.js";

let root: Root | null = null;

export function unmountPopupForTest(): void {
  root?.unmount();
  root = null;
}

// When the popup is embedded as an in-page overlay (the on-video launcher loads
// popup.html in an iframe), report its content height to the host so the iframe
// grows like the real toolbar popup, and forward Escape so the host can close it.
// No-op in the real popup, which has no parent frame.
function wireEmbeddedOverlay(): void {
  if (window.parent === window) return;
  // Lets the stylesheet drop the popup's opaque base background so the launcher's
  // frosted-glass panel shows through (the toolbar popup keeps its solid --bg).
  document.documentElement.classList.add("vtp-embedded");
  // Address the host page only. The launcher passes its origin; an opaque or file:
  // origin, which no targetOrigin can name, falls back to "*".
  const host = new URLSearchParams(location.search).get("host");
  const target = host && /^https?:\/\/[^/]+$/.test(host) ? host : "*";
  const post = (data: Record<string, unknown>) =>
    window.parent.postMessage({ type: "vtp-overlay", ...data }, target);
  // scrollHeight never drops below the iframe's own height, so the panel could not
  // shrink for the short "disabled on this site" view; the rect tracks the content.
  const report = () =>
    post({ height: Math.ceil(document.documentElement.getBoundingClientRect().height) });
  new ResizeObserver(report).observe(document.documentElement);
  report();
  document.addEventListener("keydown", (e) => {
    // A menu or tooltip that took this Escape closes itself, not the whole overlay.
    if (e.key === "Escape" && !e.defaultPrevented) post({ close: true });
  });
  // Drag the panel by its header. The gesture starts inside this iframe, so we own
  // it here: setPointerCapture keeps the moves coming even when the cursor leaves
  // the iframe, and we post the gesture to the host, which repositions the panel.
  // Screen coords cross the frame boundary unchanged, so the host needs no scale
  // math. A <4px slop keeps a click from counting as a drag; two no-move clicks
  // within 350ms recentre the panel. Clicks on the gear / Ko-fi controls are left
  // alone.
  const headerHandle = (t: EventTarget | null): HTMLElement | null =>
    t instanceof Element && t.closest(".header") && !t.closest("button, a")
      ? (t.closest(".header") as HTMLElement)
      : null;
  let dragId: number | null = null;
  let startSX = 0,
    startSY = 0,
    dragMoved = false,
    lastClick = 0;
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const handle = headerHandle(e.target);
    if (!handle) return;
    e.preventDefault(); // no text selection / native iframe drag
    dragId = e.pointerId;
    startSX = e.screenX;
    startSY = e.screenY;
    dragMoved = false;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch (x) {
      /* ignore */
    }
    post({ drag: "start", sx: e.screenX, sy: e.screenY });
  });
  document.addEventListener("pointermove", (e) => {
    if (e.pointerId !== dragId) return;
    if (!dragMoved && Math.hypot(e.screenX - startSX, e.screenY - startSY) < 4) return;
    dragMoved = true;
    post({ drag: "move", sx: e.screenX, sy: e.screenY });
  });
  const endDrag = (e: PointerEvent) => {
    if (e.pointerId !== dragId) return;
    dragId = null;
    if (dragMoved) {
      post({ drag: "end", moved: true });
      lastClick = 0;
      return;
    }
    // A press with no move is a click; two within 350ms = double-click → recentre.
    post({ drag: "end", moved: false });
    const now = Date.now();
    if (now - lastClick < 350) {
      lastClick = 0;
      post({ drag: "reset" });
    } else {
      lastClick = now;
    }
  };
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);
}

whenReady(() => {
  initTheme();
  loadLang(() => {
    root = createRoot(document.getElementById("root")!);
    root.render(<App />);
    wireEmbeddedOverlay();
  });
});
