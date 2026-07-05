// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { collectVideos, primaryVideo } from "../src/content/videos.js";

// Helper: a <video> with a stubbed bounding box and paused state (jsdom returns
// a zero-size rect and no real playback).
function vid(width: number, height: number, paused: boolean): HTMLVideoElement {
  const v = document.createElement("video");
  v.getBoundingClientRect = () => ({
    width,
    height,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON() {},
  });
  Object.defineProperty(v, "paused", { value: paused, configurable: true });
  document.body.appendChild(v);
  return v;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

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

  it("prefers a similarly sized playing video over a paused one", () => {
    const paused = vid(1000, 1000, true);
    const playing = vid(800, 600, false);
    expect(primaryVideo()).toBe(playing);
    expect(primaryVideo()).not.toBe(paused);
  });

  it("does not let a tiny playing preview beat the main video", () => {
    const main = vid(1000, 1000, true);
    vid(160, 90, false);
    expect(primaryVideo()).toBe(main);
  });

  it("ignores videos inside the extension viewer overlay", () => {
    const main = vid(1000, 1000, true);
    const overlay = document.createElement("div");
    overlay.setAttribute("data-vtp-viewer-overlay", "");
    document.body.appendChild(overlay);
    const background = document.createElement("video");
    background.getBoundingClientRect = () =>
      ({
        width: 2000,
        height: 1200,
        left: -48,
        top: -48,
        right: 1952,
        bottom: 1152,
        x: -48,
        y: -48,
        toJSON() {},
      }) as DOMRect;
    Object.defineProperty(background, "paused", { value: false, configurable: true });
    overlay.appendChild(background);
    expect(primaryVideo()).toBe(main);
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
