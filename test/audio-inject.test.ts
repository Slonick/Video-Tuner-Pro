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

  it.each(["pause", "ended", "emptied", "abort", "error"])(
    "releases a detached audio element on %s until it plays again",
    (type) => {
      publish("2");
      const a = new Audio();
      captureOnPlay(a);
      expect(a.playbackRate).toBe(2);

      a.dispatchEvent(new Event(type));
      publish("3");
      refreshTracked();
      expect(a.playbackRate).toBe(2);

      captureOnPlay(a);
      expect(a.playbackRate).toBe(3);
    },
  );

  it.each(["pause", "ended", "emptied", "abort"])(
    "keeps an element that is playing again when a queued %s arrives",
    (type) => {
      publish("2");
      const a = new Audio();
      captureOnPlay(a);
      Object.defineProperty(a, "paused", { value: false, configurable: true });

      a.dispatchEvent(new Event(type)); // e.g. src swapped, then play() called at once
      publish("3");
      refreshTracked();
      expect(a.playbackRate).toBe(3);
    },
  );

  it("releases an element whose source failed even though it never paused", () => {
    publish("2");
    const a = new Audio();
    captureOnPlay(a);
    Object.defineProperty(a, "paused", { value: false, configurable: true });

    a.dispatchEvent(new Event("error"));
    publish("3");
    refreshTracked();
    expect(a.playbackRate).toBe(2);
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
    const previous = (window as typeof window & { __vtpAudioBridgeCleanup?: () => void })
      .__vtpAudioBridgeCleanup;
    const cleanup = vi.fn(() => previous?.());
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

  it("wraps the page's current play() on re-install, keeping a page wrapper in the chain", () => {
    const win = window as typeof window & {
      __vtpAudioBridgeInstalled?: boolean | string;
      __vtpAudioBridgeCleanup?: () => void;
    };
    const proto = HTMLMediaElement.prototype;
    win.__vtpAudioBridgeCleanup?.(); // hand play() back to what it was before the bridge
    const original = proto.play;
    try {
      install();
      const bridged = proto.play;
      const pageWrapper = vi.fn(function (this: HTMLMediaElement) {
        return bridged.call(this);
      });
      proto.play = pageWrapper; // the page wraps play() over our hook
      win.__vtpAudioBridgeInstalled = "older-bridge"; // an update ships a new bridge
      install();
      publish("2");
      const a = new Audio();
      try {
        a.play();
      } catch (e) {
        /* ignore jsdom 'not implemented' */
      }

      expect(pageWrapper).toHaveBeenCalledTimes(1);
      expect(a.playbackRate).toBe(2);
    } finally {
      win.__vtpAudioBridgeCleanup?.();
      proto.play = original;
    }
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

  it("releases an element whose play() was refused (it stays paused, no event fires)", () => {
    publish("2");
    const a = new Audio(); // jsdom's play() never starts playback, like a blocked autoplay
    try {
      a.play();
    } catch (e) {
      /* ignore jsdom 'not implemented' */
    }
    publish("3");
    refreshTracked();
    expect(a.playbackRate).toBe(2);
  });

  it("keeps tracking an element whose play() started playback", () => {
    publish("2");
    const a = new Audio();
    Object.defineProperty(a, "paused", { value: false, configurable: true });
    try {
      a.play();
    } catch (e) {
      /* ignore jsdom 'not implemented' */
    }
    publish("3");
    refreshTracked();
    expect(a.playbackRate).toBe(3);
  });
});
