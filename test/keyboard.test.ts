// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Isolate keyboard.ts from the heavy content stack — mock everything it calls so
// we test only the key handling (which action fires, and the guards).
const m = vi.hoisted(() => ({
  setSpeed: vi.fn(),
  resetToSaved: vi.fn(),
  hasVideo: true,
}));

vi.mock("../src/content/speed.js", () => ({ setSpeed: m.setSpeed, resetToSaved: m.resetToSaved }));
vi.mock("../src/content/videos.js", () => ({
  primaryVideo: () => (m.hasVideo ? ({} as HTMLVideoElement) : null),
}));
vi.mock("../src/content/platform/browser.js", () => ({ ctxValid: () => true }));

import { S } from "../src/content/state.js";
import "../src/content/keyboard.js"; // registers the keydown listener on import

function press(code: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true, ...init }),
  );
}

describe("keyboard shortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    S.keyboardEnabled = true;
    S.currentSpeed = 1.0;
    m.hasVideo = true;
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
  });

  it("does nothing when there's no video to act on", () => {
    m.hasVideo = false;
    press("KeyD");
    expect(m.setSpeed).not.toHaveBeenCalled();
  });

  it("a preset's assigned chord jumps to that preset speed", () => {
    S.presets = [1.25, 2.0];
    S.presetKeys = ["S+Digit1", "KeyG"];
    press("KeyG");
    expect(m.setSpeed).toHaveBeenCalledWith(2.0, false, true);
    press("Digit1", { shiftKey: true });
    expect(m.setSpeed).toHaveBeenCalledWith(1.25, false, true);
  });

  it("ignores a preset chord whose modifiers don't match exactly", () => {
    S.presets = [1.25, 2.0];
    S.presetKeys = ["S+Digit1", "KeyG"];
    press("Digit1"); // no Shift — the spec needs it
    press("KeyG", { ctrlKey: true }); // extra Ctrl — spec is bare
    expect(m.setSpeed).not.toHaveBeenCalled();
  });
});
