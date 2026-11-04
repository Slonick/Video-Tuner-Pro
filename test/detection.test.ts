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

// Like the DOM's TimeRanges, an index past the last range throws instead of
// quietly returning an edge. `spans` stays live, so a test can move an edge.
function timeRanges(spans: [number, number][]): TimeRanges {
  const edge = (i: number, side: 0 | 1) => {
    if (i < 0 || i >= spans.length) throw new DOMException("Index out of range", "IndexSizeError");
    return spans[i][side];
  };
  return {
    get length() {
      return spans.length;
    },
    start: (i: number) => edge(i, 0),
    end: (i: number) => edge(i, 1),
  } as TimeRanges;
}

function liveElement(width: number, height: number): HTMLVideoElement {
  const video = document.createElement("video");
  Object.defineProperty(video, "duration", { value: Infinity, configurable: true });
  Object.defineProperty(video, "paused", { value: false, configurable: true });
  video.getBoundingClientRect = () =>
    ({ width, height, left: 0, top: 0, right: width, bottom: height }) as DOMRect;
  return video;
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
  it("a duration right at the 1e7 s sentinel cutoff → live", () => {
    expect(isLive(vid({ duration: 1e7 }))).toBe(true);
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

  it.each([
    "app",
    "feed",
    "search",
    "settings",
    "help",
    "support",
    "about",
    "categories",
    "category",
    "following",
  ])("never treats the reserved /%s page as a channel", (page) => {
    expect(isVkLiveChannelPage("live.vkvideo.ru", `/${page}`)).toBe(false);
  });

  it("ignores hosts that only start with live.vkvideo.ru", () => {
    expect(isVkLiveChannelPage("live.vkvideo.ru.example.com", "/have_contact")).toBe(false);
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

  it("keeps the generic live heuristics on a host that only starts with boosty.to", () => {
    vi.stubGlobal("location", {
      hostname: "boosty.to.example.com",
      pathname: "/creator/posts/post-id",
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
    ["twitch.tv", "/videos/2818975236"],
    ["kick.com", "/fissure_cs_ru2/videos/122d2af5-37be-4229-8542-e2dd5300b995"],
    ["live.vkvideo.ru", "/have_contact/record/record-id"],
  ])("does not let a hidden live player override %s%s", (hostname, pathname) => {
    vi.stubGlobal("location", { hostname, pathname, search: "" });
    document.documentElement.setAttribute("data-vtp-live", "1");

    expect(isLive(vid({ duration: Infinity }))).toBe(false);
  });

  it.each([
    ["twitch.tv.example.com", "/videos/2818975236"],
    ["www.twitch.tv", "/streamer/videos/2818975236"],
    ["kick.com.example.com", "/streamer/videos/video-id"],
    ["kick.com", "/category/streamer/videos/video-id"],
    ["example.com", "/streamer/record/record-id"],
    ["live.vkvideo.ru.example.com", "/streamer/record/record-id"],
    ["live.vkvideo.ru", "/catalog/streamer/record/record-id"],
  ])("a live player stays live on the look-alike route %s%s", (hostname, pathname) => {
    vi.stubGlobal("location", { hostname, pathname, search: "" });
    document.documentElement.setAttribute("data-vtp-live", "1");

    expect(isLive(vid({ duration: Infinity }))).toBe(true);
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

  it.each([
    [24, 360],
    [640, 24],
  ])("ignores a %i×%i live strip", (width, height) => {
    document.body.appendChild(liveElement(width, height));
    expect(liveVideo()).toBeNull();
  });

  it("accepts a live player of exactly 40×40", () => {
    const player = liveElement(40, 40);
    document.body.appendChild(player);
    expect(liveVideo()).toBe(player);
  });

  it("prefers the largest of several playing live players", () => {
    const main = liveElement(1280, 720);
    const strip = liveElement(400, 100); // wider aspect ratio, far smaller area
    document.body.append(main, strip);
    expect(liveVideo()).toBe(main);
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

  it("stays on-stream through a brief flicker until 6 s after the stream was last seen", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    vi.stubGlobal("location", { hostname: "www.twitch.tv", pathname: "/flicker", search: "" });
    const live = liveElement(640, 360);
    document.body.append(live);
    expect(onStreamPage()).toBe(true);

    // A quality switch momentarily reports a finite duration.
    Object.defineProperty(live, "duration", { value: 30, configurable: true });
    vi.setSystemTime(15_999);
    expect(onStreamPage()).toBe(true);
    vi.setSystemTime(16_000);
    expect(onStreamPage()).toBe(false);
  });

  it("a stream found through liveVideo() refreshes the sticky window too", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    vi.stubGlobal("location", { hostname: "www.twitch.tv", pathname: "/found", search: "" });
    const live = liveElement(640, 360);
    document.body.append(live);
    expect(liveVideo()).toBe(live);

    Object.defineProperty(live, "duration", { value: 30, configurable: true });
    vi.setSystemTime(11_000);
    expect(onStreamPage()).toBe(true);
  });

  it("trusts the caller's own live-video scan instead of rescanning the page", () => {
    vi.stubGlobal("location", { hostname: "www.twitch.tv", pathname: "/explicit", search: "" });
    document.body.append(liveElement(640, 360));
    expect(onStreamPage(null)).toBe(false);

    document.body.innerHTML = "";
    expect(onStreamPage(liveElement(640, 360))).toBe(true);
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

  it("the player's ytp-live class alone marks a finite-duration video live", () => {
    document.body.innerHTML = `<div class="html5-video-player ytp-live"><video></video></div>`;
    const video = document.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { value: 4774, configurable: true });

    expect(isLive(video)).toBe(true);
  });

  it("the player's live time display alone marks a finite-duration video live", () => {
    document.body.innerHTML =
      `<div class="html5-video-player">` +
      `<span class="ytp-time-display ytp-live"></span><video></video></div>`;
    const video = document.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { value: 4774, configurable: true });

    expect(isLive(video)).toBe(true);
  });

  it.each([
    ["youtube.com", true],
    ["youtube.com.example.org", false],
  ])("reads YouTube player markers on %s: %s", (hostname, live) => {
    vi.stubGlobal("location", { hostname });
    document.body.innerHTML = `<div class="html5-video-player ytp-live"><video></video></div>`;
    const video = document.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { value: 4774, configurable: true });

    expect(isLive(video)).toBe(live);
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

  // The edge starts at 10 s in `grows`; the other range list holds `other`.
  // `confirm` feeds the three 1x samples that make the edge live at t = 1500 ms.
  function edgeVideo(grows: "buffered" | "seekable" = "buffered", other: [number, number][] = []) {
    const edge: [number, number][] = [[0, 10]];
    const v = vid(
      grows === "buffered"
        ? { buffered: timeRanges(edge), seekable: timeRanges(other) }
        : { seekable: timeRanges(edge), buffered: timeRanges(other) },
    );
    const sample = (at: number, growth = 0) => {
      edge[0][1] += growth;
      vi.setSystemTime(at);
      probeLive(v);
    };
    const confirm = () => {
      sample(0);
      for (const at of [500, 1000, 1500]) sample(at, 0.5);
    };
    return { v, sample, confirm };
  }

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
    const end = vi.fn(() => 600);
    const ranges = { length: 1, start: () => 0, end } as unknown as TimeRanges;
    const v = vid({ duration: 600, buffered: ranges, seekable: ranges });

    probeLive(v);
    vi.setSystemTime(1000);
    probeLive(v);

    expect(isLive(v)).toBe(false);
    expect(end).not.toHaveBeenCalled();
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

  it.each([1e7, 9.2e12])(
    "drops live at once when a VOD duration replaces a %d s sentinel on the same element",
    (sentinel) => {
      let duration = sentinel;
      const v = vid();
      Object.defineProperty(v, "duration", { configurable: true, get: () => duration });
      probeLive(v);
      expect(isLive(v)).toBe(true);

      duration = 3600; // an SPA reuses the stream's element for a recording
      expect(isLive(v)).toBe(false);
    },
  );

  it("needs three consecutive real-time samples to confirm a live edge", () => {
    const { v, sample } = edgeVideo();
    sample(4000);
    sample(4500, 0.5);
    expect(isLive(v)).toBe(false);
    sample(5000, 0.5);
    expect(isLive(v)).toBe(false);
    sample(5500, 0.5);
    expect(isLive(v)).toBe(true);
  });

  it.each(["buffered", "seekable"] as const)("follows a growing %s edge alone", (grows) => {
    const { v, confirm } = edgeVideo(grows);
    confirm();
    expect(isLive(v)).toBe(true);
  });

  it.each([1e7, 2 ** 30])("follows buffered growth past a %d s seekable sentinel", (sentinel) => {
    const { v, confirm } = edgeVideo("buffered", [[0, sentinel]]);
    confirm();
    expect(isLive(v)).toBe(true);
  });

  it("follows a growing edge while the element reports a zero duration", () => {
    const { v, confirm } = edgeVideo();
    Object.defineProperty(v, "duration", { value: 0, configurable: true });
    confirm();
    expect(isLive(v)).toBe(true);
  });

  it.each([
    [100, false],
    [400, true],
  ])("three 1x samples %i ms apart confirm a live edge: %s", (gap, live) => {
    const { v, sample } = edgeVideo();
    sample(0);
    for (let i = 1; i <= 3; i++) sample(i * gap, gap / 1000);
    expect(isLive(v)).toBe(live);
  });

  it.each([
    ["0.3x", 0.375],
    ["1.7x", 2.125],
  ])("an edge growing at exactly %s is not real-time", (_, growth) => {
    const { v, sample } = edgeVideo();
    sample(0);
    for (let i = 1; i <= 3; i++) sample(i * 1250, growth);
    expect(isLive(v)).toBe(false);
  });

  it("a burst between real-time samples restarts the count", () => {
    const { v, sample } = edgeVideo();
    sample(0);
    sample(500, 0.5);
    sample(1000, 0.5);
    sample(1500, 50); // a VOD filling its buffer far faster than real time
    sample(2000, 0.5);
    expect(isLive(v)).toBe(false);
  });

  it("forgets real-time growth evidence after 8 s without edge movement", () => {
    const { v, sample } = edgeVideo();
    sample(0);
    sample(500, 0.5);
    sample(1000, 0.5);
    sample(9000);
    sample(9500, 8.5); // one more segment, at 1x over the whole gap
    expect(isLive(v)).toBe(false);
  });

  it.each([
    ["stalls", 0],
    ["only grows in bursts", 100],
  ])("a confirmed edge that %s expires 8 s after its last real-time growth", (_, growth) => {
    const { v, sample, confirm } = edgeVideo();
    confirm();
    sample(9100, growth);
    expect(isLive(v)).toBe(true);
    sample(9500, growth);
    expect(isLive(v)).toBe(false);
  });

  it("keeps an Infinity-duration stream live while its duration briefly reads NaN", () => {
    let duration = Infinity;
    const v = vid();
    Object.defineProperty(v, "duration", { configurable: true, get: () => duration });
    vi.setSystemTime(1000);
    probeLive(v);

    duration = NaN; // the MediaSource is re-attached for a quality switch
    expect(isLive(v)).toBe(true);
  });

  it("a live result cleared by isLive stays cleared when the duration blinks to NaN", () => {
    const { v, confirm } = edgeVideo();
    let duration = NaN;
    Object.defineProperty(v, "duration", { configurable: true, get: () => duration });
    confirm();
    expect(isLive(v)).toBe(true);

    duration = 3600;
    expect(isLive(v)).toBe(false);
    duration = NaN; // the recording reloads its MediaSource for a quality change
    expect(isLive(v)).toBe(false);
  });

  it("a probe sample that sees the finite duration first clears the live result too", () => {
    const { v, sample, confirm } = edgeVideo();
    let duration = NaN;
    Object.defineProperty(v, "duration", { configurable: true, get: () => duration });
    confirm();
    expect(isLive(v)).toBe(true);

    duration = 3600;
    sample(2000);
    duration = NaN;
    expect(isLive(v)).toBe(false);
  });
});
