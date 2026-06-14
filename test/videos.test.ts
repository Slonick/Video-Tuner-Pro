// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { collectVideos, primaryVideo } from "../src/content/videos.js";

// Helper: a <video> with a stubbed bounding box and paused state (jsdom returns
// a zero-size rect and no real playback).
function vid(width: number, height: number, paused: boolean): HTMLVideoElement {
  const v = document.createElement("video");
  v.getBoundingClientRect = () => ({ width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, toJSON() {} });
  Object.defineProperty(v, "paused", { value: paused, configurable: true });
  document.body.appendChild(v);
  return v;
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("collectVideos", () => {
  it("finds plain videos in the document", () => {
    vid(640, 360, false);
    vid(320, 180, true);
    expect(collectVideos().length).toBe(2);
  });

  it("pierces open shadow roots", () => {
    const host = document.createElement("div");
    const sr = host.attachShadow({ mode: "open" });
    sr.appendChild(document.createElement("video"));
    document.body.appendChild(host);
    expect(collectVideos().length).toBe(1);
  });
});

describe("primaryVideo", () => {
  it("returns null when there are no videos", () => {
    expect(primaryVideo()).toBeNull();
  });

  it("ignores tiny (<40px) videos", () => {
    vid(30, 30, false);
    expect(primaryVideo()).toBeNull();
  });

  it("prefers a playing video over a larger paused one", () => {
    const paused = vid(1000, 1000, true);
    const playing = vid(100, 100, false);
    expect(primaryVideo()).toBe(playing);
    expect(primaryVideo()).not.toBe(paused);
  });

  it("among playing videos, picks the largest by area", () => {
    vid(200, 200, false);
    const big = vid(800, 450, false);
    expect(primaryVideo()).toBe(big);
  });

  it("falls back to the largest video when all are paused", () => {
    vid(200, 200, true);
    const big = vid(800, 450, true);
    expect(primaryVideo()).toBe(big);
  });
});
