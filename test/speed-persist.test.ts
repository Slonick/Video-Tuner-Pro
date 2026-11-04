// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// speed.ts owns the per-site / per-channel persistence (with the top-frame write
// guards) and setSpeed. Mock the video/live/audio/badge plumbing so we test the
// real persistence + clamp + fallback logic against the in-memory chrome storage.
const h = vi.hoisted(() => ({
  keys: [] as string[],
  videos: [] as HTMLVideoElement[],
  live: false,
  liveVideos: new WeakSet<HTMLVideoElement>(),
  liveReads: 0,
  primaryReads: 0,
  primaryFromReads: 0,
}));
vi.mock("../src/content/channel.js", () => ({ channelKeys: () => h.keys }));
vi.mock("../src/content/videos.js", () => ({
  collectVideos: () => h.videos,
  primaryVideoFrom: (videos: HTMLVideoElement[]) => {
    h.primaryFromReads++;
    return videos[0] ?? null;
  },
  primaryVideo: () => {
    h.primaryReads++;
    return h.videos[0] ?? null;
  },
  seenVideos: new WeakSet(),
}));
vi.mock("../src/content/live/detection.js", () => ({
  isLive: (v: HTMLVideoElement) => {
    h.liveReads++;
    return h.live || h.liveVideos.has(v);
  },
  probeLive: vi.fn(),
  onStreamPage: () => h_onStream(),
  trackDvr: vi.fn(),
  resetDvrFor: vi.fn(),
}));
vi.mock("../src/content/live/sync.js", () => ({ controlLive: vi.fn() }));
vi.mock("../src/content/audio/compressor.js", () => ({ applyAudioComp: vi.fn() }));
vi.mock("../src/content/badge/icon.js", () => ({ updateBadge: vi.fn() }));
vi.mock("../src/content/badge/overlay.js", () => ({
  updateTimeBadge: vi.fn(),
  flashBadge: vi.fn(),
}));

let onStream = false;
const h_onStream = () => onStream;

import { S } from "../src/content/state.js";
import { STORE } from "../src/content/platform/storage.js";
import {
  persistDomainSpeed,
  persistChannelSpeed,
  persistGlobalSpeed,
  resetScope,
  resetToSaved,
  setSpeed,
  applyAll,
  reassertRate,
  reapplyPrimaryRate,
} from "../src/content/speed.js";
import { controlLive } from "../src/content/live/sync.js";
import { trackDvr, resetDvrFor } from "../src/content/live/detection.js";

const get = (keys: string[]): Record<string, unknown> => {
  let out: Record<string, unknown> = {};
  STORE.get(keys, (r) => {
    out = r;
  });
  return out;
};

beforeEach(() => {
  STORE.set({ domains: {}, channels: {} });
  STORE.remove("globalSpeed");
  h.keys = [];
  h.videos = [];
  h.live = false;
  h.liveVideos = new WeakSet<HTMLVideoElement>();
  h.liveReads = 0;
  h.primaryReads = 0;
  h.primaryFromReads = 0;
  onStream = false;
  S.currentSpeed = 1.0;
  S.userSpeed = 1.0;
  S.speedManual = false;
  // jsdom: window is its own top frame by default.
});

const fakeVideo = (rate: number) =>
  ({ playbackRate: rate, addEventListener: vi.fn() }) as unknown as HTMLVideoElement;
afterEach(() => {
  // Restore the top-frame identity if a test overrode it.
  try {
    Object.defineProperty(window, "top", { value: window, configurable: true });
  } catch (e) {
    /* ignore */
  }
});

describe("persistDomainSpeed", () => {
  it("writes the speed under the normalized domain (top frame)", () => {
    persistDomainSpeed(1.75);
    expect((get(["domains"]).domains as Record<string, number>).localhost).toBe(1.75);
  });

  it("does NOT write from a subframe (avoids clobbering the real site's entry)", () => {
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    persistDomainSpeed(1.75);
    expect(get(["domains"]).domains).toEqual({});
  });
});

