// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Isolate keyboard.ts from the heavy content stack — mock everything it calls so
// we test only the key handling (which action fires, and the guards).
const m = vi.hoisted(() => ({
  setSpeed: vi.fn(),
  resetToSaved: vi.fn(),
  toggleViewer: vi.fn(),
  hasVideo: true,
  viewerAnchor: null as HTMLElement | null,
  video: null as HTMLVideoElement | null,
  notice: vi.fn(),
  primaryCalls: 0,
  viewerFormat: null as string | null,
  canCycleChat: false,
  cycleChat: vi.fn(),
  toggleOverlay: vi.fn(),
}));

vi.mock("../src/content/speed.js", () => ({ setSpeed: m.setSpeed, resetToSaved: m.resetToSaved }));
vi.mock("../src/content/videos.js", () => ({
  primaryVideo: () => {
    m.primaryCalls++;
    return m.hasVideo ? (m.video ?? ({} as HTMLVideoElement)) : null;
  },
}));
vi.mock("../src/content/platform/browser.js", () => ({ ctxValid: () => true }));
vi.mock("../src/content/viewer.js", () => ({
  VIEWER_LAYOUT_EVENT: "vtp-viewer-layout",
  VIEWER_RAISE_EVENT: "vtp-viewer-raise",
  toggleViewer: m.toggleViewer,
  exitViewer: vi.fn(),
  viewerFormat: () => m.viewerFormat,
  viewerAnchorVideo: () => m.viewerAnchor,
  canCycleViewerChat: () => m.canCycleChat,
  cycleViewerChatMode: m.cycleChat,
}));
vi.mock("../src/content/badge/overlay.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  showBadgeNotice: m.notice,
}));
vi.mock("../src/content/overlay/launcher.js", () => ({ toggleOverlayPopup: m.toggleOverlay }));

import { S } from "../src/content/state.js";
import "../src/content/keyboard.js"; // registers the keydown listener on import

function press(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(e);
  return e;
}

function release(code: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(
    new KeyboardEvent("keyup", { code, bubbles: true, cancelable: true, ...init }),
  );
}

function seekable(currentTime: number, start: number, end: number): HTMLVideoElement {
  return {
    currentTime,
    seekable: { length: 1, start: () => start, end: () => end },
  } as unknown as HTMLVideoElement;
}

