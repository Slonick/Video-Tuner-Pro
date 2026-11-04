// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A blacklisted site must keep the page's own playback rate: nothing in speed.ts may
// write one, publish the audio-rate bridge or keep re-asserting from the per-element
// listeners that were registered before the switch-off. resetMedia is the one write
// that IS wanted — the hand-back to 1× when a running page is switched off.
const h = vi.hoisted(() => ({
  videos: [] as HTMLVideoElement[],
  audios: [] as HTMLAudioElement[],
}));
vi.mock("../src/content/channel.js", () => ({ channelKeys: () => [] as string[] }));
vi.mock("../src/content/videos.js", () => ({
  collectVideos: () => h.videos,
  collectAudios: () => h.audios,
  primaryVideoFrom: (videos: HTMLVideoElement[]) => videos[0] ?? null,
  primaryVideo: () => h.videos[0] ?? null,
  seenVideos: new WeakSet(),
  seenAudios: new WeakSet(),
}));
vi.mock("../src/content/live/detection.js", () => ({
  isLive: () => false,
  probeLive: vi.fn(),
  onStreamPage: () => false,
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

import { S } from "../src/content/state.js";
import {
  applyAll,
  setSpeed,
  reapplyPrimaryRate,
  resetAudios,
  resetMedia,
} from "../src/content/speed.js";
import { applyAudioComp } from "../src/content/audio/compressor.js";
import { updateBadge } from "../src/content/badge/icon.js";
import { updateTimeBadge, flashBadge } from "../src/content/badge/overlay.js";
import { probeLive } from "../src/content/live/detection.js";

const ATTR = "data-vtp-audiorate";
const attr = () => document.documentElement.getAttribute(ATTR);

function media<T extends HTMLMediaElement>(tag: "video" | "audio", rate: number): T {
  const el = document.createElement(tag) as T;
  el.playbackRate = rate;
  el.defaultPlaybackRate = rate;
  return el;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.videos = [];
  h.audios = [];
  document.documentElement.removeAttribute(ATTR);
  S.siteDisabled = false;
  S.currentSpeed = 1.5;
  S.userSpeed = 1.5;
  S.speedManual = false;
  S.audioSpeedEnabled = false;
  S.autoSlowEnabled = false;
  S.autoSlowFactor = 1;
});
afterEach(() => {
  S.siteDisabled = false;
});

describe("speed on an enabled site (control)", () => {
  it("applies the speed to videos and audios", () => {
    const v = media<HTMLVideoElement>("video", 1);
    const a = media<HTMLAudioElement>("audio", 1);
    h.videos = [v];
    h.audios = [a];
    S.audioSpeedEnabled = true;

    applyAll();

    expect(v.playbackRate).toBe(1.5);
    expect(v.defaultPlaybackRate).toBe(1.5);
    expect(a.playbackRate).toBe(1.5);
    expect(attr()).toBe("1.5");
    expect(updateBadge).toHaveBeenCalled();
  });
});

describe("speed on a blacklisted site", () => {
  beforeEach(() => {
    S.siteDisabled = true;
  });

  it("applyAll writes no rate, publishes no bridge and sends no toolbar badge", () => {
    const v = media<HTMLVideoElement>("video", 2);
    const a = media<HTMLAudioElement>("audio", 0.75);
    h.videos = [v];
    h.audios = [a];
    S.audioSpeedEnabled = true;

    applyAll();

    expect(v.playbackRate).toBe(2);
    expect(v.defaultPlaybackRate).toBe(2);
    expect(a.playbackRate).toBe(0.75);
    expect(attr()).toBeNull();
    expect(applyAudioComp).not.toHaveBeenCalled();
    expect(updateBadge).not.toHaveBeenCalled();
  });

  it("a manual speed change is ignored: S and the page stay as they were", () => {
    const v = media<HTMLVideoElement>("video", 2);
    h.videos = [v];

    setSpeed(3, true);

    expect(S.currentSpeed).toBe(1.5);
    expect(S.speedManual).toBe(false);
    expect(v.playbackRate).toBe(2);
    expect(updateTimeBadge).not.toHaveBeenCalled();
  });

  it("per-element listeners registered before the switch-off stop re-asserting the rate", () => {
    const v = media<HTMLVideoElement>("video", 1);
    h.videos = [v];
    S.siteDisabled = false;
    applyAll(); // registers play/loadeddata/ratechange re-apply on v
    expect(v.playbackRate).toBe(1.5);

    S.siteDisabled = true;
    v.playbackRate = 3; // the page's own player takes over
    v.dispatchEvent(new Event("ratechange"));
    v.dispatchEvent(new Event("play"));
    v.dispatchEvent(new Event("loadeddata"));

    expect(v.playbackRate).toBe(3);
  });

  it("the audio re-apply listeners are quiet too", () => {
    const a = media<HTMLAudioElement>("audio", 1);
    h.audios = [a];
    S.audioSpeedEnabled = true;
    S.siteDisabled = false;
    applyAll();
    expect(a.playbackRate).toBe(1.5);

    S.siteDisabled = true;
    a.playbackRate = 1;
    a.dispatchEvent(new Event("ratechange"));

    expect(a.playbackRate).toBe(1);
  });

  it("the auto-slow re-assert is a no-op", () => {
    const v = media<HTMLVideoElement>("video", 2);
    h.videos = [v];
    S.autoSlowEnabled = true;
    S.autoSlowFactor = 0.5;

    reapplyPrimaryRate();

    expect(v.playbackRate).toBe(2);
  });

  it("clears an audio-rate bridge that was published while the site was on", () => {
    S.audioSpeedEnabled = true;
    document.documentElement.setAttribute(ATTR, "1.5");

    resetAudios();

    expect(attr()).toBeNull();
  });
});

describe("resetMedia (the hand-back when a running page is switched off)", () => {
  it("puts every video and audio back at 1× and clears the audio-rate bridge", () => {
    const v1 = media<HTMLVideoElement>("video", 2);
    const v2 = media<HTMLVideoElement>("video", 0.5);
    const a = media<HTMLAudioElement>("audio", 1.75);
    h.videos = [v1, v2];
    h.audios = [a];
    S.audioSpeedEnabled = true;
    document.documentElement.setAttribute(ATTR, "1.75");
    S.siteDisabled = true; // setSiteDisabled flips this before it calls resetMedia

    resetMedia();

    for (const el of [v1, v2, a]) {
      expect(el.playbackRate).toBe(1);
      expect(el.defaultPlaybackRate).toBe(1);
    }
    expect(attr()).toBeNull();
  });

  it("survives a player that rejects the write", () => {
    const v = media<HTMLVideoElement>("video", 2);
    Object.defineProperty(v, "playbackRate", {
      get: () => 2,
      set: () => {
        throw new DOMException("not ready", "NotSupportedError");
      },
    });
    const ok = media<HTMLVideoElement>("video", 2);
    h.videos = [v, ok];

    expect(() => resetMedia()).not.toThrow();
    expect(ok.playbackRate).toBe(1);
  });
});

describe("applyAll and setSpeed side effects on an enabled site", () => {
  it("samples every video for live detection and hands them to the compressor", () => {
    const main = media<HTMLVideoElement>("video", 1);
    const other = media<HTMLVideoElement>("video", 1);
    h.videos = [main, other];

    applyAll();

    const probed = vi.mocked(probeLive).mock.calls.map(([v]) => v);
    expect(probed).toHaveLength(2);
    expect(probed[0]).toBe(main);
    expect(probed[1]).toBe(other);
    expect(applyAudioComp).toHaveBeenCalledOnce();
    expect(vi.mocked(applyAudioComp).mock.calls[0][0]).toBe(h.videos);
    expect(vi.mocked(applyAudioComp).mock.calls[0][1]).toBe(main);
  });

  it("setSpeed refreshes the time badge and flashes the new speed", () => {
    setSpeed(2);

    expect(updateTimeBadge).toHaveBeenCalledOnce();
    expect(flashBadge).toHaveBeenCalledOnce();
  });
});

describe("audio on an enabled site", () => {
  beforeEach(() => {
    S.audioSpeedEnabled = true;
  });

  it("re-asserts the speed when the page's player changes an <audio> rate", () => {
    const a = media<HTMLAudioElement>("audio", 1);
    h.audios = [a];
    applyAll();

    a.playbackRate = 1;
    a.dispatchEvent(new Event("ratechange"));

    expect(a.playbackRate).toBe(1.5);
  });

  it("re-applies the current speed when an <audio> starts or loads", () => {
    const a = media<HTMLAudioElement>("audio", 1);
    h.audios = [a];
    applyAll();

    S.currentSpeed = 2;
    a.dispatchEvent(new Event("play"));
    expect(a.playbackRate).toBe(2);

    S.currentSpeed = 2.5;
    a.dispatchEvent(new Event("loadeddata"));
    expect(a.playbackRate).toBe(2.5);
  });

  it("wires an <audio> only once however often applyAll runs", () => {
    const a = media<HTMLAudioElement>("audio", 1);
    const wire = vi.spyOn(a, "addEventListener");
    h.audios = [a];

    applyAll();
    const wired = wire.mock.calls.length;
    applyAll();

    expect(wired).toBeGreaterThan(0);
    expect(wire.mock.calls.length).toBe(wired);
  });

  it("publishes the audio-rate bridge only when the rate actually changes", () => {
    const writes = new MutationObserver(() => {});
    writes.observe(document.documentElement, { attributes: true, attributeFilter: [ATTR] });
    try {
      applyAll();
      applyAll(); // same speed: no second write for the page world's attribute observer
      expect(writes.takeRecords()).toHaveLength(1);

      S.currentSpeed = 2;
      applyAll();
      expect(writes.takeRecords()).toHaveLength(1);
      expect(attr()).toBe("2");
    } finally {
      writes.disconnect();
    }
  });
});