describe("persistChannelSpeed", () => {
  it("stores under the canonical key and drops the other key form", () => {
    STORE.set({ channels: { "@handle": 1.9 } });
    h.keys = ["UC123", "@handle"];
    persistChannelSpeed(1.25);
    const ch = get(["channels"]).channels as Record<string, number>;
    expect(ch).toEqual({ UC123: 1.25 }); // @handle removed, canonical id written
  });

  it("no-ops when there is no channel (empty keys)", () => {
    h.keys = [];
    persistChannelSpeed(1.25);
    expect(get(["channels"]).channels).toEqual({});
  });

  it("does NOT write from a subframe", () => {
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    h.keys = ["UC123"];
    persistChannelSpeed(1.25);
    expect(get(["channels"]).channels).toEqual({});
  });
});

describe("persistGlobalSpeed", () => {
  it("writes the global speed (top frame)", () => {
    persistGlobalSpeed(1.6);
    expect(get(["globalSpeed"]).globalSpeed).toBe(1.6);
  });

  it("does NOT write from a subframe", () => {
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    persistGlobalSpeed(1.6);
    expect(get(["globalSpeed"]).globalSpeed).toBeUndefined();
  });
});

describe("persist results reported to the caller", () => {
  it("reports a write refused in a subframe as failed", () => {
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    h.keys = ["UC123"];
    const done = vi.fn();

    persistDomainSpeed(1.5, done);
    persistChannelSpeed(1.5, done);
    persistGlobalSpeed(1.5, done);

    expect(done.mock.calls).toEqual([[false], [false], [false]]);
  });

  it("reports a channel write without a channel on the page as failed", () => {
    h.keys = [];
    const done = vi.fn();

    persistChannelSpeed(1.5, done);

    expect(done.mock.calls).toEqual([[false]]);
  });
});

