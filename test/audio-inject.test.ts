// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  desiredRate,
  applyRate,
  captureOnPlay,
  refreshTracked,
  install,
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
const activeBridgeVersion = (
  window as typeof window & { __vtpAudioBridgeInstalled?: boolean | string }
).__vtpAudioBridgeInstalled;

beforeEach(() => {
  (window as typeof window & { __vtpAudioBridgeCleanup?: () => void }).__vtpAudioBridgeCleanup?.();
  (
    window as typeof window & { __vtpAudioBridgeInstalled?: boolean | string }
  ).__vtpAudioBridgeInstalled = undefined;
  install();
  publish(null);
});

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

  it("stops capturing after a newer bridge version takes ownership", () => {
    publish("2");
    (window as typeof window & { __vtpAudioBridgeInstalled?: string }).__vtpAudioBridgeInstalled =
      "newer-bridge";

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

  it("stops driving a tracked audio element after it is connected to the page", () => {
    publish("2");
    const a = document.createElement("audio");
    captureOnPlay(a);
    expect(a.playbackRate).toBe(2);

    document.body.appendChild(a);
    publish("3");
    refreshTracked();
    expect(a.playbackRate).toBe(2);
  });

  it("releases a finished detached audio element until it plays again", () => {
    publish("2");
    const a = new Audio();
    captureOnPlay(a);
    expect(a.playbackRate).toBe(2);

    a.dispatchEvent(new Event("ended"));
    publish("3");
    refreshTracked();
    expect(a.playbackRate).toBe(2);

    captureOnPlay(a);
    expect(a.playbackRate).toBe(3);
  });

  it("stops refreshing tracked audio after a newer bridge version takes ownership", () => {
    publish("2");
    const a = new Audio();
    captureOnPlay(a);
    expect(a.playbackRate).toBe(2);

    (window as typeof window & { __vtpAudioBridgeInstalled?: string }).__vtpAudioBridgeInstalled =
      "newer-bridge";
    publish("3");
    refreshTracked();

    expect(a.playbackRate).toBe(2);
  });

  it("stops reapplying from tracked media events after a newer bridge takes ownership", () => {
    publish("2");
    const a = new Audio();
    captureOnPlay(a);
    expect(a.playbackRate).toBe(2);

    (window as typeof window & { __vtpAudioBridgeInstalled?: string }).__vtpAudioBridgeInstalled =
      "newer-bridge";
    publish("3");
    a.dispatchEvent(new Event("ratechange"));

    expect(a.playbackRate).toBe(2);
  });
});

describe("install", () => {
  it("takes ownership from the old boolean install guard", () => {
    (
      window as typeof window & { __vtpAudioBridgeInstalled?: boolean | string }
    ).__vtpAudioBridgeInstalled = true;

    install();

    expect(
      (window as typeof window & { __vtpAudioBridgeInstalled?: boolean | string })
        .__vtpAudioBridgeInstalled,
    ).toBe(activeBridgeVersion);
  });

  it("runs the previous bridge cleanup when taking ownership", () => {
    const cleanup = vi.fn();
    (
      window as typeof window & {
        __vtpAudioBridgeInstalled?: boolean | string;
        __vtpAudioBridgeCleanup?: () => void;
      }
    ).__vtpAudioBridgeInstalled = "older-bridge";
    (
      window as typeof window & {
        __vtpAudioBridgeCleanup?: () => void;
      }
    ).__vtpAudioBridgeCleanup = cleanup;

    install();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(
      (window as typeof window & { __vtpAudioBridgeInstalled?: boolean | string })
        .__vtpAudioBridgeInstalled,
    ).toBe(activeBridgeVersion);
  });

  it("removes tracked media listeners during cleanup", () => {
    publish("2");
    const a = new Audio();
    captureOnPlay(a);
    expect(a.playbackRate).toBe(2);

    (
      window as typeof window & { __vtpAudioBridgeCleanup?: () => void }
    ).__vtpAudioBridgeCleanup?.();
    publish("3");
    a.playbackRate = 1;
    a.dispatchEvent(new Event("ratechange"));

    expect(a.playbackRate).toBe(1);
    install();
    expect(
      (window as typeof window & { __vtpAudioBridgeInstalled?: boolean | string })
        .__vtpAudioBridgeInstalled,
    ).toBe(activeBridgeVersion);
  });

  it("does not clear a newer bridge owner from an old cleanup callback", () => {
    install();
    const cleanup = (window as typeof window & { __vtpAudioBridgeCleanup?: () => void })
      .__vtpAudioBridgeCleanup!;

    (window as typeof window & { __vtpAudioBridgeInstalled?: unknown }).__vtpAudioBridgeInstalled =
      "newer-bridge";
    cleanup();

    expect(
      (window as typeof window & { __vtpAudioBridgeInstalled?: unknown }).__vtpAudioBridgeInstalled,
    ).toBe("newer-bridge");
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
