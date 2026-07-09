// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Isolate keyboard.ts from the heavy content stack — mock everything it calls so
// we test only the key handling (which action fires, and the guards).
const m = vi.hoisted(() => ({
  setSpeed: vi.fn(),
  resetToSaved: vi.fn(),
  toggleViewer: vi.fn(),
  hasVideo: true,
  viewerAnchor: null as HTMLElement | null,
  primaryCalls: 0,
  viewerFormat: null as string | null,
}));

vi.mock("../src/content/speed.js", () => ({ setSpeed: m.setSpeed, resetToSaved: m.resetToSaved }));
vi.mock("../src/content/videos.js", () => ({
  primaryVideo: () => {
    m.primaryCalls++;
    return m.hasVideo ? ({} as HTMLVideoElement) : null;
  },
}));
vi.mock("../src/content/platform/browser.js", () => ({ ctxValid: () => true }));
vi.mock("../src/content/viewer.js", () => ({
  VIEWER_LAYOUT_EVENT: "vtp-viewer-layout",
  toggleViewer: m.toggleViewer,
  exitViewer: vi.fn(),
  viewerFormat: () => m.viewerFormat,
  viewerAnchorVideo: () => m.viewerAnchor,
}));

import { S } from "../src/content/state.js";
import "../src/content/keyboard.js"; // registers the keydown listener on import

function press(code: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true, ...init }),
  );
}

function release(code: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(
    new KeyboardEvent("keyup", { code, bubbles: true, cancelable: true, ...init }),
  );
}

describe("keyboard shortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    S.keyboardEnabled = true;
    S.viewerAutoEnabled = true;
    S.currentSpeed = 1.0;
    S.holdActive = false;
    S.holdPrev = 1.0;
    m.hasVideo = true;
    m.viewerAnchor = null;
    m.primaryCalls = 0;
    m.viewerFormat = null;
    document.body.innerHTML = "";
  });

  it("D speeds up by 5% (manual)", () => {
    S.currentSpeed = 1.0;
    press("KeyD");
    expect(m.setSpeed).toHaveBeenCalledWith(expect.closeTo(1.05), false, true);
  });

  it("A slows down by 5% (manual)", () => {
    S.currentSpeed = 1.5;
    press("KeyA");
    expect(m.setSpeed).toHaveBeenCalledWith(expect.closeTo(1.45), false, true);
  });

  it("Shift+D speeds up by 10% (manual)", () => {
    S.currentSpeed = 1.0;
    press("KeyD", { shiftKey: true });
    expect(m.setSpeed).toHaveBeenCalledWith(expect.closeTo(1.1), false, true);
  });

  it("Shift+A slows down by 10% (manual)", () => {
    S.currentSpeed = 1.5;
    press("KeyA", { shiftKey: true });
    expect(m.setSpeed).toHaveBeenCalledWith(expect.closeTo(1.4), false, true);
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

    expect(m.setSpeed).toHaveBeenCalledWith(expect.closeTo(1.05), false, true);
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

  it("a preset's assigned chord jumps to that preset speed", () => {
    S.presets = [1.25, 2.0];
    S.presetKeys = ["S+Digit1", "KeyG"];
    press("KeyG");
    expect(m.setSpeed).toHaveBeenCalledWith(2.0, false, true);
    press("Digit1", { shiftKey: true });
    expect(m.setSpeed).toHaveBeenCalledWith(1.25, false, true);
  });

  it("lets a preset chord using a viewer key win over the viewer action", () => {
    S.presets = [1.25];
    S.presetKeys = ["S+KeyV"];
    press("KeyV", { shiftKey: true });
    expect(m.setSpeed).toHaveBeenCalledWith(1.25, false, true);
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
      expect(m.setSpeed).toHaveBeenCalledWith(2, false, true);
      window.dispatchEvent(new Event("blur"));
      await vi.advanceTimersByTimeAsync(0);
      expect(S.holdActive).toBe(false);
      expect(m.setSpeed).toHaveBeenLastCalledWith(1.25, false, true);
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
      expect(m.setSpeed).toHaveBeenLastCalledWith(2, false, true);
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
      expect(m.setSpeed).toHaveBeenLastCalledWith(1.25, false, true);
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
    expect(m.setSpeed).toHaveBeenLastCalledWith(1.25, false, true);
  });
});
