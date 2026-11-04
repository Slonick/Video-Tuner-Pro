// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isLive,
  onStreamPage,
  trackDvr,
  resetDvrFor,
  probeLive,
} from "../src/content/live/detection.js";

let createdVideos: HTMLVideoElement[] = [];

// YouTube's control-bar LIVE badge — carries ytp-live-badge-is-livehead only when
// playback sits at the live edge (verified against the real player). A bare
// <video> sits alongside it so liveVideo()/onStreamPage() have something to find.
function setBadge(atLiveHead: boolean): HTMLVideoElement {
  document.body.innerHTML =
    `<button class="ytp-live-badge ytp-button${atLiveHead ? " ytp-live-badge-is-livehead" : ""}"></button>` +
    `<video></video>`;
  const video = document.querySelector("video") as HTMLVideoElement;
  createdVideos.push(video);
  Object.defineProperty(video, "duration", { value: 7200, configurable: true });
  Object.defineProperty(video, "paused", { value: false, configurable: true });
  video.getBoundingClientRect = () => ({ width: 640, height: 360 }) as DOMRect;
  return video;
}

function setTime(video: HTMLVideoElement, currentTime: number): HTMLVideoElement {
  Object.defineProperty(video, "currentTime", { value: currentTime, configurable: true });
  return video;
}

function setSeekable(video: HTMLVideoElement, start: number, end: number): HTMLVideoElement {
  Object.defineProperty(video, "seekable", {
    configurable: true,
    value: {
      length: 1,
      start: () => start,
      end: () => end,
    } as TimeRanges,
  });
  return video;
}

// Like the DOM's TimeRanges, an index past the last range throws instead of
// quietly returning an edge.
function setSeekableRanges(
  video: HTMLVideoElement,
  ...spans: [number, number][]
): HTMLVideoElement {
  const edge = (i: number, side: 0 | 1) => {
    if (i < 0 || i >= spans.length) throw new DOMException("Index out of range", "IndexSizeError");
    return spans[i][side];
  };
  Object.defineProperty(video, "seekable", {
    configurable: true,
    value: {
      length: spans.length,
      start: (i: number) => edge(i, 0),
      end: (i: number) => edge(i, 1),
    } as TimeRanges,
  });
  return video;
}