describe("resetScope", () => {
  it("channel: drops every key form and falls back to the per-domain speed", () => {
    STORE.set({ channels: { UC123: 2.0, "@handle": 2.0 }, domains: { localhost: 1.5 } });
    h.keys = ["UC123", "@handle"];
    resetScope("channel");
    expect(get(["channels"]).channels).toBeUndefined();
    expect(S.currentSpeed).toBe(1.5); // fell back to the domain default
  });

  it("channel: with no domain speed, falls back through global", () => {
    STORE.set({ channels: { UC123: 2.0 }, domains: {}, globalSpeed: 1.25 });
    h.keys = ["UC123"];
    resetScope("channel");
    expect(S.currentSpeed).toBe(1.25);
  });

  it("site: clears the domain speed and falls back to global", () => {
    STORE.set({ channels: {}, domains: { localhost: 1.5 }, globalSpeed: 1.2 });
    h.keys = [];
    resetScope("site");
    expect(get(["domains"]).domains).toBeUndefined();
    expect(S.currentSpeed).toBeCloseTo(1.2, 5);
  });

  it("global: clears the global speed and falls back to 100%", () => {
    STORE.set({ channels: {}, domains: {}, globalSpeed: 1.4 });
    h.keys = [];
    resetScope("global");
    expect(get(["globalSpeed"]).globalSpeed).toBeUndefined();
    expect(S.currentSpeed).toBe(1.0);
  });

  it("on a live page updates the saved non-live speed without clobbering live-sync", () => {
    STORE.set({ channels: { UC123: 2.0 }, domains: { localhost: 1.5 }, globalSpeed: 1.25 });
    h.keys = ["UC123"];
    onStream = true;
    S.currentSpeed = 1.05;
    S.userSpeed = 2.0;
    resetScope("channel");
    expect(get(["channels"]).channels).toBeUndefined();
    expect(S.userSpeed).toBe(1.5);
    expect(S.currentSpeed).toBe(1.05);
    expect(S.speedScope).toBe("site");
  });

  it("resetToSaved on a live page refreshes only the intended non-live speed", () => {
    STORE.set({ channels: {}, domains: { localhost: 1.5 } });
    onStream = true;
    S.currentSpeed = 1.1;
    S.userSpeed = 2.0;
    S.speedManual = true;
    resetToSaved();
    expect(S.userSpeed).toBe(1.5);
    expect(S.currentSpeed).toBe(1.1);
    expect(S.speedScope).toBe("site");
    expect(S.speedManual).toBe(false);
  });

  it("resetToSaved clears the manual override and applies the saved speed on VOD", () => {
    STORE.set({ channels: {}, domains: { localhost: 1.5 } });
    S.currentSpeed = 1.9;
    S.userSpeed = 1.9;
    S.speedManual = true;

    resetToSaved();

    expect(S.currentSpeed).toBe(1.5);
    expect(S.userSpeed).toBe(1.5);
    expect(S.speedScope).toBe("site");
    expect(S.speedManual).toBe(false);
  });

  it("resetToSaved prefers a saved channel speed and reports success", () => {
    STORE.set({ channels: { UC123: 2.0 }, domains: { localhost: 1.5 }, globalSpeed: 1.25 });
    h.keys = ["UC123"];
    const done = vi.fn();

    resetToSaved(done);

    expect(S.currentSpeed).toBe(2.0);
    expect(S.speedScope).toBe("channel");
    expect(done.mock.calls).toEqual([[true]]);
  });

  it("reports a failed removal and keeps the manual speed", () => {
    STORE.set({ channels: { UC123: 2.0 }, domains: { localhost: 1.5 } });
    h.keys = ["UC123"];
    S.currentSpeed = 2.0;
    S.userSpeed = 2.0;
    S.speedManual = true;
    const runtime = globalThis.chrome.runtime as unknown as {
      sendMessage: (msg: unknown, cb?: (response: unknown) => void) => void;
    };
    const send = vi.spyOn(runtime, "sendMessage");
    send.mockImplementation((_msg, cb) => cb?.({ success: false }));
    try {
      const done = vi.fn();

      resetScope("channel", done);

      expect(done.mock.calls).toEqual([[false]]);
      expect(S.speedManual).toBe(true); // nothing was re-resolved over the manual speed
    } finally {
      send.mockRestore();
    }
  });

  it("global: a failed removal reports failure and keeps the manual speed", () => {
    STORE.set({ channels: {}, domains: {}, globalSpeed: 1.4 });
    S.currentSpeed = 1.9;
    S.userSpeed = 1.9;
    S.speedManual = true;
    const remove = vi.spyOn(STORE, "remove").mockImplementation((_keys, cb) => cb?.(false));
    try {
      const done = vi.fn();

      resetScope("global", done);
      resetScope("global"); // without a callback it is just as quiet

      expect(done.mock.calls).toEqual([[false]]);
      expect(S.currentSpeed).toBe(1.9);
      expect(S.speedManual).toBe(true);
    } finally {
      remove.mockRestore();
    }
  });

  it("channel: with no channel on the page, reports failure and changes nothing", () => {
    STORE.set({ channels: {}, domains: { localhost: 1.5 } });
    h.keys = [];
    S.currentSpeed = 1.9;
    S.userSpeed = 1.9;
    S.speedManual = true;
    const done = vi.fn();

    resetScope("channel", done);
    resetScope("channel"); // without a callback it is just as quiet

    expect(done.mock.calls).toEqual([[false]]);
    expect(S.currentSpeed).toBe(1.9);
    expect(S.speedManual).toBe(true);
  });

  it("has nothing to drop for the built-in default scope", () => {
    STORE.set({ channels: {}, domains: {}, globalSpeed: 1.25 });
    S.currentSpeed = 1.9;
    S.userSpeed = 1.9;
    S.speedManual = true;
    const done = vi.fn();

    resetScope(null, done);
    resetScope(null); // without a callback it is just as quiet

    expect(done.mock.calls).toEqual([[false]]);
    expect(get(["globalSpeed"]).globalSpeed).toBe(1.25);
    expect(S.currentSpeed).toBe(1.9);
  });
});

