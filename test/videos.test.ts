// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { collectVideos, isDrmVideo, markDrmVideo, primaryVideo } from "../src/content/videos.js";

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

  it("keeps an adopted viewer video controllable inside the overlay", () => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-vtp-viewer-overlay", "");
    document.body.appendChild(overlay);
    const adopted = document.createElement("video");
    adopted.setAttribute("data-vtp-viewer-adopted-video", "");
    adopted.getBoundingClientRect = () =>
      ({
        width: 1000,
        height: 600,
        left: 0,
        top: 0,
        right: 1000,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON() {},
      }) as DOMRect;
    Object.defineProperty(adopted, "paused", { value: false, configurable: true });
    overlay.appendChild(adopted);
    expect(collectVideos()).toContain(adopted);
    expect(primaryVideo()).toBe(adopted);
  });

  it("does not keep mirror or backdrop videos in the overlay", () => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-vtp-viewer-overlay", "");
    document.body.appendChild(overlay);
    const mirror = document.createElement("video");
    mirror.getBoundingClientRect = () =>
      ({
        width: 1000,
        height: 600,
        left: 0,
        top: 0,
        right: 1000,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON() {},
      }) as DOMRect;
    Object.defineProperty(mirror, "paused", { value: false, configurable: true });
    overlay.appendChild(mirror);
    expect(collectVideos()).not.toContain(mirror);
    expect(primaryVideo()).toBeNull();
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

describe("DRM detection", () => {
  it("marks a video as protected", () => {
    const v = vid(640, 360, false);
    expect(isDrmVideo(v)).toBe(false);
    markDrmVideo(v);
    expect(isDrmVideo(v)).toBe(true);
  });

  it("treats mediaKeys as protected even before the encrypted event reaches us", () => {
    const v = vid(640, 360, false);
    Object.defineProperty(v, "mediaKeys", { value: {}, configurable: true });
    expect(isDrmVideo(v)).toBe(true);
  });
});
