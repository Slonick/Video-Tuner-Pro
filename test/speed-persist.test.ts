// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// speed.ts owns the per-site / per-channel persistence (with the top-frame write
// guards) and setSpeed. Mock the video/live/audio/badge plumbing so we test the
// real persistence + clamp + fallback logic against the in-memory chrome storage.
const h = vi.hoisted(() => ({
  keys: [] as string[],
  videos: [] as HTMLVideoElement[],
  live: false,
}));
vi.mock("../src/content/channel.js", () => ({ channelKeys: () => h.keys }));
vi.mock("../src/content/videos.js", () => ({
  collectVideos: () => h.videos,
  seenVideos: new WeakSet(),
}));
vi.mock("../src/content/live/detection.js", () => ({
  isLive: () => h.live,
  probeLive: vi.fn(),
  onStreamPage: () => h_onStream(),
  trackDvr: vi.fn(),
  resetDvr: vi.fn(),
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
  setSpeed,
} from "../src/content/speed.js";

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
  onStream = false;
  S.currentSpeed = 1.0;
  S.userSpeed = 1.0;
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

describe("resetScope", () => {
  it("channel: drops every key form and falls back to the per-domain speed", () => {
    STORE.set({ channels: { UC123: 2.0, "@handle": 2.0 }, domains: { localhost: 1.5 } });
    h.keys = ["UC123", "@handle"];
    resetScope("channel");
    expect(get(["channels"]).channels).toEqual({});
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
    expect(get(["domains"]).domains).toEqual({});
    expect(S.currentSpeed).toBeCloseTo(1.2, 5);
  });

  it("global: clears the global speed and falls back to 100%", () => {
    STORE.set({ channels: {}, domains: {}, globalSpeed: 1.4 });
    h.keys = [];
    resetScope("global");
    expect(get(["globalSpeed"]).globalSpeed).toBeUndefined();
    expect(S.currentSpeed).toBe(1.0);
  });
});

describe("setSpeed", () => {
  it("clamps the value and records it as the intended non-live speed", () => {
    setSpeed(99); // far above the cap
    expect(S.currentSpeed).toBe(S.userSpeed);
    expect(S.currentSpeed).toBeLessThanOrEqual(16);
    expect(S.currentSpeed).toBeGreaterThan(1);
  });

  it("persists to the domain only when asked", () => {
    setSpeed(1.4, true);
    expect((get(["domains"]).domains as Record<string, number>).localhost).toBe(1.4);
  });

  it("ignores a MANUAL change on a live stream page (governed by live-sync)", () => {
    onStream = true;
    setSpeed(1.4, false, true);
    expect(S.currentSpeed).toBe(1.0); // unchanged
  });

  it("still applies a non-manual change on a stream page (live-sync's own write)", () => {
    onStream = true;
    setSpeed(1.1, false, false);
    expect(S.currentSpeed).toBeCloseTo(1.1, 5);
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
});
