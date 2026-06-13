// In-page keyboard shortcuts for playback speed (default-on; toggled in the popup).
// Bare single keys by physical position (e.code, so they hold across layouts):
//   S / D — slower / faster,  R — reset to 100%,  Z — remember the current speed
//   for this site,  Shift+Z — remember it for the YouTube channel.
// Ignored while typing in a field, while Ctrl/Cmd/Alt is held, and on pages with
// no video. Speed changes (S/D/R) go through setSpeed's `manual` flag, so a live
// stream at the live edge safely ignores them.
import { S } from "./state.js";
import { setSpeed, persistDomainSpeed, persistChannelSpeed } from "./speed.js";
import { ctxValid } from "./platform/browser.js";
import { currentChannel } from "./channel.js";
import { primaryVideo } from "./videos.js";

const STEP = 0.05;

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
  if (e.code !== "KeyS" && e.code !== "KeyD" && e.code !== "KeyR" && e.code !== "KeyZ") return;
  // composedPath()[0] pierces shadow DOM to the real target; deepActive() does the same for focus.
  const target = (typeof e.composedPath === "function" && e.composedPath()[0]) || e.target;
  if (typingIn(target) || typingIn(deepActive())) return;
  if (!primaryVideo()) return;   // nothing to act on — leave the key to the page

  e.preventDefault();
  if (e.code === "KeyD") setSpeed(S.currentSpeed + STEP, false, true);
  else if (e.code === "KeyS") setSpeed(S.currentSpeed - STEP, false, true);
  else if (e.code === "KeyR") setSpeed(1.0, false, true);
  else {
    // KeyZ — remember the current speed: Shift+Z for the channel, plain Z for the site.
    if (e.shiftKey) {
      if (!currentChannel()) return;   // not on a channel — nothing to save
      persistChannelSpeed(S.currentSpeed);
    } else {
      persistDomainSpeed(S.currentSpeed);
    }
  }
}, true);
