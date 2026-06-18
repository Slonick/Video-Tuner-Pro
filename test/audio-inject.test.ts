// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  desiredRate,
  applyRate,
  captureOnPlay,
  refreshTracked,
} from "../src/content/audio-inject.js";

// The MAIN-world bridge that drives DETACHED <audio> (e.g. SoundCloud's
// `new Audio()`), which the isolated content script can't reach. The desired rate
// arrives through the data-vtp-audiorate attribute on <html>; importing the module
// also patches HTMLMediaElement.prototype.play (its install() runs on import).
const ATTR = "data-vtp-audiorate";
const publish = (v: string | null) =>
  v == null
    ? document.documentElement.removeAttribute(ATTR)
    : document.documentElement.setAttribute(ATTR, v);

beforeEach(() => publish(null));

describe("desiredRate (reads data-vtp-audiorate)", () => {
  it("is null when the attribute is absent (toggle off)", () => {
    expect(desiredRate()).toBeNull();
  });
  it("parses a positive value", () => {
    publish("1.75");
    expect(desiredRate()).toBe(1.75);
  });
  it("is null for non-positive / garbage", () => {
    publish("0");
    expect(desiredRate()).toBeNull();
    publish("nope");
    expect(desiredRate()).toBeNull();
  });
});

describe("applyRate", () => {
  it("seeds defaultPlaybackRate + playbackRate and keeps pitch natural", () => {
    const a = new Audio();
    (a as unknown as { preservesPitch: boolean }).preservesPitch = false;
    applyRate(a, 2);
    expect(a.playbackRate).toBe(2);
    expect(a.defaultPlaybackRate).toBe(2);
    expect((a as unknown as { preservesPitch: boolean }).preservesPitch).toBe(true);
  });

  it("skips a redundant playbackRate write (diff guard)", () => {
    const a = new Audio();
    let writes = 0;
    Object.defineProperty(a, "playbackRate", {
      get: () => 1.5,
      set: () => {
        writes++;
      },
      configurable: true,
    });
    applyRate(a, 1.5);
    expect(writes).toBe(0);
  });
});

describe("captureOnPlay", () => {
  it("brings a detached <audio> to the current bridged rate", () => {
    publish("2");
    const a = new Audio(); // detached: isConnected === false
    captureOnPlay(a);
    expect(a.playbackRate).toBe(2);
  });

  it("leaves connected <audio> alone — the isolated world owns it", () => {
    publish("2");
    const a = document.createElement("audio");
    document.body.appendChild(a);
    captureOnPlay(a);
    expect(a.playbackRate).toBe(1);
  });

  it("ignores non-audio media and bad inputs without throwing", () => {
    publish("2");
    const v = document.createElement("video");
    captureOnPlay(v);
    expect(v.playbackRate).toBe(1);
    expect(() => captureOnPlay(null)).not.toThrow();
    expect(() => captureOnPlay(undefined)).not.toThrow();
  });

  it("is a no-op while the toggle is off (no attribute)", () => {
    const a = new Audio();
    captureOnPlay(a);
    expect(a.playbackRate).toBe(1);
  });
});

describe("refreshTracked (mid-playback bridge changes)", () => {
  it("re-applies a speed change to an already-playing detached <audio>", () => {
    publish("1.5");
    const a = new Audio();
    captureOnPlay(a);
    expect(a.playbackRate).toBe(1.5);

    publish("3"); // user changed speed while the track plays
    refreshTracked();
    expect(a.playbackRate).toBe(3);
  });

  it("resets tracked audio to 1× when the toggle goes off", () => {
    publish("2");
    const a = new Audio();
    captureOnPlay(a);
    expect(a.playbackRate).toBe(2);

    publish(null); // toggle off → attribute removed
    refreshTracked();
    expect(a.playbackRate).toBe(1);
  });
});

describe("the patched play() hook (install ran on import)", () => {
  it("captures a detached <audio> when play() is called", () => {
    publish("2");
    const a = new Audio();
    try {
      a.play(); // jsdom's native play is a no-op stub; the hook still runs first
    } catch (e) {
      /* ignore jsdom 'not implemented' */
    }
    expect(a.playbackRate).toBe(2);
  });
});
