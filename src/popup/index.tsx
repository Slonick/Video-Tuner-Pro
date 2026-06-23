// Popup entry. Apply the theme, then — once the selective-sync config has loaded
// and the saved language is applied — render the React app (so msg() returns text
// in the chosen language during the first render).
import { createRoot } from "react-dom/client";
import { whenReady } from "./platform/storage.js";
import { loadLang } from "./i18n.js";
import { initTheme } from "../shared/theme.js";
import { App } from "./components/App.js";

// When the popup is embedded as an in-page overlay (the on-video launcher loads
// popup.html in an iframe), report its content height to the host so the iframe
// grows like the real toolbar popup, and forward Escape so the host can close it.
// No-op in the real popup, which has no parent frame.
function wireEmbeddedOverlay(): void {
  if (window.parent === window) return;
  // Lets the stylesheet drop the popup's opaque base background so the launcher's
  // frosted-glass panel shows through (the toolbar popup keeps its solid --bg).
  document.documentElement.classList.add("vtp-embedded");
  const post = (data: Record<string, unknown>) =>
    window.parent.postMessage({ type: "vtp-overlay", ...data }, "*");
  const report = () => post({ height: document.documentElement.scrollHeight });
  new ResizeObserver(report).observe(document.documentElement);
  report();
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") post({ close: true });
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

initTheme();
whenReady(() => {
  loadLang(() => {
    createRoot(document.getElementById("root")!).render(<App />);
    wireEmbeddedOverlay();
  });
});
