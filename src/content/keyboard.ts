// In-page keyboard shortcuts for playback speed (default-on; toggled in the popup).
// Bare single keys by physical position (e.code, so they hold across layouts).
// The action keys default to A (decrease), D (increase) by S.speedStep (Shift
// doubles it), R (drop the manual change and re-take the saved speed by priority:
// channel > site > global > 100%), S (toggle the last speed ⇄ 1×) and F (hold for
// S.holdSpeed while pressed). All are remappable on the options page (S.keymap).
// Shift+1 … Shift+8 jump to a preset speed (Shift avoids the digit shortcuts
// players like YouTube bind to bare 1-9); the eight presets are the editable set
// shared with the popup grid (S.presets).
// (Remembering a speed is done by hand from the popup's Remember buttons.)
// Ignored while typing in a field, while Ctrl/Cmd/Alt is held, and on pages with
// no video. Speed changes go through setSpeed's `manual` flag, so a live stream
// at the live edge safely ignores them.
import { S } from "./state.js";
import { setSpeed, resetToSaved } from "./speed.js";
import { ctxValid } from "./platform/browser.js";
import { primaryVideo } from "./videos.js";

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
    const { slower, faster, reset, toggle, hold } = S.keymap;
    // Shift+1 … Shift+8 → a preset speed; undefined for any other digit / no Shift.
    const preset =
      e.shiftKey && e.code.startsWith("Digit") ? S.presets[Number(e.code.slice(5)) - 1] : undefined;
    if (
      e.code !== slower &&
      e.code !== faster &&
      e.code !== reset &&
      e.code !== toggle &&
      e.code !== hold &&
      preset === undefined
    )
      return;
    // composedPath()[0] pierces shadow DOM to the real target; deepActive() does the same for focus.
    const target = (typeof e.composedPath === "function" && e.composedPath()[0]) || e.target;
    if (typingIn(target) || typingIn(deepActive())) return;
    if (!primaryVideo()) return; // nothing to act on — leave the key to the page

    e.preventDefault();
    if (preset !== undefined) {
      setSpeed(preset, false, true);
      return;
    }
    if (e.code === hold) {
      // Ignore the auto-repeat keydowns while the key stays pressed.
      if (!S.holdActive) {
        S.holdActive = true;
        S.holdPrev = S.currentSpeed;
        setSpeed(S.holdSpeed, false, true);
      }
      return;
    }
    if (e.code === toggle) {
      // At 1× → restore the last remembered speed; otherwise remember and drop to 1×.
      if (Math.abs(S.currentSpeed - 1) < 1e-3) {
        if (S.toggleMemory != null) setSpeed(S.toggleMemory, false, true);
      } else {
        S.toggleMemory = S.currentSpeed;
        setSpeed(1, false, true);
      }
      return;
    }
    const step = e.shiftKey ? S.speedStep * 2 : S.speedStep;
    if (e.code === faster) setSpeed(S.currentSpeed + step, false, true);
    else if (e.code === slower) setSpeed(S.currentSpeed - step, false, true);
    else if (e.code === reset) resetToSaved();
  },
  true,
);

// Releasing the hold key restores the speed it interrupted. Listens regardless
// of the typing guard so a release over a focused field still cleans up.
document.addEventListener(
  "keyup",
  (e) => {
    if (!S.holdActive || e.code !== S.keymap.hold) return;
    S.holdActive = false;
    setSpeed(S.holdPrev, false, true);
  },
  true,
);
