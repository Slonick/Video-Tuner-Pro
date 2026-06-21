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
  // Drag the panel by its header: the host raises a capture layer that tracks the
  // pointer (the iframe would otherwise swallow the moves) and saves the spot per
  // site. Screen coords cross the frame boundary unchanged, so the host needs no
  // scale math. A double-click recentres it — but since the host's capture layer
  // eats the clicks, the host detects the double-click itself (two no-move presses);
  // we just forward the press. Clicks on the gear / Ko-fi controls are left alone.
  const inHeader = (t: EventTarget | null) =>
    t instanceof Element && t.closest(".header") && !t.closest("button, a");
  document.addEventListener("pointerdown", (e) => {
    if (e.button === 0 && inHeader(e.target)) {
      e.preventDefault(); // no text selection / iframe drag-capture
      post({ drag: "start", sx: e.screenX, sy: e.screenY });
    }
  });
}

initTheme();
whenReady(() => {
  loadLang(() => {
    createRoot(document.getElementById("root")!).render(<App />);
    wireEmbeddedOverlay();
  });
});
