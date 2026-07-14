// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isLive,
  isVkLiveChannelPage,
  liveVideo,
  onStreamPage,
  probeLive,
} from "../src/content/live/detection.js";

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

describe("VK Live routing", () => {
  it("accepts only a channel root as the live route", () => {
    expect(isVkLiveChannelPage("live.vkvideo.ru", "/have_contact")).toBe(true);
    expect(isVkLiveChannelPage("live.vkvideo.ru", "/have_contact/record/id")).toBe(false);
    expect(isVkLiveChannelPage("live.vkvideo.ru", "/app")).toBe(false);
    expect(isVkLiveChannelPage("vkvideo.ru", "/have_contact")).toBe(false);
  });
});

describe("isLive (Boosty routing)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not mistake a Boosty VOD's temporary Infinity duration for a stream", () => {
    vi.stubGlobal("location", {
      hostname: "boosty.to",
      pathname: "/creator/posts/post-id",
      search: "?layer=video:creator:post-id:video-id",
    });

    expect(isLive(vid({ duration: Infinity }))).toBe(false);
  });

  it("still recognises an actual Boosty broadcast route", () => {
    vi.stubGlobal("location", {
      hostname: "boosty.to",
      pathname: "/creator/streams/video_stream",
      search: "",
    });

    expect(isLive(vid({ duration: Infinity }))).toBe(true);
  });
});

describe("isLive (authoritative VOD routes)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-vtp-live");
  });

  it.each([
    ["www.twitch.tv", "/videos/2818975236"],
    ["kick.com", "/fissure_cs_ru2/videos/122d2af5-37be-4229-8542-e2dd5300b995"],
    ["live.vkvideo.ru", "/have_contact/record/record-id"],
  ])("does not let a hidden live player override %s%s", (hostname, pathname) => {
    vi.stubGlobal("location", { hostname, pathname, search: "" });
    document.documentElement.setAttribute("data-vtp-live", "1");

    expect(isLive(vid({ duration: Infinity }))).toBe(false);
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
  it("flag '0' immediately clears a sticky live-page result after SPA navigation", () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "duration", { value: 600, configurable: true });
    Object.defineProperty(video, "paused", { value: false, configurable: true });
    video.getBoundingClientRect = () =>
      ({ width: 640, height: 360, left: 0, top: 0, right: 640, bottom: 360 }) as DOMRect;
    document.body.append(video);
    document.documentElement.setAttribute("data-vtp-live", "1");
    expect(onStreamPage()).toBe(true);

    document.documentElement.setAttribute("data-vtp-live", "0");
    expect(onStreamPage()).toBe(false);
    video.remove();
  });
});

describe("live-page stickiness", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-vtp-live");
  });

  it("does not carry a VK channel's live state onto a recording SPA route", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const route = {
      hostname: "live.vkvideo.ru",
      pathname: "/have_contact",
      search: "",
    };
    vi.stubGlobal("location", route);
    const live = document.createElement("video");
    Object.defineProperty(live, "duration", { value: Infinity, configurable: true });
    Object.defineProperty(live, "paused", { value: false, configurable: true });
    live.getBoundingClientRect = () =>
      ({ width: 640, height: 360, left: 0, top: 0, right: 640, bottom: 360 }) as DOMRect;
    document.body.append(live);
    expect(onStreamPage()).toBe(true);

    live.remove();
    route.pathname = "/have_contact/record/record-id";
    const vod = document.createElement("video");
    Object.defineProperty(vod, "duration", { value: 8_157, configurable: true });
    Object.defineProperty(vod, "paused", { value: false, configurable: true });
    vod.getBoundingClientRect = () =>
      ({ width: 640, height: 360, left: 0, top: 0, right: 640, bottom: 360 }) as DOMRect;
    document.body.append(vod);

    expect(location.pathname).toBe("/have_contact/record/record-id");
    expect(isLive(vod)).toBe(false);
    expect(liveVideo()).toBeNull();
    expect(onStreamPage()).toBe(false);
  });
});

describe("isLive (live signals are scoped to the video's own player)", () => {
  beforeEach(() => {
    vi.stubGlobal("location", { hostname: "www.youtube.com" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-vtp-live");
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

  it("does not force layout by reading the YouTube live badge visibility", () => {
    document.body.innerHTML = `<div class="html5-video-player"><button class="ytp-live-badge"></button><video></video></div>`;
    const video = document.querySelector("video") as HTMLVideoElement;
    const badge = document.querySelector(".ytp-live-badge") as HTMLElement;
    Object.defineProperty(video, "duration", { value: 30, configurable: true });
    Object.defineProperty(badge, "offsetParent", {
      configurable: true,
      get: () => {
        throw new Error("offsetParent should not be read");
      },
    });

    expect(isLive(video)).toBe(false);
  });

  it("prefers the current player's live marker over a transient bridge VOD flag", () => {
    document.body.innerHTML =
      `<div class="html5-video-player ytp-live">` +
      `<span class="ytp-time-display ytp-live"></span><video></video></div>`;
    const video = document.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { value: 4774, configurable: true });
    document.documentElement.setAttribute("data-vtp-live", "0");

    expect(isLive(video)).toBe(true);
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

  it("recognises a finite VK-style live edge that grows in media segments", () => {
    let duration = 10;
    const v = vid();
    Object.defineProperty(v, "duration", {
      configurable: true,
      get: () => duration,
    });
    probeLive(v);
    for (let i = 1; i <= 3; i++) {
      vi.setSystemTime(i * 2000);
      duration += 2;
      probeLive(v); // a new DASH segment arrives at roughly 1x wall-clock rate
      vi.setSystemTime(i * 2000 + 500);
      probeLive(v); // timeupdate between segments must not erase the evidence
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

  it("does not read buffered/seekable ranges for a stable finite VOD", () => {
    const badRanges = {
      length: 1,
      start: () => 0,
      end: () => {
        throw new Error("finite VOD should not read media ranges");
      },
    } as unknown as TimeRanges;
    const v = vid({ duration: 600, buffered: badRanges, seekable: badRanges });

    probeLive(v);
    vi.setSystemTime(1000);
    probeLive(v);

    expect(isLive(v)).toBe(false);
  });

  it("clears a temporary live probe as soon as a finite VOD duration appears", () => {
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
    expect(isLive(v)).toBe(false); // no background probe tick required
    probeLive(v);
    expect(isLive(v)).toBe(false);
  });
});
