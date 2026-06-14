// In-page keyboard shortcuts for playback speed (default-on; toggled in the popup).
// Bare single keys by physical position (e.code, so they hold across layouts):
//   A — decrease, D — increase by 5% (Shift makes it 10%),  R — reset to 100%.
// (Remembering a speed is done by hand from the popup's Remember buttons.)
// Ignored while typing in a field, while Ctrl/Cmd/Alt is held, and on pages with
// no video. Speed changes go through setSpeed's `manual` flag, so a live stream
// at the live edge safely ignores them.
import { S } from "./state.js";
import { setSpeed } from "./speed.js";
import { ctxValid } from "./platform/browser.js";
import { primaryVideo } from "./videos.js";

const STEP = 0.05;       // A / D
const BIG_STEP = 0.10;   // Shift+A / Shift+D

// The focused element, piercing open shadow roots — some sites host inputs there.
function deepActive(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}
function typingIn(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t || !t.tagName) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable === true;
}

document.addEventListener("keydown", (e) => {
  if (!S.keyboardEnabled || !ctxValid()) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code !== "KeyA" && e.code !== "KeyD" && e.code !== "KeyR") return;
  // composedPath()[0] pierces shadow DOM to the real target; deepActive() does the same for focus.
  const target = (typeof e.composedPath === "function" && e.composedPath()[0]) || e.target;
  if (typingIn(target) || typingIn(deepActive())) return;
  if (!primaryVideo()) return;   // nothing to act on — leave the key to the page

  e.preventDefault();
  const step = e.shiftKey ? BIG_STEP : STEP;
  if (e.code === "KeyD") setSpeed(S.currentSpeed + step, false, true);   // increase
  else if (e.code === "KeyA") setSpeed(S.currentSpeed - step, false, true);  // decrease
  else if (e.code === "KeyR") setSpeed(1.0, false, true);
}, true);
