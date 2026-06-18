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

describe("isLive (player-published data-vtp-live flag)", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-vtp-live");
  });

  it("flag '1' → live, even with a finite duration", () => {
    document.documentElement.setAttribute("data-vtp-live", "1");
    expect(isLive(vid({ duration: 600 }))).toBe(true);
  });
  it("flag '0' overrides the duration heuristic", () => {
    document.documentElement.setAttribute("data-vtp-live", "0");
    expect(isLive(vid({ duration: Infinity }))).toBe(false);
  });
});

describe("isLive (live signals are scoped to the video's own player)", () => {
  beforeEach(() => {
    vi.stubGlobal("location", { hostname: "www.youtube.com" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  // A Short (or any inline preview) sits in its own .html5-video-player while a
  // stale watch player left over from a previous live stream lingers elsewhere in
  // the DOM, still carrying the ytp-live markers. Detection must look only inside
  // THIS video's player — a global query would let the stale markers leak in.
  it("a live time-display in a different (stale) player does not mark this video live", () => {
    document.body.innerHTML =
      `<div class="html5-video-player ytp-live"><span class="ytp-time-display ytp-live"></span></div>` +
      `<div id="active" class="html5-video-player"><video></video></div>`;
    const video = document.querySelector("#active video") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { value: 30, configurable: true });
    expect(isLive(video)).toBe(false);
  });
});

describe("probeLive (generic real-time-edge detection)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks a video live after a few real-time-rate growth samples", () => {
    let edge = 10;
    const v = vid({
      buffered: { length: 1, start: () => 0, end: () => edge } as unknown as TimeRanges,
    });
    probeLive(v); // seed sample
    for (let i = 1; i <= 4; i++) {
      // edge grows ~1× real time (0.5s per 0.5s)
      vi.setSystemTime(i * 500);
      edge += 0.5;
      probeLive(v);
    }
    expect(isLive(v)).toBe(true);
  });

  it("does NOT mark a VOD (edge already far ahead, no real-time growth) live", () => {
    const v = vid({
      buffered: { length: 1, start: () => 0, end: () => 1000 } as unknown as TimeRanges,
    });
    probeLive(v);
    for (let i = 1; i <= 4; i++) {
      vi.setSystemTime(i * 500);
      probeLive(v);
    } // flat edge
    expect(isLive(v)).toBe(false);
  });
});