describe("keyboard shortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    S.siteDisabled = false;
    S.keyboardEnabled = true;
    S.viewerAutoEnabled = true;
    S.currentSpeed = 1.0;
    S.holdActive = false;
    S.holdPrev = 1.0;
    m.hasVideo = true;
    m.viewerAnchor = null;
    m.video = null;
    S.seekStep = 10;
    m.primaryCalls = 0;
    m.viewerFormat = null;
    m.canCycleChat = false;
    document.body.innerHTML = "";
  });

  it("C cycles the chat mode only when the viewer can act on it", () => {
    press("KeyC");
    expect(m.cycleChat).not.toHaveBeenCalled();
    m.canCycleChat = true;
    press("KeyC");
    expect(m.cycleChat).toHaveBeenCalledTimes(1);
  });

  it("a preset chord on the chat key still fires when chat cannot act", () => {
    S.presets = [1.75];
    S.presetKeys = ["KeyC"];
    m.canCycleChat = false;
    press("KeyC");
    expect(m.setSpeed).toHaveBeenCalledWith(1.75, true);
    expect(m.cycleChat).not.toHaveBeenCalled();
  });

  it("D speeds up by 5% (manual)", () => {
    S.currentSpeed = 1.0;
    press("KeyD");
    expect(m.setSpeed).toHaveBeenCalledWith(expect.closeTo(1.05), true);
  });

  it("A slows down by 5% (manual)", () => {
    S.currentSpeed = 1.5;
    press("KeyA");
    expect(m.setSpeed).toHaveBeenCalledWith(expect.closeTo(1.45), true);
  });

  it("Shift+D speeds up by 10% (manual)", () => {
    S.currentSpeed = 1.0;
    press("KeyD", { shiftKey: true });
    expect(m.setSpeed).toHaveBeenCalledWith(expect.closeTo(1.1), true);
  });

  it("Shift+A slows down by 10% (manual)", () => {
    S.currentSpeed = 1.5;
    press("KeyA", { shiftKey: true });
    expect(m.setSpeed).toHaveBeenCalledWith(expect.closeTo(1.4), true);
  });

  it("R reverts the manual change to the saved speed (deletes nothing)", () => {
    press("KeyR");
    expect(m.resetToSaved).toHaveBeenCalled();
    expect(m.setSpeed).not.toHaveBeenCalled();
  });

  it("does nothing while the shortcuts are disabled", () => {
    S.keyboardEnabled = false;
    press("KeyD");
    expect(m.setSpeed).not.toHaveBeenCalled();
  });

  it("does nothing on a blacklisted site — no speed, viewer or overlay key", () => {
    S.siteDisabled = true;
    for (const code of ["KeyD", "KeyA", "KeyR", "KeyS", "KeyX", "KeyV", "KeyT", "KeyO"]) {
      press(code);
    }
    S.presets = [1.75];
    S.presetKeys = ["KeyG"];
    press("KeyG");
    expect(m.setSpeed).not.toHaveBeenCalled();
    expect(m.resetToSaved).not.toHaveBeenCalled();
    expect(m.toggleViewer).not.toHaveBeenCalled();
    expect(m.primaryCalls).toBe(0);
    expect(m.toggleOverlay).not.toHaveBeenCalled();
  });

  it("ignores keys combined with Ctrl / Cmd / Alt", () => {
    press("KeyD", { ctrlKey: true });
    press("KeyD", { metaKey: true });
    press("KeyD", { altKey: true });
    expect(m.setSpeed).not.toHaveBeenCalled();
  });

  it("ignores unrelated keys (S and Z are no longer shortcuts)", () => {
    press("KeyS");
    press("Space");
    press("KeyZ");
    press("KeyZ", { shiftKey: true });
    expect(m.setSpeed).not.toHaveBeenCalled();
  });

  it("ignores shortcuts while typing in a field", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyD", bubbles: true, cancelable: true }),
    );
    expect(m.setSpeed).not.toHaveBeenCalled();
    expect(m.primaryCalls).toBe(0);
  });

  it("does not look for video on repeated one-shot actions", () => {
    press("KeyV", { repeat: true });
    expect(m.toggleViewer).not.toHaveBeenCalled();
    expect(m.primaryCalls).toBe(0);
  });

  it("does nothing when there's no video to act on", () => {
    m.hasVideo = false;
    press("KeyD");
    expect(m.setSpeed).not.toHaveBeenCalled();
  });

  it("keeps speed shortcuts alive for an adopted viewer video", () => {
    m.hasVideo = false;
    m.viewerAnchor = document.createElement("video");

    press("KeyD");

    expect(m.setSpeed).toHaveBeenCalledWith(expect.closeTo(1.05), true);
  });

  it("V pops the video out in the normal format", () => {
    press("KeyV");
    expect(m.toggleViewer).toHaveBeenCalledWith("normal");
  });

  it("T pops the video out in the theater format", () => {
    press("KeyT");
    expect(m.toggleViewer).toHaveBeenCalledWith("theater");
  });

  it("does not repeat one-shot viewer actions while the key is held", () => {
    press("KeyV");
    press("KeyV", { repeat: true });
    press("KeyT", { repeat: true });
    expect(m.toggleViewer).toHaveBeenCalledTimes(1);
    expect(m.toggleViewer).toHaveBeenCalledWith("normal");
  });

  it("viewer keys are ignored without a video", () => {
    m.hasVideo = false;
    press("KeyV");
    press("KeyT");
    expect(m.toggleViewer).not.toHaveBeenCalled();
  });

  it("viewer keys are ignored when viewer modes are disabled", () => {
    S.viewerAutoEnabled = false;
    press("KeyV");
    press("KeyT");
    expect(m.toggleViewer).not.toHaveBeenCalled();
  });

  it("O toggles the overlay popup", () => {
    press("KeyO");
    expect(m.toggleOverlay).toHaveBeenCalledTimes(1);
  });

  describe("inside an embedded frame", () => {
    const realTop = Object.getOwnPropertyDescriptor(window, "top");
    beforeEach(() => {
      Object.defineProperty(window, "top", { value: {}, configurable: true });
    });
    afterEach(() => {
      if (realTop) Object.defineProperty(window, "top", realTop);
    });

    it("leaves the overlay key to the page", () => {
      const e = new KeyboardEvent("keydown", { code: "KeyO", bubbles: true, cancelable: true });
      document.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
      expect(m.toggleOverlay).not.toHaveBeenCalled();
    });

    it("still applies a preset chord on the overlay key", () => {
      S.presets = [1.25];
      S.presetKeys = ["S+KeyO"];
      press("KeyO", { shiftKey: true });
      expect(m.setSpeed).toHaveBeenCalledWith(1.25, true);
    });

    it("leaves the viewer keys to the page", () => {
      S.presetKeys = [];
      for (const code of ["KeyV", "KeyT"]) expect(press(code).defaultPrevented).toBe(false);
      expect(m.toggleViewer).not.toHaveBeenCalled();
    });

    it("keeps the speed keys working for the embedded player", () => {
      S.presetKeys = [];
      press("KeyD");
      expect(m.setSpeed).toHaveBeenCalledWith(expect.closeTo(1.05), true);
    });
  });

  it("a preset's assigned chord jumps to that preset speed", () => {
    S.presets = [1.25, 2.0];
    S.presetKeys = ["S+Digit1", "KeyG"];
    press("KeyG");
    expect(m.setSpeed).toHaveBeenCalledWith(2.0, true);
    press("Digit1", { shiftKey: true });
    expect(m.setSpeed).toHaveBeenCalledWith(1.25, true);
  });

  it("lets a preset chord using a viewer key win over the viewer action", () => {
    S.presets = [1.25];
    S.presetKeys = ["S+KeyV"];
    press("KeyV", { shiftKey: true });
    expect(m.setSpeed).toHaveBeenCalledWith(1.25, true);
    expect(m.toggleViewer).not.toHaveBeenCalled();
  });

  it("ignores a preset chord whose modifiers don't match exactly", () => {
    S.presets = [1.25, 2.0];
    S.presetKeys = ["S+Digit1", "KeyG"];
    press("Digit1"); // no Shift — the spec needs it
    press("KeyG", { ctrlKey: true }); // extra Ctrl — spec is bare
    expect(m.setSpeed).not.toHaveBeenCalled();
  });

  it("restores hold-to-speed on window blur if keyup is lost", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(document, "hasFocus").mockReturnValue(false);
      S.currentSpeed = 1.25;
      S.holdSpeed = 2;
      press("KeyX");
      expect(S.holdActive).toBe(true);
      expect(m.setSpeed).toHaveBeenCalledWith(2, true);
      window.dispatchEvent(new Event("blur"));
      await vi.advanceTimersByTimeAsync(0);
      expect(S.holdActive).toBe(false);
      expect(m.setSpeed).toHaveBeenLastCalledWith(1.25, true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not release hold-to-speed for focus changes inside the page", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
      S.currentSpeed = 1.25;
      S.holdSpeed = 2;
      press("KeyX");
      window.dispatchEvent(new Event("blur"));
      await vi.advanceTimersByTimeAsync(0);
      expect(S.holdActive).toBe(true);
      expect(m.setSpeed).toHaveBeenLastCalledWith(2, true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores hold-to-speed when focus moves into an iframe", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
      const iframe = document.createElement("iframe");
      document.body.append(iframe);
      Object.defineProperty(document, "activeElement", { value: iframe, configurable: true });
      S.currentSpeed = 1.25;
      S.holdSpeed = 2;
      press("KeyX");
      window.dispatchEvent(new Event("blur"));
      await vi.advanceTimersByTimeAsync(0);
      expect(S.holdActive).toBe(false);
      expect(m.setSpeed).toHaveBeenLastCalledWith(1.25, true);
    } finally {
      Object.defineProperty(document, "activeElement", {
        value: document.body,
        configurable: true,
      });
      vi.useRealTimers();
    }
  });

  it("restores hold-to-speed on keyup", () => {
    S.currentSpeed = 1.25;
    press("KeyX");
    release("KeyX");
    expect(S.holdActive).toBe(false);
    expect(m.setSpeed).toHaveBeenLastCalledWith(1.25, true);
  });

  describe("guards and edge cases", () => {
    const key = (code: string, init: KeyboardEventInit = {}) =>
      new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true, ...init });
    const focus = (el: Element | null) =>
      Object.defineProperty(document, "activeElement", { value: el, configurable: true });

    beforeEach(() => {
      S.presets = [];
      S.presetKeys = [];
      S.toggleMemory = null;
      S.holdSpeed = 2;
    });
    afterEach(() => {
      Reflect.deleteProperty(document, "activeElement");
    });

    it("swallows the key it handles so the page doesn't act on it too", () => {
      expect(press("KeyD").defaultPrevented).toBe(true);
    });

    it("leaves unbound keys and Shift+one-shot keys to the page", () => {
      const cases: [string, KeyboardEventInit][] = [
        ["KeyZ", {}],
        ["KeyZ", { shiftKey: true }],
        ["KeyR", { shiftKey: true }],
        ["KeyO", { shiftKey: true }],
      ];
      for (const [code, init] of cases) expect(press(code, init).defaultPrevented).toBe(false);
      expect(m.primaryCalls).toBe(0);
      expect(m.resetToSaved).not.toHaveBeenCalled();
      expect(m.toggleOverlay).not.toHaveBeenCalled();
    });

    it("never fires an unbound action for a key event without a code", () => {
      const saved = S.keymap;
      S.keymap = { ...saved, reset: "", overlay: "" };
      try {
        expect(press("").defaultPrevented).toBe(false);
      } finally {
        S.keymap = saved;
      }
      expect(m.toggleOverlay).not.toHaveBeenCalled();
      expect(m.resetToSaved).not.toHaveBeenCalled();
    });

    it("ignores a key the page already handled (defaultPrevented)", () => {
      const block = (e: Event) => e.preventDefault();
      window.addEventListener("keydown", block, true);
      try {
        press("KeyD");
      } finally {
        window.removeEventListener("keydown", block, true);
      }
      expect(m.setSpeed).not.toHaveBeenCalled();
      expect(m.primaryCalls).toBe(0);
    });

    it("still sees keys a page handler stops from propagating", () => {
      const el = document.createElement("div");
      document.body.append(el);
      const stop = (e: Event) => e.stopPropagation();
      el.addEventListener("keydown", stop);
      el.addEventListener("keyup", stop);
      el.dispatchEvent(key("KeyD"));
      expect(m.setSpeed).toHaveBeenCalledWith(expect.closeTo(1.05), true);
      S.currentSpeed = 1.25;
      el.dispatchEvent(key("KeyX"));
      expect(S.holdActive).toBe(true);
      el.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyX", bubbles: true }));
      expect(S.holdActive).toBe(false);
      expect(m.setSpeed).toHaveBeenLastCalledWith(1.25, true);
    });

    it("keeps repeating speed steps while the key is held", () => {
      press("KeyD", { repeat: true });
      expect(m.setSpeed).toHaveBeenCalledWith(expect.closeTo(1.05), true);
    });

    it("ignores auto-repeat of every one-shot action key", () => {
      m.canCycleChat = true;
      S.currentSpeed = 1.5;
      for (const code of ["KeyR", "KeyS", "KeyO", "KeyV", "KeyT", "KeyC"]) {
        press(code, { repeat: true });
      }
      expect(m.resetToSaved).not.toHaveBeenCalled();
      expect(m.setSpeed).not.toHaveBeenCalled();
      expect(m.toggleOverlay).not.toHaveBeenCalled();
      expect(m.toggleViewer).not.toHaveBeenCalled();
      expect(m.cycleChat).not.toHaveBeenCalled();
      expect(m.primaryCalls).toBe(0);
    });

    it("swallows but does not re-apply an auto-repeated preset chord", () => {
      S.presets = [1.75];
      S.presetKeys = ["KeyG"];
      expect(press("KeyG", { repeat: true }).defaultPrevented).toBe(true);
      expect(m.setSpeed).not.toHaveBeenCalled();
    });

    it("picks up re-assigned preset keys immediately", () => {
      S.presets = [1.25];
      S.presetKeys = ["KeyG"];
      press("KeyG");
      expect(m.setSpeed).toHaveBeenCalledTimes(1);
      S.presetKeys = ["KeyH"]; // same length, every key changed
      press("KeyG");
      expect(m.setSpeed).toHaveBeenCalledTimes(1);
      press("KeyH");
      expect(m.setSpeed).toHaveBeenCalledTimes(2);

      S.presets = [1.25, 2];
      S.presetKeys = ["KeyH", "KeyJ"]; // a preset added
      press("KeyJ");
      expect(m.setSpeed).toHaveBeenLastCalledWith(2, true);

      S.presetKeys = ["KeyH", "KeyK"]; // only the second key changed
      press("KeyJ");
      expect(m.setSpeed).toHaveBeenCalledTimes(3);
      press("KeyK");
      expect(m.setSpeed).toHaveBeenCalledTimes(4);
      expect(m.setSpeed).toHaveBeenLastCalledWith(2, true);
    });

    it("S drops to 1× and a second S restores the remembered speed", () => {
      S.currentSpeed = 1.5;
      press("KeyS");
      expect(m.setSpeed).toHaveBeenLastCalledWith(1, true);
      S.currentSpeed = 1; // what setSpeed would have applied
      press("KeyS");
      expect(m.setSpeed).toHaveBeenLastCalledWith(1.5, true);
      expect(m.setSpeed).toHaveBeenCalledTimes(2);
    });

    it("viewer keys still act on an open viewer when no video is found", () => {
      m.hasVideo = false;
      m.viewerFormat = "normal";
      press("KeyV");
      expect(m.toggleViewer).toHaveBeenCalledWith("normal");
    });

    it("ignores shortcuts typed into a textarea, select or contenteditable", () => {
      const editable = document.createElement("div");
      Object.defineProperty(editable, "isContentEditable", { value: true });
      for (const el of [
        document.createElement("textarea"),
        document.createElement("select"),
        editable,
      ]) {
        document.body.append(el);
        el.dispatchEvent(key("KeyD"));
      }
      expect(m.setSpeed).not.toHaveBeenCalled();
    });

    it("ignores shortcuts while a field has focus, even if the event targets the document", () => {
      const input = document.createElement("input");
      document.body.append(input);
      focus(input);
      press("KeyD");
      expect(m.setSpeed).not.toHaveBeenCalled();
      expect(m.primaryCalls).toBe(0);
    });

    it("finds a focused field inside an open shadow root", () => {
      const host = document.createElement("div");
      document.body.append(host);
      const shadow = host.attachShadow({ mode: "open" });
      const input = document.createElement("input");
      shadow.append(input);
      Object.defineProperty(shadow, "activeElement", { value: input, configurable: true });
      focus(host);
      press("KeyD");
      expect(m.setSpeed).not.toHaveBeenCalled();
    });

    it("recognises typing in a shadow-DOM field from the composed path", () => {
      const host = document.createElement("div");
      document.body.append(host);
      const input = document.createElement("input");
      host.attachShadow({ mode: "open" }).append(input);
      input.dispatchEvent(key("KeyD", { composed: true }));
      expect(m.setSpeed).not.toHaveBeenCalled();
    });

    it("acts when nothing has focus", () => {
      focus(null);
      press("KeyD");
      expect(m.setSpeed).toHaveBeenCalledWith(expect.closeTo(1.05), true);
    });

    it("ignores hold-key auto-repeat so release restores the pre-hold speed", () => {
      S.currentSpeed = 1.25;
      press("KeyX");
      S.currentSpeed = 2; // what setSpeed would have applied
      press("KeyX", { repeat: true });
      release("KeyX");
      expect(m.setSpeed.mock.calls).toEqual([
        [2, true],
        [1.25, true],
      ]);
    });

    it("keeps the hold key's auto-repeat from reaching the page", () => {
      press("KeyX");
      expect(press("KeyX", { repeat: true }).defaultPrevented).toBe(true);
    });

    it("another key's release does not end the hold", () => {
      press("KeyX");
      release("KeyD");
      expect(S.holdActive).toBe(true);
      expect(m.setSpeed).toHaveBeenCalledTimes(1);
    });

    it("a window blur without an active hold changes nothing", async () => {
      vi.useFakeTimers();
      const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
      try {
        window.dispatchEvent(new Event("blur"));
        await vi.advanceTimersByTimeAsync(0);
        expect(m.setSpeed).not.toHaveBeenCalled();
      } finally {
        hasFocus.mockRestore();
        vi.useRealTimers();
      }
    });

    it("releases the hold when the tab is hidden, not when it becomes visible", () => {
      try {
        S.currentSpeed = 1.25;
        press("KeyX");
        Object.defineProperty(document, "hidden", { value: false, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(S.holdActive).toBe(true);
        Object.defineProperty(document, "hidden", { value: true, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        expect(S.holdActive).toBe(false);
        expect(m.setSpeed).toHaveBeenLastCalledWith(1.25, true);
      } finally {
        Reflect.deleteProperty(document, "hidden");
      }
    });
  });

  it("E / Q jump forward / back by the seek step and show the jump", () => {
    m.video = seekable(100, 0, 600);
    press("KeyE");
    expect(m.video.currentTime).toBe(110);
    expect(m.notice).toHaveBeenLastCalledWith("+0:10", { video: m.video });
    press("KeyQ");
    press("KeyQ", { repeat: true });
    expect(m.video.currentTime).toBe(90);
    expect(m.notice).toHaveBeenLastCalledWith("-0:10", { video: m.video });
    expect(m.setSpeed).not.toHaveBeenCalled();
  });

  it("Shift doubles the seek step", () => {
    m.video = seekable(100, 0, 600);
    press("KeyE", { shiftKey: true });
    expect(m.video.currentTime).toBe(120);
  });

  it("clamps a jump to the seekable range and skips a no-op jump", () => {
    m.video = seekable(5, 0, 600);
    press("KeyQ");
    expect(m.video.currentTime).toBe(0);
    m.notice.mockClear();
    press("KeyQ");
    expect(m.video.currentTime).toBe(0);
    expect(m.notice).not.toHaveBeenCalled();
    m.video.currentTime = 595;
    press("KeyE");
    expect(m.video.currentTime).toBe(600);
  });

  it("leaves a video with nothing seekable alone", () => {
    m.video = {
      currentTime: 42,
      seekable: { length: 0, start: () => 0, end: () => 0 },
    } as unknown as HTMLVideoElement;
    press("KeyE");
    expect(m.video.currentTime).toBe(42);
    expect(m.notice).not.toHaveBeenCalled();
  });

  it("seeks the adopted viewer video when no page video is tracked", () => {
    m.hasVideo = false;
    const video = document.createElement("video");
    Object.defineProperty(video, "seekable", {
      value: { length: 1, start: () => 0, end: () => 600 },
    });
    m.viewerAnchor = video;
    press("KeyE");
    expect(video.currentTime).toBe(10);
  });
});