describe("setSpeed", () => {
  it("clamps the value and records it as the intended non-live speed", () => {
    setSpeed(99); // far above the cap
    expect(S.currentSpeed).toBe(S.userSpeed);
    expect(S.currentSpeed).toBeLessThanOrEqual(16);
    expect(S.currentSpeed).toBeGreaterThan(1);
  });

  it("marks an in-tab manual speed override", () => {
    setSpeed(1.4, true);
    expect(S.currentSpeed).toBeCloseTo(1.4, 5);
    expect(S.userSpeed).toBeCloseTo(1.4, 5);
    expect(S.speedManual).toBe(true);
  });

  it("ignores a MANUAL change on a live stream page (governed by live-sync)", () => {
    const live = fakeVideo(1);
    h.videos = [live];
    h.liveVideos.add(live);
    onStream = true;
    setSpeed(1.4, true);
    expect(S.currentSpeed).toBe(1.0); // unchanged
  });

  it("allows a manual change on the main VOD even when another video is live", () => {
    const main = fakeVideo(1);
    const livePreview = fakeVideo(1);
    h.videos = [main, livePreview];
    h.liveVideos.add(livePreview);
    onStream = true;

    setSpeed(1.4, true);

    expect(S.currentSpeed).toBeCloseTo(1.4, 5);
    expect(S.userSpeed).toBeCloseTo(1.4, 5);
    expect(S.speedManual).toBe(true);
    expect(main.playbackRate).toBeCloseTo(1.4, 5);
    expect(livePreview.playbackRate).toBe(1);
  });

  it("still applies a non-manual change on a stream page (live-sync's own write)", () => {
    onStream = true;
    setSpeed(1.1, false);
    expect(S.currentSpeed).toBeCloseTo(1.1, 5);
  });
});

describe("applyAll", () => {
  it("does not leak the live catch-up rate onto non-live preview videos", () => {
    const live = document.createElement("video");
    const preview = document.createElement("video");
    h.liveVideos.add(live);
    h.videos = [live, preview];
    onStream = true;
    S.currentSpeed = 1.05; // live-sync catch-up rate
    S.userSpeed = 1.75; // intended non-live rate

    applyAll();

    expect(live.playbackRate).toBe(1);
    expect(preview.playbackRate).toBeCloseTo(1.75, 5);
    expect(preview.defaultPlaybackRate).toBeCloseTo(1.75, 5);
  });

  it("treats a stream page with no primary video as live, like the tick does", () => {
    const small = document.createElement("video");
    onStream = true;
    S.currentSpeed = 1.05; // live-sync catch-up rate
    S.userSpeed = 1.75;

    applyAll({ videos: [small], primary: null });

    expect(small.playbackRate).toBeCloseTo(1.75, 5);
  });

  it("resolves the primary live state once per pass", () => {
    h.videos = [fakeVideo(1), fakeVideo(1), fakeVideo(1), fakeVideo(1)];

    applyAll();

    expect(h.primaryFromReads).toBe(1);
    expect(h.primaryReads).toBe(0);
  });

  it("uses a provided primary snapshot instead of resolving it again", () => {
    const primary = fakeVideo(1);
    h.videos = [primary, fakeVideo(1), fakeVideo(1)];

    applyAll({ videos: h.videos, primary, primaryLive: false });

    expect(h.primaryFromReads).toBe(0);
    expect(h.primaryReads).toBe(0);
  });

  it("reuses the primary live snapshot when applying video rates", () => {
    const primary = fakeVideo(1);
    h.videos = [primary, fakeVideo(1), fakeVideo(1)];

    applyAll({ videos: h.videos, primary, primaryLive: false });

    expect(h.liveReads).toBe(2);
  });
});