describe("YouTube DVR (scrubbed back from a live stream)", () => {
  beforeEach(() => {
    createdVideos = [];
    vi.stubGlobal("location", { hostname: "www.youtube.com" });
    document.documentElement.setAttribute("data-vtp-live", "1"); // player says isLive
  });
  afterEach(() => {
    for (const video of createdVideos) resetDvrFor(video, true);
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-vtp-live");
    document.documentElement.removeAttribute("data-vtp-latency");
    document.body.innerHTML = "";
  });

  it("at the live edge → live", () => {
    const video = setBadge(true);
    trackDvr(setTime(video, 1000));
    expect(isLive(video)).toBe(true);
    expect(onStreamPage()).toBe(true);
  });

  it("watching live a few seconds behind (no scrub) stays live — Live-sync keeps working", () => {
    const video = setBadge(false); // not exactly at the head, but the user never scrubbed
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 1003)); // playback advances forward
    expect(isLive(video)).toBe(true);
  });

  it("a backward scrub → recording (not live), so manual speed applies", () => {
    const video = setBadge(false);
    trackDvr(setTime(video, 1000)); // establish position
    expect(onStreamPage()).toBe(true); // seen live, so only DVR mode takes the page off-stream
    trackDvr(setTime(video, 400)); // user presses back / drags ~600s into the buffer
    expect(isLive(video)).toBe(false);
    expect(onStreamPage()).toBe(false);
  });

  it("returning to the live head clears DVR mode → live again", () => {
    const video = setBadge(false);
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 400)); // scrubbed back
    expect(isLive(video)).toBe(false);
    setBadge(true); // YouTube re-asserts the livehead badge at the edge
    document.body.appendChild(video);
    trackDvr(setTime(video, 1000));
    expect(isLive(video)).toBe(true);
  });

  it("a low player latency clears a false DVR state after a MediaSource reset", () => {
    const video = setBadge(false);
    trackDvr(setTime(video, 3600));
    trackDvr(setTime(video, 8));
    expect(isLive(video)).toBe(false);

    document.documentElement.setAttribute("data-vtp-latency", "1.7");

    expect(isLive(video)).toBe(true);
    expect(onStreamPage()).toBe(true);
  });

  it("a temporary mid-roll live-flag loss does not erase DVR mode", () => {
    const video = setBadge(false);
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 400)); // scrubbed back
    expect(isLive(video)).toBe(false);

    document.documentElement.setAttribute("data-vtp-live", "0");
    trackDvr(setTime(video, 405)); // ad/player transition
    document.documentElement.setAttribute("data-vtp-live", "1");
    trackDvr(setTime(video, 410));

    expect(isLive(video)).toBe(false);
    expect(onStreamPage()).toBe(false);
  });

  it("a same-page MediaSource metadata reload preserves DVR mode", () => {
    const video = setBadge(false);
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 400));
    expect(isLive(video)).toBe(false);

    resetDvrFor(video);

    expect(isLive(video)).toBe(false);
    expect(onStreamPage()).toBe(false);
  });

  it("an SPA navigation resets DVR state even when the video element is reused", () => {
    vi.stubGlobal("location", {
      hostname: "www.youtube.com",
      pathname: "/watch",
      search: "?v=one",
    });
    const video = setBadge(false);
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 400));
    expect(isLive(video)).toBe(false);

    vi.stubGlobal("location", {
      hostname: "www.youtube.com",
      pathname: "/watch",
      search: "?v=two",
    });
    resetDvrFor(video);
    trackDvr(setTime(video, 20));

    expect(isLive(video)).toBe(true);
  });

  it("YouTube live CSS classes still respect scrubbed-back DVR mode", () => {
    const video = setBadge(false);
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 400));
    document.documentElement.removeAttribute("data-vtp-live");
    const player = document.createElement("div");
    player.className = "html5-video-player ytp-live";
    document.body.append(player);
    player.append(video);

    expect(isLive(video)).toBe(false);
  });

  it("a new video element starts at the live edge", () => {
    const oldVideo = setBadge(false);
    trackDvr(setTime(oldVideo, 1000));
    trackDvr(setTime(oldVideo, 400)); // in DVR
    expect(isLive(oldVideo)).toBe(false);
    const newVideo = setBadge(false);
    trackDvr(setTime(newVideo, 50)); // first sample of the new video — no false backward jump
    expect(isLive(newVideo)).toBe(true);
  });

  it("a Twitch backward seek enters DVR mode and enables recording controls", () => {
    vi.stubGlobal("location", { hostname: "www.twitch.tv" });
    document.documentElement.removeAttribute("data-vtp-live");
    const video = setSeekable(setBadge(false), 0, 1000);
    Object.defineProperty(video, "duration", { value: Infinity, configurable: true });
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 400)); // a backward scrub
    expect(isLive(video)).toBe(false);
    expect(onStreamPage()).toBe(false);
  });

  it("returning a generic DVR stream to its seekable edge restores live mode", () => {
    vi.stubGlobal("location", { hostname: "www.twitch.tv" });
    document.documentElement.removeAttribute("data-vtp-live");
    const video = setSeekable(setBadge(false), 0, 1000);
    Object.defineProperty(video, "duration", { value: Infinity, configurable: true });
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 400));
    expect(isLive(video)).toBe(false);

    trackDvr(setTime(video, 998));
    expect(isLive(video)).toBe(true);
    expect(onStreamPage()).toBe(true);
  });

  it("returning within 3 s of the last seekable range's end restores live mode", () => {
    vi.stubGlobal("location", { hostname: "www.twitch.tv" });
    document.documentElement.removeAttribute("data-vtp-live");
    const video = setSeekableRanges(setBadge(false), [0, 500], [600, 1000]);
    Object.defineProperty(video, "duration", { value: Infinity, configurable: true });
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 400));
    expect(isLive(video)).toBe(false);

    trackDvr(setTime(video, 997));
    expect(isLive(video)).toBe(true);
  });

  it("a YouTube-style live-head badge on another site does not end a scrub", () => {
    vi.stubGlobal("location", { hostname: "www.twitch.tv" });
    document.documentElement.removeAttribute("data-vtp-live");
    const video = setSeekable(setBadge(true), 0, 1000);
    Object.defineProperty(video, "duration", { value: Infinity, configurable: true });
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 400));
    expect(isLive(video)).toBe(false);
  });

  it("never treats a finite VOD backward seek as DVR", () => {
    vi.stubGlobal("location", { hostname: "example.com" });
    document.documentElement.removeAttribute("data-vtp-live");
    const video = setSeekable(setBadge(false), 0, 1000);
    Object.defineProperty(video, "duration", { value: 1000, configurable: true });
    trackDvr(setTime(video, 900));
    trackDvr(setTime(video, 400));
    expect(isLive(video)).toBe(false);
  });

  it("DVR state does not leak from one video element to another", () => {
    const oldVideo = setBadge(false);
    trackDvr(setTime(oldVideo, 1000));
    trackDvr(setTime(oldVideo, 400));
    expect(isLive(oldVideo)).toBe(false);

    const newVideo = setBadge(false);
    trackDvr(setTime(newVideo, 50));
    expect(isLive(newVideo)).toBe(true);
  });

  it("metadata loading on another video does not clear the main DVR state", () => {
    const main = setBadge(false);
    trackDvr(setTime(main, 1000));
    expect(onStreamPage()).toBe(true); // seen live, so only DVR mode takes the page off-stream
    trackDvr(setTime(main, 400));
    expect(isLive(main)).toBe(false);

    const preview = document.createElement("video");
    resetDvrFor(preview);

    expect(isLive(main)).toBe(false);
    expect(onStreamPage()).toBe(false);
  });

  it("a fresh live video overrides another video's recent DVR sticky window", () => {
    const oldVideo = setBadge(false);
    trackDvr(setTime(oldVideo, 1000));
    trackDvr(setTime(oldVideo, 400));
    expect(onStreamPage()).toBe(false);

    const newVideo = setBadge(true);
    trackDvr(setTime(newVideo, 50));
    expect(isLive(newVideo)).toBe(true);
    expect(onStreamPage()).toBe(true);
  });

  it("drifting a few seconds behind after returning to the live head stays live", () => {
    const video = setBadge(false);
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 400)); // scrubbed back
    setBadge(true);
    document.body.appendChild(video);
    trackDvr(setTime(video, 1000)); // back at the head
    setBadge(false); // playback then falls slightly behind the edge, without a scrub
    document.body.appendChild(video);
    trackDvr(setTime(video, 1003));

    expect(isLive(video)).toBe(true);
  });

  it("forward playback and a backward nudge of up to 3 s never count as a scrub", () => {
    const video = setBadge(false);
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 1001));
    trackDvr(setTime(video, 998));
    expect(isLive(video)).toBe(true);
  });

  it.each([
    ["0", true],
    ["15", true],
    ["15.5", false],
    ["-1", false],
  ])("a published player latency of %s s ends the scrub: %s", (latency, live) => {
    const video = setBadge(false);
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 400));

    document.documentElement.setAttribute("data-vtp-latency", latency);

    expect(isLive(video)).toBe(live);
  });

  it("a stale player's live-head badge does not end this video's scrub", () => {
    document.body.innerHTML =
      `<div class="html5-video-player">` +
      `<button class="ytp-live-badge ytp-live-badge-is-livehead"></button></div>` +
      `<div class="html5-video-player"><button class="ytp-live-badge"></button>` +
      `<video></video></div>`;
    const video = document.querySelector("video") as HTMLVideoElement;
    createdVideos.push(video);
    Object.defineProperty(video, "duration", { value: 7200, configurable: true });
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 400));

    expect(isLive(video)).toBe(false);
  });
});

