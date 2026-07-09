// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// speed.ts publishes the desired audio rate to the MAIN-world hook through the
// data-vtp-audiorate attribute on <html> — present (= currentSpeed) only while the
// "speed up audio" toggle is on, removed otherwise. Mock the video/live/audio/badge
// plumbing (as speed-persist does) so we exercise the real bridge writes.
vi.mock("../src/content/channel.js", () => ({ channelKeys: () => [] as string[] }));
vi.mock("../src/content/videos.js", () => ({
  collectVideos: () => [] as HTMLVideoElement[],
  collectAudios: () => [] as HTMLAudioElement[],
  primaryVideoFrom: () => null,
  seenVideos: new WeakSet(),
  seenAudios: new WeakSet(),
}));
vi.mock("../src/content/live/detection.js", () => ({
  isLive: () => false,
  probeLive: vi.fn(),
  onStreamPage: () => false,
  trackDvr: vi.fn(),
  resetDvrFor: vi.fn(),
}));
vi.mock("../src/content/live/sync.js", () => ({ controlLive: vi.fn() }));
vi.mock("../src/content/audio/compressor.js", () => ({ applyAudioComp: vi.fn() }));
vi.mock("../src/content/badge/icon.js", () => ({ updateBadge: vi.fn() }));
vi.mock("../src/content/badge/overlay.js", () => ({
  updateTimeBadge: vi.fn(),
  flashBadge: vi.fn(),
}));

import { S } from "../src/content/state.js";
import { STORE } from "../src/content/platform/storage.js";
import { applyAll, resetAudios, setSpeed } from "../src/content/speed.js";

const ATTR = "data-vtp-audiorate";
const attr = () => document.documentElement.getAttribute(ATTR);

beforeEach(() => {
  STORE.set({ domains: {}, channels: {} });
  document.documentElement.removeAttribute(ATTR);
  S.currentSpeed = 1.0;
  S.userSpeed = 1.0;
  S.audioSpeedEnabled = false;
});

describe("audio-rate bridge (isolated → MAIN world)", () => {
  it("publishes currentSpeed while the toggle is on", () => {
    S.audioSpeedEnabled = true;
    setSpeed(2);
    expect(attr()).toBe("2");
  });

  it("writes nothing while the toggle is off", () => {
    setSpeed(2);
    expect(attr()).toBeNull();
  });

  it("tracks later speed changes through applyAll", () => {
    S.audioSpeedEnabled = true;
    S.currentSpeed = 1.5;
    applyAll();
    expect(attr()).toBe("1.5");
    S.currentSpeed = 3;
    applyAll();
    expect(attr()).toBe("3");
  });

  it("clears the bridge when the toggle is turned off (resetAudios)", () => {
    S.audioSpeedEnabled = true;
    setSpeed(2);
    expect(attr()).toBe("2");

    S.audioSpeedEnabled = false;
    resetAudios();
    expect(attr()).toBeNull();
  });
});