describe("dead extension context — never writes", () => {
  let savedId: unknown;
  beforeEach(() => {
    savedId = globalThis.chrome.runtime.id;
    (globalThis.chrome.runtime as { id?: unknown }).id = undefined;
  });
  afterEach(() => {
    (globalThis.chrome.runtime as { id?: unknown }).id = savedId;
  });

  it("persistDomainSpeed bails when the context is gone", () => {
    persistDomainSpeed(1.5);
    expect(get(["domains"]).domains).toEqual({});
  });

  it("persistChannelSpeed bails when the context is gone", () => {
    h.keys = ["UC1"];
    persistChannelSpeed(1.5);
    expect(get(["channels"]).channels).toEqual({});
  });

  it("resetScope bails when the context is gone", () => {
    STORE.set({ channels: { UC1: 2.0 } });
    h.keys = ["UC1"];
    resetScope("channel");
    expect((get(["channels"]).channels as Record<string, number>).UC1).toBe(2.0); // untouched
  });

  it("persistGlobalSpeed bails when the context is gone", () => {
    persistGlobalSpeed(1.5);
    expect(get(["globalSpeed"]).globalSpeed).toBeUndefined();
  });

  it("reports every refused write or reset to its caller as failed", () => {
    h.keys = ["UC1"];
    const done = vi.fn();

    persistDomainSpeed(1.5, done);
    persistChannelSpeed(1.5, done);
    persistGlobalSpeed(1.5, done);
    resetScope("site", done);
    resetToSaved(done);

    expect(done.mock.calls).toEqual([[false], [false], [false], [false], [false]]);
  });

  it("resetToSaved keeps the current speed when the context is gone", () => {
    STORE.set({ channels: {}, domains: { localhost: 1.5 } });
    S.currentSpeed = 1.9;
    S.userSpeed = 1.9;
    S.speedManual = true;

    resetToSaved(); // the R hotkey passes no callback

    expect(S.currentSpeed).toBe(1.9);
    expect(S.speedManual).toBe(true);
  });
});

