// In-page keyboard shortcuts for playback speed (default-on; toggled in the popup).
// Bare single keys by physical position (e.code, so they hold across layouts).
// The action keys default to A (decrease), D (increase) by S.speedStep (Shift
// doubles it), R (drop the manual change and re-take the saved speed by priority:
// channel > site > global > 100%), S (toggle the last speed ⇄ 1×) and X (hold for
// S.holdSpeed while pressed). All are remappable on the options page (S.keymap).
// Each editable preset can carry its own hotkey chord (S.presetKeys, e.g. ⇧1 by
// default); pressing it jumps to that preset speed. Preset chords may use
// modifiers; the bare action keys above never fire with Ctrl/Cmd/Alt (Shift is
// still allowed, to double the step).
// (Remembering a speed is done by hand from the popup's Remember buttons.)
// Ignored while typing in a field and on pages with no video. Speed changes go
// through setSpeed's `manual` flag, so a live stream at the live edge safely
// ignores them.
import { S } from "./state.js";
import { eventMatchesChord, parseChord, type KeyChord } from "../shared/keymap.js";
import { setSpeed, resetToSaved } from "./speed.js";
import { ctxValid } from "./platform/browser.js";
import { primaryVideo } from "./videos.js";
import { toggleOverlayPopup } from "./overlay/launcher.js";
import {
  canCycleViewerChat,
  cycleViewerChatMode,
  toggleViewer,
  viewerAnchorVideo,
  viewerFormat,
} from "./viewer.js";
import { listenerOptions } from "./lifecycle.js";

let cachedPresetKeys: (string | null)[] | null = null;
let cachedPresetChords: (KeyChord | null)[] = [];

function presetChords(): (KeyChord | null)[] {
  if (
    cachedPresetKeys &&
    cachedPresetKeys.length === S.presetKeys.length &&
    cachedPresetKeys.every((key, i) => key === S.presetKeys[i])
  ) {
    return cachedPresetChords;
  }
  cachedPresetKeys = [...S.presetKeys];
  cachedPresetChords = S.presetKeys.map((key) => parseChord(key));
  return cachedPresetChords;
}

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
    if (e.defaultPrevented) return;
    if (!S.keyboardEnabled || !ctxValid()) return;
    const { slower, faster, reset, toggle, hold, overlay, viewer, theater, chat } = S.keymap;
    const oneShotRepeat =
      e.repeat &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey &&
      (e.code === reset ||
        e.code === toggle ||
        e.code === overlay ||
        e.code === viewer ||
        e.code === theater ||
        e.code === chat);
    if (oneShotRepeat) return;
    // A preset whose assigned chord matches this exact event (may use modifiers).
    let preset: number | undefined;
    const chords = presetChords();
    for (let i = 0; i < chords.length; i++) {
      if (eventMatchesChord(chords[i], e)) {
        preset = S.presets[i];
        break;
      }
    }
    // Action keys are bare position keys (Shift only, to double the step) — never
    // with Ctrl/Cmd/Alt, so browser/site chords are left alone.
    const speedStepKey =
      !e.ctrlKey && !e.metaKey && !e.altKey && (e.code === slower || e.code === faster);
    const plainActionKey =
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey &&
      (e.code === reset ||
        e.code === toggle ||
        e.code === hold ||
        e.code === overlay ||
        e.code === viewer ||
        e.code === theater ||
        e.code === chat);
    const actionKey = !e.ctrlKey && !e.metaKey && !e.altKey && (speedStepKey || plainActionKey);
    if (preset === undefined && !actionKey) return;
    // composedPath()[0] pierces shadow DOM to the real target; deepActive() does the same for focus.
    const target = (typeof e.composedPath === "function" && e.composedPath()[0]) || e.target;
    if (typingIn(target) || typingIn(deepActive())) return;
    const viewerAction = e.code === viewer || e.code === theater;
    if (viewerAction && !S.viewerAutoEnabled) return;
    // A viewer rendered in a child frame would be clipped to that frame and its
    // controls misleadingly appear to cover the host page. Leave the site's key
    // untouched there; embedded players can still use native Picture-in-Picture.
    if (viewerAction && window.top !== window) return;
    if (!primaryVideo() && !viewerAnchorVideo() && !(viewerAction && viewerFormat())) return; // nothing to act on
    // The chat key acts only inside an open viewer on a chat-capable live page —
    // otherwise leave the site's own key (e.g. YouTube's C = captions) alone.
    // A preset chord on the same key still wins (dispatched below).
    if (e.code === chat && preset === undefined && !canCycleViewerChat()) return;

    e.preventDefault();
    if (preset !== undefined) {
      if (!e.repeat) setSpeed(preset, false, true);
      return;
    }
    if (e.code === overlay) {
      toggleOverlayPopup();
      return;
    }
    if (e.code === viewer) {
      toggleViewer("normal");
      return;
    }
    if (e.code === theater) {
      toggleViewer("theater");
      return;
    }
    if (e.code === chat) {
      cycleViewerChatMode();
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
  listenerOptions(true),
);

function releaseHold(): void {
  if (!S.holdActive) return;
  S.holdActive = false;
  setSpeed(S.holdPrev, false, true);
}

function releaseHoldOnWindowBlur(): void {
  setTimeout(() => {
    if (!document.hasFocus() || document.activeElement instanceof HTMLIFrameElement) releaseHold();
  }, 0);
}

// Releasing the hold key restores the speed it interrupted. Listens regardless
// of the typing guard so a release over a focused field still cleans up.
document.addEventListener(
  "keyup",
  (e) => {
    if (!S.holdActive || e.code !== S.keymap.hold) return;
    releaseHold();
  },
  listenerOptions(true),
);

window.addEventListener("blur", releaseHoldOnWindowBlur, listenerOptions(true));
document.addEventListener(
  "visibilitychange",
  () => {
    if (document.hidden) releaseHold();
  },
  listenerOptions(true),
);
