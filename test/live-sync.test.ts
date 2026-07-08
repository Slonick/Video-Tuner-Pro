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
  props: Partial<{
    playbackRate: number;
    paused: boolean;
    preservesPitch: boolean;
    droppedVideoFrames: number;
  }> = {},
) {
  const v = {
    playbackRate: 1.0,
    paused: false,
    preservesPitch: true,
    ...props,
  } as Partial<HTMLVideoElement> & { droppedVideoFrames?: number };
  v.getVideoPlaybackQuality = () =>
    ({ droppedVideoFrames: v.droppedVideoFrames ?? 0 }) as VideoPlaybackQuality;
  return v as HTMLVideoElement;
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

  it("does not overwrite an active manual VOD speed", () => {
    S.currentSpeed = 1.5;
    S.userSpeed = 1.2;
    S.speedManual = true;
    h.liveVideo.mockReturnValue(null);
    h.onStreamPage.mockReturnValue(false);
    controlLive();
    expect(S.currentSpeed).toBe(1.5);
    expect(h.applyAll).not.toHaveBeenCalled();
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

  it("keeps a catch-up step above the target instead of dithering downward", () => {
    const v = fakeVideo();
    S.liveSyncEnabled = true;
    S.liveSyncTarget = 5;
    h.liveVideo.mockReturnValue(v);
    h.streamLatency.mockReturnValue(13); // excess 8s → 110%
    controlLive();
    expect(v.playbackRate).toBeCloseTo(1.1, 5);

    h.streamLatency.mockReturnValue(11.9); // excess dips under 7s → decision says 105%
    vi.setSystemTime(T + 300);
    controlLive();
    expect(v.playbackRate).toBeCloseTo(1.1, 5); // held — dwell not elapsed
    expect(S.currentSpeed).toBeCloseTo(1.1, 5);

    vi.setSystemTime(T + 3000); // dwell elapsed, but still above target
    controlLive();
    expect(v.playbackRate).toBeCloseTo(1.1, 5);

    h.streamLatency.mockReturnValue(4.9); // target reached
    vi.setSystemTime(T + 3300);
    controlLive();
    expect(v.playbackRate).toBe(1.0);
  });

  it("bails to 100% immediately even inside the dwell window", () => {
    const v = fakeVideo();
    S.liveSyncEnabled = true;
    S.liveSyncTarget = 5;
    h.liveVideo.mockReturnValue(v);
    h.streamLatency.mockReturnValue(13); // 110%
    controlLive();
    expect(v.playbackRate).toBeCloseTo(1.1, 5);

    h.streamLatency.mockReturnValue(4.9); // target reached
    vi.setSystemTime(T + 300);
    controlLive();
    expect(v.playbackRate).toBe(1.0); // not held back by the dwell
    expect(S.currentSpeed).toBe(1.0);
  });

  it("keeps the minimum catch-up step above the target instead of flapping to 100%", () => {
    const v = fakeVideo();
    S.liveSyncEnabled = true;
    S.liveSyncTarget = 5;
    h.liveVideo.mockReturnValue(v);
    h.streamLatency.mockReturnValue(6.5); // excess 1.5s → 105%
    h.forwardBuffer.mockReturnValue(10);
    controlLive();
    expect(v.playbackRate).toBeCloseTo(1.05, 5);

    h.streamLatency.mockReturnValue(5.4); // inside deadband, still above target
    vi.setSystemTime(T + 3000);
    controlLive();
    expect(v.playbackRate).toBeCloseTo(1.05, 5);
    expect(S.currentSpeed).toBeCloseTo(1.05, 5);

    h.streamLatency.mockReturnValue(4.9); // target reached
    vi.setSystemTime(T + 6000);
    controlLive();
    expect(v.playbackRate).toBe(1.0);
    expect(S.currentSpeed).toBe(1.0);
  });

  it("does nothing while the stream is paused", () => {
    const v = fakeVideo({ paused: true, playbackRate: 1.0 });
    S.liveSyncEnabled = true;
    h.liveVideo.mockReturnValue(v);
    controlLive();
    expect(h.applyAll).not.toHaveBeenCalled();
    expect(v.playbackRate).toBe(1.0);
  });

  it("keeps the dropped-frame baseline fresh when no catch-up can be applied", () => {
    const v = fakeVideo();
    const getQuality = vi.fn(v.getVideoPlaybackQuality);
    v.getVideoPlaybackQuality = getQuality;
    S.liveSyncEnabled = true;
    S.liveSyncTarget = 5;
    h.liveVideo.mockReturnValue(v);
    h.streamLatency.mockReturnValue(4.9);
    h.forwardBuffer.mockReturnValue(10);

    controlLive();

    expect(getQuality).toHaveBeenCalledTimes(1);
    expect(v.playbackRate).toBe(1.0);
  });

  it("does not let old 1x dropped frames block a later catch-up decision", () => {
    const v = fakeVideo({ droppedVideoFrames: 0 });
    S.liveSyncEnabled = true;
    S.liveSyncTarget = 5;
    h.liveVideo.mockReturnValue(v);
    h.forwardBuffer.mockReturnValue(10);
    h.streamLatency.mockReturnValue(4.9);

    controlLive();
    v.droppedVideoFrames = 12;
    vi.setSystemTime(T + 300);
    controlLive();
    expect(v.playbackRate).toBe(1.0);

    h.streamLatency.mockReturnValue(6.5);
    vi.setSystemTime(T + 600);
    controlLive();
    expect(v.playbackRate).toBeCloseTo(1.05, 5);
  });

  it("does not inherit the dwell window when the live video element changes", () => {
    const first = fakeVideo();
    const second = fakeVideo();
    S.liveSyncEnabled = true;
    S.liveSyncTarget = 5;

    h.liveVideo.mockReturnValue(first);
    h.streamLatency.mockReturnValue(13); // excess 8s → 110%
    controlLive();
    expect(first.playbackRate).toBeCloseTo(1.1, 5);

    h.liveVideo.mockReturnValue(second);
    h.streamLatency.mockReturnValue(11.9); // would be held at 110% if dwell leaked
    vi.setSystemTime(T + 300);
    controlLive();
    expect(second.playbackRate).toBeCloseTo(1.05, 5);
    expect(S.currentSpeed).toBeCloseTo(1.05, 5);
  });

  it("does not treat a new live video's first dropped-frame total as a burst", () => {
    const first = fakeVideo({ droppedVideoFrames: 0 });
    const second = fakeVideo({ droppedVideoFrames: 10 });
    S.liveSyncEnabled = true;
    S.liveSyncTarget = 5;
    h.streamLatency.mockReturnValue(null);
    h.forwardBuffer.mockReturnValue(10);

    h.liveVideo.mockReturnValue(first);
    controlLive();
    expect(first.playbackRate).toBeCloseTo(1.05, 5);

    first.droppedVideoFrames = 5;
    vi.setSystemTime(T + 2000);
    controlLive();
    expect(first.playbackRate).toBe(1.0);

    h.liveVideo.mockReturnValue(second);
    vi.setSystemTime(T + 4000);
    controlLive();
    expect(second.playbackRate).toBeCloseTo(1.05, 5);
  });

  it("ignores dropped frames after the site already applied our new catch-up rate", () => {
    const v = fakeVideo({ playbackRate: 1.05, droppedVideoFrames: 0 });
    S.liveSyncEnabled = true;
    S.liveSyncTarget = 5;
    h.liveVideo.mockReturnValue(v);
    h.streamLatency.mockReturnValue(6.5); // desired 105%
    h.forwardBuffer.mockReturnValue(10);

    controlLive();
    expect(S.currentSpeed).toBeCloseTo(1.05, 5);
    expect(v.playbackRate).toBeCloseTo(1.05, 5);

    v.droppedVideoFrames = 6; // burst caused by the external rate switch
    vi.setSystemTime(T + 500);
    controlLive();

    expect(S.currentSpeed).toBeCloseTo(1.05, 5);
    expect(v.playbackRate).toBeCloseTo(1.05, 5);
  });

  it("still bails on dropped frames after an external rate reassert", () => {
    const v = fakeVideo({ playbackRate: 1.0, droppedVideoFrames: 0 });
    S.liveSyncEnabled = true;
    S.liveSyncTarget = 5;
    h.liveVideo.mockReturnValue(v);
    h.streamLatency.mockReturnValue(6.5); // desired 105%
    h.forwardBuffer.mockReturnValue(10);

    controlLive();
    expect(v.playbackRate).toBeCloseTo(1.05, 5);

    v.playbackRate = 1.0; // site/player nudges the rate back
    vi.setSystemTime(T + 1300);
    controlLive(); // extension reasserts, but this should not reset the drop-bail window
    expect(v.playbackRate).toBeCloseTo(1.05, 5);

    v.droppedVideoFrames = 5;
    vi.setSystemTime(T + 2000);
    controlLive();

    expect(S.currentSpeed).toBe(1.0);
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