describe("source swap on a generic live stream (Kick quality change)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("location", { hostname: "kick.com", pathname: "/streamer", search: "" });
    document.documentElement.removeAttribute("data-vtp-live");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  function unboundedLive(): HTMLVideoElement {
    const video = setSeekable(setBadge(false), 0, 1073741824);
    Object.defineProperty(video, "duration", { value: Infinity, configurable: true });
    return video;
  }

  it("a reset to 0 followed by playback resuming ahead stays live", () => {
    const video = unboundedLive();
    trackDvr(setTime(video, 8.5));
    trackDvr(setTime(video, 0)); // the player drops the position while swapping sources
    expect(isLive(video)).toBe(true);

    vi.advanceTimersByTime(700);
    trackDvr(setTime(video, 10)); // new rendition starts further along
    vi.advanceTimersByTime(5000);
    trackDvr(setTime(video, 14));

    expect(isLive(video)).toBe(true);
    expect(onStreamPage()).toBe(true);
  });

  it("a reset to the start that stays behind becomes a scrub back", () => {
    const video = unboundedLive();
    Object.defineProperty(video, "readyState", { value: 4, configurable: true });
    trackDvr(setTime(video, 600));
    trackDvr(setTime(video, 0));
    expect(isLive(video)).toBe(true);

    vi.advanceTimersByTime(3000);
    trackDvr(setTime(video, 3));

    expect(isLive(video)).toBe(false);
  });

  it("a slow source swap still loading past the window is not a scrub back", () => {
    const video = unboundedLive();
    Object.defineProperty(video, "readyState", { value: 1, configurable: true });
    trackDvr(setTime(video, 8.5));
    trackDvr(setTime(video, 0));

    vi.advanceTimersByTime(4000);
    trackDvr(setTime(video, 0));
    expect(isLive(video)).toBe(true);

    vi.advanceTimersByTime(500);
    trackDvr(setTime(video, 10));
    expect(isLive(video)).toBe(true);
  });

  it("playback resuming past the old position cancels the pending scrub for good", () => {
    const video = unboundedLive();
    Object.defineProperty(video, "readyState", { value: 4, configurable: true });
    trackDvr(setTime(video, 8.5));
    trackDvr(setTime(video, 0));

    vi.advanceTimersByTime(700);
    trackDvr(setTime(video, 9)); // the new rendition picks up where the old one left off
    vi.advanceTimersByTime(2000);
    trackDvr(setTime(video, 11));

    expect(isLive(video)).toBe(true);
  });

  it("a reset that stays behind becomes a scrub exactly 2.5 s later", () => {
    const video = unboundedLive();
    Object.defineProperty(video, "readyState", {
      value: HTMLMediaElement.HAVE_FUTURE_DATA,
      configurable: true,
    });
    trackDvr(setTime(video, 600));
    trackDvr(setTime(video, 0));

    vi.advanceTimersByTime(1000);
    trackDvr(setTime(video, 1));
    expect(isLive(video)).toBe(true);

    vi.advanceTimersByTime(1500);
    trackDvr(setTime(video, 2.5));
    expect(isLive(video)).toBe(false);
  });

  it("a jump back to 1 s is an immediate scrub, not a source swap", () => {
    const video = unboundedLive();
    trackDvr(setTime(video, 600));
    trackDvr(setTime(video, 1));
    expect(isLive(video)).toBe(false);
  });

  it("a source swap resuming 3 s behind the old position is not a scrub", () => {
    const video = unboundedLive();
    Object.defineProperty(video, "readyState", { value: 4, configurable: true });
    trackDvr(setTime(video, 8.5));
    trackDvr(setTime(video, 0));

    vi.advanceTimersByTime(3000);
    trackDvr(setTime(video, 5.5));
    expect(isLive(video)).toBe(true);
  });

  it("a scrub back after a settled source swap still counts", () => {
    const video = unboundedLive();
    trackDvr(setTime(video, 8.5));
    trackDvr(setTime(video, 0));
    vi.advanceTimersByTime(700);
    trackDvr(setTime(video, 9)); // the new rendition resumes ahead
    trackDvr(setTime(video, 30));

    trackDvr(setTime(video, 10)); // then the viewer scrubs back 20 s
    expect(isLive(video)).toBe(false);
  });
});

