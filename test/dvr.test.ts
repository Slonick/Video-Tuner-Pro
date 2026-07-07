// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isLive, onStreamPage, trackDvr, resetDvr } from "../src/content/live/detection.js";

// YouTube's control-bar LIVE badge — carries ytp-live-badge-is-livehead only when
// playback sits at the live edge (verified against the real player). A bare
// <video> sits alongside it so liveVideo()/onStreamPage() have something to find.
function setBadge(atLiveHead: boolean): HTMLVideoElement {
  document.body.innerHTML =
    `<button class="ytp-live-badge ytp-button${atLiveHead ? " ytp-live-badge-is-livehead" : ""}"></button>` +
    `<video></video>`;
  const video = document.querySelector("video") as HTMLVideoElement;
  Object.defineProperty(video, "duration", { value: 7200, configurable: true });
  Object.defineProperty(video, "paused", { value: false, configurable: true });
  video.getBoundingClientRect = () => ({ width: 640, height: 360 }) as DOMRect;
  return video;
}

function setTime(video: HTMLVideoElement, currentTime: number): HTMLVideoElement {
  Object.defineProperty(video, "currentTime", { value: currentTime, configurable: true });
  return video;
}

describe("YouTube DVR (scrubbed back from a live stream)", () => {
  beforeEach(() => {
    vi.stubGlobal("location", { hostname: "www.youtube.com" });
    document.documentElement.setAttribute("data-vtp-live", "1"); // player says isLive
    resetDvr();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-vtp-live");
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

  it("new content loading (resetDvr) starts at the live edge", () => {
    const oldVideo = setBadge(false);
    trackDvr(setTime(oldVideo, 1000));
    trackDvr(setTime(oldVideo, 400)); // in DVR
    expect(isLive(oldVideo)).toBe(false);
    resetDvr(); // SPA navigation to a fresh stream
    const newVideo = setBadge(false);
    trackDvr(setTime(newVideo, 50)); // first sample of the new video — no false backward jump
    expect(isLive(newVideo)).toBe(true);
  });

  it("DVR is YouTube-only — a Twitch backward seek is unaffected", () => {
    vi.stubGlobal("location", { hostname: "www.twitch.tv" });
    const video = setBadge(false);
    trackDvr(setTime(video, 1000));
    trackDvr(setTime(video, 400)); // a backward scrub
    // DVR mode is YouTube-only: on Twitch trackDvr never engages, so the live
    // flag still wins and the page stays a stream after scrubbing back.
    expect(onStreamPage()).toBe(true);
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
