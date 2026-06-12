// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isLive, probeLive } from "../src/content/live/detection.js";

function vid(over: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
  return {
    duration: NaN,
    seekable: { length: 0, start: () => 0, end: () => 0 },
    buffered: { length: 0, start: () => 0, end: () => 0 },
    paused: false,
    getBoundingClientRect: () => ({ width: 640, height: 360 }),
    ...over,
  } as unknown as HTMLVideoElement;
}

describe("isLive", () => {
  it("infinite duration → live", () => {
    expect(isLive(vid({ duration: Infinity }))).toBe(true);
  });
  it("a plain finite VOD → not live", () => {
    expect(isLive(vid({ duration: 600 }))).toBe(false);
  });
});

describe("probeLive (generic real-time-edge detection)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  it("marks a video live after a few real-time-rate growth samples", () => {
    let edge = 10;
    const v = vid({ buffered: { length: 1, start: () => 0, end: () => edge } as unknown as TimeRanges });
    probeLive(v);                       // seed sample
    for (let i = 1; i <= 4; i++) {       // edge grows ~1× real time (0.5s per 0.5s)
      vi.setSystemTime(i * 500);
      edge += 0.5;
      probeLive(v);
    }
    expect(isLive(v)).toBe(true);
  });

  it("does NOT mark a VOD (edge already far ahead, no real-time growth) live", () => {
    const v = vid({ buffered: { length: 1, start: () => 0, end: () => 1000 } as unknown as TimeRanges });
    probeLive(v);
    for (let i = 1; i <= 4; i++) { vi.setSystemTime(i * 500); probeLive(v); } // flat edge
    expect(isLive(v)).toBe(false);
  });
});