describe("entering DVR needs a live signal at the moment of the backward jump", () => {
  beforeEach(() => {
    createdVideos = [];
    document.documentElement.removeAttribute("data-vtp-live");
  });
  afterEach(() => {
    for (const video of createdVideos) resetDvrFor(video, true);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-vtp-live");
    document.body.innerHTML = "";
  });

  function mountVideo(markup: string, selector = "video"): HTMLVideoElement {
    document.body.innerHTML = markup;
    const video = document.querySelector(selector) as HTMLVideoElement;
    createdVideos.push(video);
    Object.defineProperty(video, "duration", { value: 7200, configurable: true });
    return video;
  }

  it("a jump while a Twitch quality switch reports a finite duration is not a scrub", () => {
    vi.stubGlobal("location", { hostname: "www.twitch.tv", pathname: "/streamer", search: "" });
    const video = setSeekable(mountVideo("<video></video>"), 0, 1000);
    let duration = Infinity;
    Object.defineProperty(video, "duration", { configurable: true, get: () => duration });
    trackDvr(setTime(video, 600));
    duration = 30;
    trackDvr(setTime(video, 5)); // the swap drops the position while the duration is finite
    duration = Infinity;
    trackDvr(setTime(video, 6));

    expect(isLive(video)).toBe(true);
  });

  it("YouTube-style live markup on another site is no live signal for a jump", () => {
    vi.stubGlobal("location", { hostname: "www.twitch.tv", pathname: "/streamer", search: "" });
    const video = mountVideo(`<div class="html5-video-player ytp-live"><video></video></div>`);
    setSeekable(video, 0, 1000);
    let duration = Infinity;
    Object.defineProperty(video, "duration", { configurable: true, get: () => duration });
    trackDvr(setTime(video, 600));
    duration = 30;
    trackDvr(setTime(video, 5)); // a quality switch drops the position, duration finite
    duration = Infinity;
    trackDvr(setTime(video, 6));

    expect(isLive(video)).toBe(true);
  });

  it.each([
    [
      "inside a player that shows no live markers yet",
      `<div class="html5-video-player"><video></video></div>`,
    ],
    ["outside any player", `<video></video>`],
  ])("a YouTube timeline reset on a video %s is not a scrub", (_, markup) => {
    vi.stubGlobal("location", { hostname: "www.youtube.com" });
    const video = mountVideo(markup);
    trackDvr(setTime(video, 3600));
    trackDvr(setTime(video, 8)); // the MediaSource is replaced during startup

    const player =
      video.closest<HTMLElement>(".html5-video-player") ?? document.createElement("div");
    player.className = "html5-video-player ytp-live"; // the player then turns out to be live
    player.append(video);
    document.body.append(player);
    expect(isLive(video)).toBe(true);
  });

  it("a YouTube timeline reset while the bridge briefly reports a VOD is not a scrub", () => {
    vi.stubGlobal("location", { hostname: "www.youtube.com" });
    const video = mountVideo(`<div class="html5-video-player ytp-live"><video></video></div>`);
    // getVideoData().isLive reads false while YouTube swaps its MediaSource.
    document.documentElement.setAttribute("data-vtp-live", "0");
    trackDvr(setTime(video, 3600));
    trackDvr(setTime(video, 8));
    document.documentElement.setAttribute("data-vtp-live", "1");

    expect(isLive(video)).toBe(true);
  });

  it("without the bridge flag, the video's own live player makes a backward jump a scrub", () => {
    vi.stubGlobal("location", { hostname: "www.youtube.com" });
    // An inline preview's player comes first in the page.
    const video = mountVideo(
      `<div class="html5-video-player"><video></video></div>` +
        `<div class="html5-video-player ytp-live"><video id="main"></video></div>`,
      "#main",
    );
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 400));

    expect(isLive(video)).toBe(false);
  });

  it("a finite live edge confirmed by the probe makes a backward jump a scrub", () => {
    vi.useFakeTimers();
    vi.stubGlobal("location", {
      hostname: "live.vkvideo.ru",
      pathname: "/have_contact",
      search: "",
    });
    const video = mountVideo("<video></video>");
    let duration = 10;
    Object.defineProperty(video, "duration", { configurable: true, get: () => duration });
    probeLive(video);
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(500);
      duration += 0.5; // a DASH live edge growing at 1x
      probeLive(video);
    }
    expect(isLive(video)).toBe(true);

    trackDvr(setTime(video, 10));
    trackDvr(setTime(video, 4));
    expect(isLive(video)).toBe(false);
  });
});

