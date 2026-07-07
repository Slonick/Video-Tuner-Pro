// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isLive, liveVideo, probeLive } from "../src/content/live/detection.js";

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
  // Firefox reports a huge INT64_MAX-microseconds sentinel (~9.2e12 s) instead of
  // Infinity for a loading live edge — must still read as live, or the badge shows
  // a garbage remaining-time clock until the slow growth probe catches up.
  it("Firefox's huge sentinel duration → live", () => {
    expect(isLive(vid({ duration: 9.2e12 }))).toBe(true);
  });
  it("NaN duration (VOD before metadata) → not live", () => {
    expect(isLive(vid({ duration: NaN }))).toBe(false);
  });
});

describe("liveVideo", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("ignores tiny live previews", () => {
    const preview = document.createElement("video");
    Object.defineProperty(preview, "duration", { value: Infinity, configurable: true });
    Object.defineProperty(preview, "paused", { value: false, configurable: true });
    preview.getBoundingClientRect = () =>
      ({ width: 24, height: 24, left: 0, top: 0, right: 24, bottom: 24 }) as DOMRect;
    document.body.appendChild(preview);
    expect(liveVideo()).toBeNull();
  });

  it("accepts a smaller live player next to a larger VOD preview", () => {
    const main = document.createElement("video");
    Object.defineProperty(main, "duration", { value: 600, configurable: true });
    Object.defineProperty(main, "paused", { value: false, configurable: true });
    main.getBoundingClientRect = () =>
      ({ width: 1280, height: 720, left: 0, top: 0, right: 1280, bottom: 720 }) as DOMRect;

    const preview = document.createElement("video");
    Object.defineProperty(preview, "duration", { value: Infinity, configurable: true });
    Object.defineProperty(preview, "paused", { value: false, configurable: true });
    preview.getBoundingClientRect = () =>
      ({ width: 320, height: 180, left: 0, top: 0, right: 320, bottom: 180 }) as DOMRect;

    document.body.append(main, preview);
    expect(liveVideo()).toBe(preview);
  });

  it("does not measure obvious VODs while looking for a live player", () => {
    const vod = document.createElement("video");
    Object.defineProperty(vod, "duration", { value: 600, configurable: true });
    Object.defineProperty(vod, "paused", { value: false, configurable: true });
    const measure = vi.fn(() => ({
      width: 1280,
      height: 720,
      left: 0,
      top: 0,
      right: 1280,
      bottom: 720,
    }));
    vod.getBoundingClientRect = measure as typeof vod.getBoundingClientRect;

    const live = document.createElement("video");
    Object.defineProperty(live, "duration", { value: Infinity, configurable: true });
    Object.defineProperty(live, "paused", { value: false, configurable: true });
    live.getBoundingClientRect = () =>
      ({ width: 320, height: 180, left: 0, top: 0, right: 320, bottom: 180 }) as DOMRect;

    document.body.append(vod, live);
    expect(liveVideo()).toBe(live);
    expect(measure).not.toHaveBeenCalled();
  });

  it("still accepts a small live player when it is the main video", () => {
    const player = document.createElement("video");
    Object.defineProperty(player, "duration", { value: Infinity, configurable: true });
    Object.defineProperty(player, "paused", { value: false, configurable: true });
    player.getBoundingClientRect = () =>
      ({ width: 320, height: 180, left: 0, top: 0, right: 320, bottom: 180 }) as DOMRect;

    document.body.appendChild(player);
    expect(liveVideo()).toBe(player);
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

  it("marks a finite but growing media edge live", () => {
    let duration = 10;
    const v = vid();
    Object.defineProperty(v, "duration", {
      configurable: true,
      get: () => duration,
    });
    probeLive(v);
    for (let i = 1; i <= 4; i++) {
      vi.setSystemTime(i * 500);
      duration += 0.5;
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

  it("clears a temporary live probe once a finite VOD duration appears", () => {
    let edge = 10;
    let duration = NaN;
    const v = vid({
      buffered: { length: 1, start: () => 0, end: () => edge } as unknown as TimeRanges,
    });
    Object.defineProperty(v, "duration", {
      configurable: true,
      get: () => duration,
    });
    probeLive(v);
    for (let i = 1; i <= 4; i++) {
      vi.setSystemTime(i * 500);
      edge += 0.5;
      probeLive(v);
    }
    expect(isLive(v)).toBe(true);

    duration = 3600;
    vi.setSystemTime(3000);
    probeLive(v);
    expect(isLive(v)).toBe(false);
  });
});
