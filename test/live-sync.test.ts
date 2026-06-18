import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// controlLive is the SOLE writer of a live video's playbackRate. Mock the heavy
// content stack around it (speed/index/detection/metrics) but keep the real
// catchup math + state, then drive the dispatcher and assert the rate writes,
// the 250 ms throttle, and the anti-click re-assert window.
const h = vi.hoisted(() => ({
  ctxValid: vi.fn(() => true),
  applyAll: vi.fn(),
  teardown: vi.fn(),
  liveVideo: vi.fn(() => null as unknown),
  onStreamPage: vi.fn(() => false),
  forwardBuffer: vi.fn(() => 10),
  streamLatency: vi.fn(() => null as number | null),
}));
vi.mock("../src/content/platform/browser.js", () => ({ ctxValid: h.ctxValid }));
vi.mock("../src/content/speed.js", () => ({ applyAll: h.applyAll }));
vi.mock("../src/content/index.js", () => ({ teardown: h.teardown }));
vi.mock("../src/content/live/detection.js", () => ({
  liveVideo: h.liveVideo,
  onStreamPage: h.onStreamPage,
}));
vi.mock("../src/content/live/metrics.js", () => ({
  forwardBuffer: h.forwardBuffer,
  streamLatency: h.streamLatency,
}));

import { S } from "../src/content/state.js";
import { controlLive } from "../src/content/live/sync.js";

function fakeVideo(
  props: Partial<{ playbackRate: number; paused: boolean; preservesPitch: boolean }> = {},
) {
  return { playbackRate: 1.0, paused: false, preservesPitch: true, ...props } as HTMLVideoElement;
}

// Advance the clock far past any previous test's module-level timestamps so the
// throttle/re-assert windows always start fresh.
let T = 1_000_000;
beforeEach(() => {
  vi.useFakeTimers();
  T += 1_000_000;
  vi.setSystemTime(T);
  for (const k of [
    "ctxValid",
    "applyAll",
    "teardown",
    "liveVideo",
    "onStreamPage",
    "forwardBuffer",
    "streamLatency",
  ] as const)
    h[k].mockClear();
  h.ctxValid.mockReturnValue(true);
  h.liveVideo.mockReturnValue(null);
  h.onStreamPage.mockReturnValue(false);
  h.forwardBuffer.mockReturnValue(10);
  h.streamLatency.mockReturnValue(null);
  S.currentSpeed = 1.0;
  S.userSpeed = 1.0;
  S.liveSyncEnabled = false;
  S.liveSyncTarget = 5;
});
afterEach(() => vi.useRealTimers());

describe("controlLive dispatch", () => {
  it("tears down when the extension context is gone", () => {
    h.ctxValid.mockReturnValue(false);
    controlLive();
    expect(h.teardown).toHaveBeenCalled();
    expect(h.liveVideo).not.toHaveBeenCalled();
  });

  it("throttles to one run per 250 ms", () => {
    controlLive();
    expect(h.liveVideo).toHaveBeenCalledTimes(1);
    vi.setSystemTime(T + 100);
    controlLive();
    expect(h.liveVideo).toHaveBeenCalledTimes(1); // suppressed
    vi.setSystemTime(T + 300);
    controlLive();
    expect(h.liveVideo).toHaveBeenCalledTimes(2);
  });

  it("restores the user's non-live speed once a page proves not to be a stream", () => {
    S.currentSpeed = 1.5;
    S.userSpeed = 1.2;
    h.liveVideo.mockReturnValue(null);
    h.onStreamPage.mockReturnValue(false);
    controlLive();
    expect(S.currentSpeed).toBe(1.2);
    expect(h.applyAll).toHaveBeenCalled();
  });

  it("holds during the sticky stream window (onStreamPage) without restoring", () => {
    S.currentSpeed = 1.5;
    S.userSpeed = 1.2;
    h.liveVideo.mockReturnValue(null);
    h.onStreamPage.mockReturnValue(true);
    controlLive();
    expect(S.currentSpeed).toBe(1.5); // untouched
    expect(h.applyAll).not.toHaveBeenCalled();
  });
});

describe("sync OFF (forceLiveNormal)", () => {
  it("forces a live stream back to 100%", () => {
    const v = fakeVideo({ playbackRate: 1.3, preservesPitch: false });
    S.currentSpeed = 1.3;
    S.liveSyncEnabled = false;
    h.liveVideo.mockReturnValue(v);
    controlLive();
    expect(S.currentSpeed).toBe(1.0);
    expect(v.playbackRate).toBe(1.0);
    expect(v.preservesPitch).toBe(true); // repairs a stripped pitch flag
    expect(h.applyAll).toHaveBeenCalled();
  });
});

describe("sync ON (runLiveSync)", () => {
  it("ramps to a gentle catch-up speed when behind the live edge", () => {
    const v = fakeVideo();
    S.liveSyncEnabled = true;
    S.liveSyncTarget = 5;
    h.liveVideo.mockReturnValue(v);
    h.forwardBuffer.mockReturnValue(10); // 10s buffer, 5s target → +5% step
    h.streamLatency.mockReturnValue(null);
    controlLive();
    expect(S.currentSpeed).toBeCloseTo(1.05, 5);
    expect(v.playbackRate).toBeCloseTo(1.05, 5);
  });

  it("does nothing while the stream is paused", () => {
    const v = fakeVideo({ paused: true, playbackRate: 1.0 });
    S.liveSyncEnabled = true;
    h.liveVideo.mockReturnValue(v);
    controlLive();
    expect(h.applyAll).not.toHaveBeenCalled();
    expect(v.playbackRate).toBe(1.0);
  });
});

describe("setLiveRate anti-click re-assert", () => {
  it("re-asserts the rate against external drift at most once a second", () => {
    const v = fakeVideo({ playbackRate: 1.3 });
    S.currentSpeed = 1.3;
    S.liveSyncEnabled = false;
    h.liveVideo.mockReturnValue(v);

    controlLive(); // decision changes 1.3→1.0, writes immediately
    expect(v.playbackRate).toBe(1.0);

    v.playbackRate = 1.05; // the site's own latency manager nudges it
    vi.setSystemTime(T + 300); // <1s since our write
    controlLive(); // decision unchanged → don't fight it yet
    expect(v.playbackRate).toBe(1.05);

    vi.setSystemTime(T + 1300); // >1s → re-assert
    controlLive();
    expect(v.playbackRate).toBe(1.0);
  });
});
