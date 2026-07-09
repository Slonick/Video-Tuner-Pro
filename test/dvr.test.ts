// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isLive, onStreamPage, trackDvr, resetDvrFor } from "../src/content/live/detection.js";

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
});
