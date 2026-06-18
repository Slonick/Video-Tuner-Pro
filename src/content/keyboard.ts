// In-page keyboard shortcuts for playback speed (default-on; toggled in the popup).
// Bare single keys by physical position (e.code, so they hold across layouts).
// The three action keys default to A (decrease), D (increase) by 5% (Shift makes
// it 10%), R (drop the manual change and re-take the saved speed by priority:
// channel > site > global > 100%), and are remappable on the options page
// (S.keymap). Shift+1 … Shift+8 jump to a preset speed (Shift avoids the digit
// shortcuts players like YouTube bind to bare 1-9); the eight presets are the
// editable set shared with the popup grid (S.presets).
// (Remembering a speed is done by hand from the popup's Remember buttons.)
// Ignored while typing in a field, while Ctrl/Cmd/Alt is held, and on pages with
// no video. Speed changes go through setSpeed's `manual` flag, so a live stream
// at the live edge safely ignores them.
import { S } from "./state.js";
import { setSpeed, resetToSaved } from "./speed.js";
import { ctxValid } from "./platform/browser.js";
import { primaryVideo } from "./videos.js";

const STEP = 0.05; // slower / faster
const BIG_STEP = 0.1; // Shift + slower / faster

// The focused element, piercing open shadow roots — some sites host inputs there.
function deepActive(): Element | null {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}
function typingIn(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  if (!t || !t.tagName) return false;
  return (
    t.tagName === "INPUT" ||
    t.tagName === "TEXTAREA" ||
    t.tagName === "SELECT" ||
    t.isContentEditable === true
  );
}

document.addEventListener(
  "keydown",
  (e) => {
    if (!S.keyboardEnabled || !ctxValid()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const { slower, faster, reset } = S.keymap;
    // Shift+1 … Shift+8 → a preset speed; undefined for any other digit / no Shift.
    const preset =
      e.shiftKey && e.code.startsWith("Digit") ? S.presets[Number(e.code.slice(5)) - 1] : undefined;
    if (e.code !== slower && e.code !== faster && e.code !== reset && preset === undefined) return;
    // composedPath()[0] pierces shadow DOM to the real target; deepActive() does the same for focus.
    const target = (typeof e.composedPath === "function" && e.composedPath()[0]) || e.target;
    if (typingIn(target) || typingIn(deepActive())) return;
    if (!primaryVideo()) return; // nothing to act on — leave the key to the page

    e.preventDefault();
    if (preset !== undefined) {
      setSpeed(preset, false, true);
      return;
    }
    const step = e.shiftKey ? BIG_STEP : STEP;
    if (e.code === faster) setSpeed(S.currentSpeed + step, false, true);
    else if (e.code === slower) setSpeed(S.currentSpeed - step, false, true);
    else if (e.code === reset) resetToSaved();
  },
  true,
);