describe("applyToVideo (via applyAll)", () => {
  it("writes the current speed onto a non-live video", () => {
    const v = fakeVideo(1.0);
    h.videos = [v];
    setSpeed(1.75);
    expect(v.playbackRate).toBeCloseTo(1.75, 5);
  });

  it("does NOT re-assign playbackRate when it already matches (avoids the audio glitch)", () => {
    let writes = 0,
      current = 1.5;
    const v = { addEventListener: vi.fn() } as unknown as HTMLVideoElement;
    Object.defineProperty(v, "playbackRate", {
      get: () => current,
      set: (x: number) => {
        writes++;
        current = x;
      },
    });
    h.videos = [v];
    setSpeed(1.5); // equal → no write
    expect(writes).toBe(0);
    setSpeed(1.6); // differs → one write
    expect(writes).toBe(1);
    expect(current).toBeCloseTo(1.6, 5);
  });

  it("leaves a live video's rate alone (owned by live-sync)", () => {
    const v = fakeVideo(1.0);
    h.videos = [v];
    h.live = true;
    setSpeed(1.75);
    expect(v.playbackRate).toBe(1.0); // untouched
  });

  it("registers playback listeners exactly once per video", () => {
    const v = fakeVideo(1.0);
    h.videos = [v];
    setSpeed(1.5);
    const callsAfterFirst = (v.addEventListener as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    setSpeed(1.6); // same video again — seenVideos guard prevents re-wiring
    expect((v.addEventListener as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      callsAfterFirst,
    );
  });

  it("does NOT re-seed defaultPlaybackRate when it already matches", () => {
    let seeds = 0,
      seeded = 1;
    const v = fakeVideo(1);
    Object.defineProperty(v, "defaultPlaybackRate", {
      get: () => seeded,
      set: (x: number) => {
        seeds++;
        seeded = x;
      },
    });
    h.videos = [v];
    setSpeed(1.5); // differs → one write
    expect(seeds).toBe(1);
    setSpeed(1.5); // equal → no write
    expect(seeds).toBe(1);
  });
});

describe("reassertRate", () => {
  afterEach(() => {
    S.autoSlowEnabled = false;
    S.audioSpeedEnabled = false;
    h.live = false;
  });

  it("reassertRate re-applies to a non-live <video> and skips a live one", () => {
    S.currentSpeed = 1.25;
    const v = document.createElement("video");
    reassertRate(v);
    expect(v.playbackRate).toBeCloseTo(1.25, 5);
    const live = document.createElement("video");
    h.live = true;
    reassertRate(live);
    expect(live.playbackRate).toBe(1); // live → owned by live-sync, untouched
  });

  it("reassertRate touches <audio> only when the audio-speed toggle is on", () => {
    S.currentSpeed = 1.3;
    const a = document.createElement("audio");
    S.audioSpeedEnabled = false;
    reassertRate(a);
    expect(a.playbackRate).toBe(1);
    S.audioSpeedEnabled = true;
    reassertRate(a);
    expect(a.playbackRate).toBeCloseTo(1.3, 5);
  });

  it("applyAll writes the auto-slowed rate, forces preservesPitch, seeds the intended default", () => {
    const v = {
      playbackRate: 1,
      defaultPlaybackRate: 1,
      preservesPitch: false,
      addEventListener: vi.fn(),
    } as unknown as HTMLVideoElement;
    h.videos = [v];
    S.currentSpeed = 2;
    S.autoSlowEnabled = true;
    S.autoSlowFactor = 0.5;
    applyAll();
    expect(v.playbackRate).toBeCloseTo(1, 5); // 2 × 0.5 (auto-slowed)
    expect(v.preservesPitch).toBe(true); // pitch kept natural
    expect(v.defaultPlaybackRate).toBeCloseTo(2, 5); // seeded at the intended speed
  });
});

describe("per-element listeners (wired by applyAll)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(controlLive).mockClear();
    vi.mocked(trackDvr).mockClear();
    vi.mocked(resetDvrFor).mockClear();
    S.currentSpeed = 1.5;
    S.userSpeed = 1.5;
  });
  afterEach(() => {
    vi.runOnlyPendingTimers(); // settle a throttled live re-evaluation before the next test
    vi.useRealTimers();
    S.siteDisabled = false;
  });

  function wiredVideo(): HTMLVideoElement {
    const v = document.createElement("video");
    h.videos = [v];
    applyAll();
    return v;
  }

  it("re-asserts the speed when the page's player changes the rate", () => {
    const v = wiredVideo();
    expect(v.playbackRate).toBe(1.5);

    v.playbackRate = 1;
    v.dispatchEvent(new Event("ratechange"));

    expect(v.playbackRate).toBe(1.5);
  });

  it("re-applies the current speed when playback starts or new data loads", () => {
    const v = wiredVideo();

    S.currentSpeed = 2;
    v.dispatchEvent(new Event("play"));
    expect(v.playbackRate).toBe(2);

    S.currentSpeed = 2.5;
    v.dispatchEvent(new Event("loadeddata"));
    expect(v.playbackRate).toBe(2.5);
  });

  it("leaves a live video's rate to live-sync", () => {
    const v = document.createElement("video");
    h.liveVideos.add(v);
    h.videos = [v];
    S.currentSpeed = 1.05;
    S.userSpeed = 1.75;
    applyAll();

    v.playbackRate = 1.2; // live-sync's catch-up write
    v.dispatchEvent(new Event("ratechange"));
    v.dispatchEvent(new Event("play"));

    expect(v.playbackRate).toBe(1.2);
  });

  it("feeds DVR tracking on seeking/timeupdate and resets it on new metadata", () => {
    const v = wiredVideo();

    v.dispatchEvent(new Event("seeking"));
    expect(trackDvr).toHaveBeenCalledTimes(1);
    v.dispatchEvent(new Event("timeupdate"));
    expect(trackDvr).toHaveBeenCalledTimes(2);
    expect(vi.mocked(trackDvr).mock.calls.every(([video]) => video === v)).toBe(true);
    expect(resetDvrFor).not.toHaveBeenCalled();

    v.dispatchEvent(new Event("loadedmetadata"));
    expect(resetDvrFor).toHaveBeenCalledOnce();
    expect(vi.mocked(resetDvrFor).mock.calls[0][0]).toBe(v);
  });

  it("re-evaluates live state when the duration or the metadata changes", () => {
    const v = wiredVideo();

    v.dispatchEvent(new Event("durationchange"));
    expect(controlLive).toHaveBeenCalledTimes(1);
    v.dispatchEvent(new Event("loadedmetadata"));
    expect(controlLive).toHaveBeenCalledTimes(2);
  });

  it("re-evaluates live state at most once per 250 ms of playback progress", () => {
    const v = wiredVideo();

    v.dispatchEvent(new Event("timeupdate"));
    v.dispatchEvent(new Event("timeupdate"));
    vi.advanceTimersByTime(249);
    v.dispatchEvent(new Event("timeupdate"));
    expect(controlLive).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(controlLive).toHaveBeenCalledOnce();

    v.dispatchEvent(new Event("timeupdate"));
    vi.advanceTimersByTime(250);
    expect(controlLive).toHaveBeenCalledTimes(2);
  });

  it("schedules no live re-evaluation on a blacklisted site", () => {
    const v = wiredVideo();
    S.siteDisabled = true;

    v.dispatchEvent(new Event("timeupdate"));
    vi.advanceTimersByTime(250);

    expect(controlLive).not.toHaveBeenCalled();
  });
});