describe("DVR across SPA navigations on a reused <video>", () => {
  const route = { hostname: "www.twitch.tv", pathname: "/first", search: "" };
  beforeEach(() => {
    createdVideos = [];
    vi.useFakeTimers();
    route.pathname = "/first";
    vi.stubGlobal("location", route);
    document.documentElement.removeAttribute("data-vtp-live");
  });
  afterEach(() => {
    for (const video of createdVideos) resetDvrFor(video, true);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it.each([
    ["the next timeupdate", (video: HTMLVideoElement) => trackDvr(setTime(video, 20))],
    ["a metadata reload", (video: HTMLVideoElement) => resetDvrFor(video)],
  ])("%s on the next channel ends DVR and its hold on the on-stream state", (_, settle) => {
    let duration = Infinity;
    const video = setSeekable(setBadge(false), 0, 1000);
    Object.defineProperty(video, "duration", { configurable: true, get: () => duration });
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 400));
    expect(isLive(video)).toBe(false);

    vi.advanceTimersByTime(1000);
    route.pathname = "/second";
    settle(video);
    expect(isLive(video)).toBe(true);
    expect(onStreamPage()).toBe(true);

    duration = 30; // a quality switch briefly reports a finite duration
    vi.advanceTimersByTime(1000);
    expect(onStreamPage()).toBe(true);
  });

  it("a preview's first timeupdate after the navigation keeps the new page's DVR hold", () => {
    const preview = document.createElement("video");
    trackDvr(setTime(preview, 5)); // it played on the previous page
    route.pathname = "/second";
    const video = setSeekable(setBadge(false), 0, 1000);
    Object.defineProperty(video, "duration", { value: Infinity, configurable: true });
    expect(onStreamPage()).toBe(true);
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 400)); // the viewer scrubs back on the new channel

    trackDvr(setTime(preview, 6));
    expect(onStreamPage()).toBe(false);
  });
});
