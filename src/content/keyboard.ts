// In-page keyboard shortcuts for playback speed (default-on; toggled in the popup).
// Bare single keys by physical position (e.code, so they hold across layouts):
//   A — decrease, D — increase by 5% (Shift makes it 10%),  R — drop the manual
//   change and re-take the saved speed by priority (channel > site > global > 100%).
//   Shift+1 … Shift+8 — jump to a preset speed (Shift avoids the digit shortcuts
//   players like YouTube bind to bare 1-9).
// (Remembering a speed is done by hand from the popup's Remember buttons.)
// Ignored while typing in a field, while Ctrl/Cmd/Alt is held, and on pages with
// no video. Speed changes go through setSpeed's `manual` flag, so a live stream
// at the live edge safely ignores them.
import { S } from "./state.js";
import { setSpeed, resetToSaved } from "./speed.js";
import { ctxValid } from "./platform/browser.js";
import { primaryVideo } from "./videos.js";

const STEP = 0.05;       // A / D
const BIG_STEP = 0.10;   // Shift+A / Shift+D
// Shift+1 … Shift+8, in order — the same eight values as the popup's sorted
// preset grid (src/popup/popup.html). Keep the two lists in sync.
const PRESET_SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5];

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
  // Shift+1 … Shift+8 → a preset speed; undefined for any other digit / no Shift.
  const preset = e.shiftKey && e.code.startsWith("Digit") ? PRESET_SPEEDS[Number(e.code.slice(5)) - 1] : undefined;
  if (e.code !== "KeyA" && e.code !== "KeyD" && e.code !== "KeyR" && preset === undefined) return;
  // composedPath()[0] pierces shadow DOM to the real target; deepActive() does the same for focus.
  const target = (typeof e.composedPath === "function" && e.composedPath()[0]) || e.target;
  if (typingIn(target) || typingIn(deepActive())) return;
  if (!primaryVideo()) return;   // nothing to act on — leave the key to the page

  e.preventDefault();
  if (preset !== undefined) { setSpeed(preset, false, true); return; }
  const step = e.shiftKey ? BIG_STEP : STEP;
  if (e.code === "KeyD") setSpeed(S.currentSpeed + step, false, true);
  else if (e.code === "KeyA") setSpeed(S.currentSpeed - step, false, true);
  else if (e.code === "KeyR") resetToSaved();
}, true);
