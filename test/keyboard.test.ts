// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// Isolate keyboard.ts from the heavy content stack — mock everything it calls so
// we test only the key handling (which action fires, and the guards).
const m = vi.hoisted(() => ({
  setSpeed: vi.fn(),
  persistDomainSpeed: vi.fn(),
  persistChannelSpeed: vi.fn(),
  channel: null as string | null,
  hasVideo: true,
}));

vi.mock("../src/content/speed.js", () => ({
  setSpeed: m.setSpeed,
  persistDomainSpeed: m.persistDomainSpeed,
  persistChannelSpeed: m.persistChannelSpeed,
}));
vi.mock("../src/content/channel.js", () => ({ currentChannel: () => m.channel }));
vi.mock("../src/content/videos.js", () => ({ primaryVideo: () => (m.hasVideo ? ({} as HTMLVideoElement) : null) }));
vi.mock("../src/content/platform/browser.js", () => ({ ctxValid: () => true }));

import { S } from "../src/content/state.js";
import "../src/content/keyboard.js"; // registers the keydown listener on import

function press(code: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true, ...init }));
}

describe("keyboard shortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    S.keyboardEnabled = true;
    S.currentSpeed = 1.0;
    m.channel = null;
    m.hasVideo = true;
    document.body.innerHTML = "";
  });

  it("D speeds up by 5% (manual)", () => {
    S.currentSpeed = 1.0;
    press("KeyD");
    expect(m.setSpeed).toHaveBeenCalledWith(expect.closeTo(1.05), false, true);
  });

  it("S slows down by 5% (manual)", () => {
    S.currentSpeed = 1.5;
    press("KeyS");
    expect(m.setSpeed).toHaveBeenCalledWith(expect.closeTo(1.45), false, true);
  });

  it("R resets to 100%", () => {
    press("KeyR");
    expect(m.setSpeed).toHaveBeenCalledWith(1.0, false, true);
  });

  it("Z remembers the speed for the site", () => {
    S.currentSpeed = 1.25;
    press("KeyZ");
    expect(m.persistDomainSpeed).toHaveBeenCalledWith(1.25);
    expect(m.persistChannelSpeed).not.toHaveBeenCalled();
  });

  it("Shift+Z remembers the speed for the channel when on one", () => {
    m.channel = "@WGC098";
    S.currentSpeed = 1.25;
    press("KeyZ", { shiftKey: true });
    expect(m.persistChannelSpeed).toHaveBeenCalledWith(1.25);
    expect(m.persistDomainSpeed).not.toHaveBeenCalled();
  });

  it("Shift+Z is a no-op off a channel", () => {
    m.channel = null;
    press("KeyZ", { shiftKey: true });
    expect(m.persistChannelSpeed).not.toHaveBeenCalled();
    expect(m.persistDomainSpeed).not.toHaveBeenCalled();
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

  it("ignores unrelated keys", () => {
    press("KeyA");
    press("Space");
    expect(m.setSpeed).not.toHaveBeenCalled();
  });

  it("ignores shortcuts while typing in a field", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD", bubbles: true, cancelable: true }));
    expect(m.setSpeed).not.toHaveBeenCalled();
  });

  it("does nothing when there's no video to act on", () => {
    m.hasVideo = false;
    press("KeyD");
    expect(m.setSpeed).not.toHaveBeenCalled();
  });
});
