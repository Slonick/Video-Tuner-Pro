// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isLive, onStreamPage, trackDvr, resetDvr } from "../src/content/live/detection.js";

// A live YouTube <video>: finite, growing duration (the duration heuristic alone
// can't see it as live — only the player's data-vtp-live flag does).
function vid(currentTime: number): HTMLVideoElement {
  return {
    currentTime,
    duration: 7200,
    seekable: { length: 0, start: () => 0, end: () => 0 },
    buffered: { length: 0, start: () => 0, end: () => 0 },
    paused: false,
    getBoundingClientRect: () => ({ width: 640, height: 360 }),
  } as unknown as HTMLVideoElement;
}

// YouTube's control-bar LIVE badge — carries ytp-live-badge-is-livehead only when
// playback sits at the live edge (verified against the real player). A bare
// <video> sits alongside it so liveVideo()/onStreamPage() have something to find.
function setBadge(atLiveHead: boolean): void {
  document.body.innerHTML =
    `<button class="ytp-live-badge ytp-button${atLiveHead ? " ytp-live-badge-is-livehead" : ""}"></button>` +
    `<video></video>`;
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
    setBadge(true);
    trackDvr(vid(1000));
    expect(isLive(vid(1000))).toBe(true);
    expect(onStreamPage()).toBe(true);
  });

  it("watching live a few seconds behind (no scrub) stays live — Live-sync keeps working", () => {
    setBadge(false); // not exactly at the head, but the user never scrubbed
    trackDvr(vid(1000));
    trackDvr(vid(1003)); // playback advances forward
    expect(isLive(vid(1003))).toBe(true);
  });

  it("a backward scrub → recording (not live), so manual speed applies", () => {
    setBadge(false);
    trackDvr(vid(1000));   // establish position
    trackDvr(vid(400));    // user presses back / drags ~600s into the buffer
    expect(isLive(vid(400))).toBe(false);
    expect(onStreamPage()).toBe(false);
  });

  it("returning to the live head clears DVR mode → live again", () => {
    setBadge(false);
    trackDvr(vid(1000));
    trackDvr(vid(400));    // scrubbed back
    expect(isLive(vid(400))).toBe(false);
    setBadge(true);        // YouTube re-asserts the livehead badge at the edge
    trackDvr(vid(1000));
    expect(isLive(vid(1000))).toBe(true);
  });

  it("new content loading (resetDvr) starts at the live edge", () => {
    setBadge(false);
    trackDvr(vid(1000));
    trackDvr(vid(400));    // in DVR
    expect(isLive(vid(400))).toBe(false);
    resetDvr();            // SPA navigation to a fresh stream
    setBadge(false);
    trackDvr(vid(50));     // first sample of the new video — no false backward jump
    expect(isLive(vid(50))).toBe(true);
  });

  it("DVR is YouTube-only — a Twitch backward seek is unaffected", () => {
    vi.stubGlobal("location", { hostname: "www.twitch.tv" });
    setBadge(false);
    trackDvr(vid(1000));
    trackDvr(vid(400)); // a backward scrub
    // DVR mode is YouTube-only: on Twitch trackDvr never engages, so the live
    // flag still wins and the page stays a stream after scrubbing back.
    expect(onStreamPage()).toBe(true);
  });
});