describe("reapplyPrimaryRate", () => {
  afterEach(() => {
    S.autoSlowEnabled = false;
    S.autoSlowFactor = 1;
  });

  it("re-asserts the auto-slowed rate on the primary video right away", () => {
    const v = document.createElement("video");
    h.videos = [v];
    S.currentSpeed = 1.6;
    S.autoSlowEnabled = true;
    S.autoSlowFactor = 0.5;

    reapplyPrimaryRate();

    expect(v.playbackRate).toBeCloseTo(0.8, 5);
    expect(v.defaultPlaybackRate).toBeCloseTo(1.6, 5);
  });

  it("leaves a live primary video to live-sync", () => {
    const v = document.createElement("video");
    h.videos = [v];
    h.liveVideos.add(v);
    S.currentSpeed = 1.6;
    S.userSpeed = 1.6;

    reapplyPrimaryRate();

    expect(v.playbackRate).toBe(1);
  });
});

describe("content teardown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels a pending live re-evaluation when the content script is torn down", async () => {
    // A fresh module graph: aborting its lifecycle must not silence the other tests' listeners.
    vi.resetModules();
    const fresh = await import("../src/content/speed.js");
    const { abortContentListeners } = await import("../src/content/lifecycle.js");
    const { controlLive: freshControlLive } = await import("../src/content/live/sync.js");
    vi.mocked(freshControlLive).mockClear();
    vi.useFakeTimers();
    const v = document.createElement("video");
    h.videos = [v];
    fresh.applyAll();

    v.dispatchEvent(new Event("timeupdate"));
    vi.advanceTimersByTime(250);
    expect(freshControlLive).toHaveBeenCalledOnce(); // the throttled re-evaluation is live here

    v.dispatchEvent(new Event("timeupdate"));
    abortContentListeners();
    vi.advanceTimersByTime(250);

    expect(freshControlLive).toHaveBeenCalledOnce();
  });
});
