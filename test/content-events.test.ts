// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  applyAll: vi.fn(),
  controlLive: vi.fn(),
  updateTimeBadge: vi.fn(),
  updateLauncher: vi.fn(),
  flashBadge: vi.fn(),
  showBadgeNotice: vi.fn(),
  startTracking: vi.fn(),
  stopTracking: vi.fn(),
  reconcile: vi.fn(),
  markDrmVideo: vi.fn(),
  exitViewer: vi.fn(),
  maybeAutoOpenViewer: vi.fn(),
  maybeAutoOpenPlayingPrimary: vi.fn(),
  resetMedia: vi.fn(),
  releaseAutoSlow: vi.fn(),
  applyAudioComp: vi.fn(),
  updateBadge: vi.fn(),
  syncSuperTheater: vi.fn(),
  loadRegistry: vi.fn(),
  applyRegistryChanges: vi.fn(),
  recordBufferSample: vi.fn(),
  audioSamplingReady: false,
  recordAudioSample: vi.fn(),
  autoSlowSample: vi.fn(),
  autoSlowSamplingReady: false,
  ctxValid: true,
  addStorageListener: vi.fn(),
  readyCallback: null as (() => void) | null,
  storageListener: null as
    | ((changes: Record<string, { newValue?: unknown }>, area: string) => void)
    | null,
  keys: [] as string[],
  videos: [] as HTMLVideoElement[],
  live: null as HTMLVideoElement | null,
  resolveSpeed: vi.fn(),
  onStream: false,
  sendMessage: vi.fn(),
}));

vi.mock("../src/content/platform/browser.js", () => ({
  api: {
    runtime: {
      sendMessage: fx.sendMessage,
    },
    storage: {
      onChanged: {
        addListener: (
          fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void,
        ) => {
          fx.storageListener = fn;
          fx.addStorageListener(fn);
        },
      },
    },
  },
  ctxValid: () => fx.ctxValid,
}));
vi.mock("../src/content/platform/storage.js", () => ({
  STORE: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
  routedChanges: (changes: Record<string, unknown>) => changes,
  whenReady: (fn: () => void) => {
    fx.readyCallback = fn;
  },
}));
vi.mock("../src/content/core/clamp.js", () => ({
  clamp: (n: number) => n,
  clampTarget: (n: number) => n,
}));
vi.mock("../src/content/core/domain.js", () => ({
  getDomain: () => "example.com",
  whenDomainReady: (fn: () => void) => fn(),
}));
vi.mock("../src/content/core/resolve.js", () => ({
  resolveSpeed: fx.resolveSpeed,
  resolveSyncTarget: (
    _keys: string[],
    _domain: string,
    _sites: Record<string, number>,
    _channels: Record<string, number>,
    global?: number,
  ) => ({ target: global ?? 5, scope: global == null ? "site" : "global" }),
  resolveAutoSlow: (
    _keys: string[],
    _domain: string,
    sites: Record<string, { target: number }>,
  ) => ({ target: sites["example.com"]?.target ?? 6, scope: "site" }),
  resolveViewerAuto: (
    _keys: string[],
    _domain: string,
    sites: Record<string, "off" | "normal" | "theater">,
  ) => ({ mode: sites["example.com"] ?? "off", scope: "site" }),
  resolveViewerFit: (
    _keys: string[],
    _domain: string,
    sites: Record<string, "contain" | "cover" | "fill">,
  ) => ({ mode: sites["example.com"] ?? "contain", scope: "site" }),
}));
vi.mock("../src/shared/presets.js", () => ({
  DEFAULT_PRESETS: [100],
  DEFAULT_PRESET_KEYS: [null],
  normalizePresetSet: () => ({ presets: [], keys: {} }),
}));
vi.mock("../src/content/speed.js", () => ({
  applyAll: fx.applyAll,
  reassertRate: vi.fn(),
  resetMedia: fx.resetMedia,
}));
vi.mock("../src/content/live/sync.js", () => ({ controlLive: fx.controlLive }));
vi.mock("../src/content/live/detection.js", () => ({
  isLive: (v: HTMLVideoElement) => v === fx.live,
  liveVideoFrom: (videos: HTMLVideoElement[]) => videos.find((v) => v === fx.live) ?? null,
  onStreamPage: (live?: HTMLVideoElement | null) =>
    live === undefined ? fx.onStream : !!live || fx.onStream,
}));
vi.mock("../src/content/live/target.js", () => ({ applyResolvedTargetFromStore: vi.fn() }));
vi.mock("../src/content/audio/compressor.js", () => ({ applyAudioComp: fx.applyAudioComp }));
vi.mock("../src/content/audio/status.js", () => ({ engageAudio: vi.fn() }));
vi.mock("../src/content/badge/overlay.js", () => ({
  updateTimeBadge: fx.updateTimeBadge,
  flashBadge: fx.flashBadge,
  showBadgeNotice: fx.showBadgeNotice,
  fmtTime: (s: number) => {
    const t = Math.round(s);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  },
  ownsBadgeNode: () => false,
}));
vi.mock("../src/content/overlay/launcher.js", () => ({
  updateLauncher: fx.updateLauncher,
  ownsLauncherNode: () => false,
}));
vi.mock("../src/content/viewer.js", () => ({
  exitViewer: fx.exitViewer,
  maybeAutoOpenViewer: fx.maybeAutoOpenViewer,
  maybeAutoOpenPlayingPrimary: fx.maybeAutoOpenPlayingPrimary,
  ownsViewerNode: () => false,
  refreshViewerBackdrop: vi.fn(),
}));
vi.mock("../src/content/settings/registry.js", () => ({
  REGISTRY_KEYS: [],
  loadRegistry: fx.loadRegistry,
  applyRegistryChanges: fx.applyRegistryChanges,
}));
vi.mock("../src/content/audio/metering.js", () => ({
  audioSamplingReady: () => fx.audioSamplingReady,
  recordAudioSample: fx.recordAudioSample,
  A_HIST_MS: 1000,
}));
vi.mock("../src/content/audio/autoslow.js", () => ({
  autoSlowSample: fx.autoSlowSample,
  autoSlowSamplingReady: () => fx.autoSlowSamplingReady,
  AUTOSLOW_MS: 1000,
  releaseAutoSlow: fx.releaseAutoSlow,
}));
vi.mock("../src/content/audio/autoslow-config.js", () => ({
  applyResolvedAutoSlowFromStore: vi.fn(),
}));
vi.mock("../src/content/viewer-auto.js", () => ({ applyResolvedViewerAutoFromStore: vi.fn() }));
vi.mock("../src/content/viewer-fit.js", () => ({ applyResolvedViewerFitFromStore: vi.fn() }));
vi.mock("../src/content/bitrate.js", () => ({
  recordBufferSample: fx.recordBufferSample,
  BUF_HIST_MS: 1000,
}));
vi.mock("../src/content/videos.js", () => ({
  collectVideos: () => fx.videos,
  hasVideos: () => fx.videos.length > 0,
  primaryVideoFrom: (videos: HTMLVideoElement[]) => videos[0] ?? null,
  startTracking: fx.startTracking,
  stopTracking: fx.stopTracking,
  reconcile: fx.reconcile,
  markDrmVideo: fx.markDrmVideo,
}));
vi.mock("../src/content/messaging.js", () => ({}));
vi.mock("../src/content/keyboard.js", () => ({}));
vi.mock("../src/content/theater.js", () => ({ syncSuperTheater: fx.syncSuperTheater }));
vi.mock("../src/content/badge/icon.js", () => ({ updateBadge: fx.updateBadge }));
vi.mock("../src/content/channel.js", () => ({
  channelKeys: () => fx.keys,
  sameChannelIdentity: (a: string[], b: string[]) => a.some((key) => b.includes(key)),
  sameChannelKeys: (a: string[], b: string[]) =>
    a.length === b.length && a.every((key) => b.includes(key)),
}));

import { STORE } from "../src/content/platform/storage.js";
import { QUALITY_BRIDGE_LOAD_EVENT, QUALITY_BRIDGE_READY_EVENT } from "../src/shared/dom-events.js";

async function loadIndex(): Promise<void> {
  vi.resetModules();
  const mod = await import("../src/content/index.js");
  teardownIndex = mod.teardown;
}

// The timers and the media registry start only once the first settings read says the
// site is enabled (a blacklisted page never starts them) — so run that read the way the
// real page does once whenReady fires.
async function bootIndex(stored: Record<string, unknown> = {}): Promise<void> {
  vi.mocked(STORE.get).mockImplementation((_keys, cb) => cb(stored));
  await loadIndex();
  fx.readyCallback?.();
}

let teardownIndex: (() => void) | null = null;

function media(paused: boolean): HTMLVideoElement {
  const v = document.createElement("video");
  Object.defineProperty(v, "paused", { value: paused, configurable: true });
  Object.defineProperty(v, "currentTime", { value: 0, writable: true, configurable: true });
  Object.defineProperty(v, "volume", { value: 1, writable: true, configurable: true });
  Object.defineProperty(v, "muted", { value: false, writable: true, configurable: true });
  Object.defineProperty(v, "playbackRate", { value: 1, writable: true, configurable: true });
  document.body.append(v);
  return v;
}

async function nextFrame(): Promise<void> {
  await vi.advanceTimersByTimeAsync(16);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  teardownIndex = null;
  fx.onStream = false;
  fx.ctxValid = true;
  fx.audioSamplingReady = false;
  fx.autoSlowSamplingReady = false;
  fx.live = null;
  fx.keys = [];
  fx.videos = [];
  fx.storageListener = null;
  fx.readyCallback = null;
  fx.resolveSpeed.mockImplementation(
    (
      keys: string[],
      _domain: string,
      _domains: Record<string, number>,
      channels: Record<string, number>,
    ) => {
      const key = keys.find((k) => channels[k] != null);
      return key ? { speed: channels[key], scope: "channel" } : { speed: 1, scope: null };
    },
  );
  document.body.textContent = "";
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
});

afterEach(() => {
  teardownIndex?.();
  vi.useRealTimers();
});

describe("content media events", () => {
  it("loads persisted scope settings before the first apply pass", async () => {
    fx.keys = ["@creator"];
    vi.mocked(STORE.get).mockImplementation((_keys, cb) => {
      cb({
        domains: { "example.com": 1.25 },
        channels: { "@creator": 1.75 },
        globalSpeed: 1.1,
        liveSync: false,
        liveSyncTarget: 9,
        autoSlowSites: { "example.com": { target: 7 } },
        viewerAutoSites: { "example.com": "theater" },
        viewerFitSites: { "example.com": "cover" },
      });
    });

    await loadIndex();
    fx.readyCallback?.();
    const { S } = await import("../src/content/state.js");

    expect(S.currentSpeed).toBe(1.75);
    expect(S.userSpeed).toBe(1.75);
    expect(S.speedScope).toBe("channel");
    expect(S.liveSyncEnabled).toBe(false);
    expect(S.liveSyncTarget).toBe(9);
    expect(S.autoSlowTarget).toBe(7);
    expect(S.viewerAuto).toBe("theater");
    expect(S.viewerFit).toBe("cover");
    expect(fx.applyAll).toHaveBeenCalled();
    expect(fx.controlLive).toHaveBeenCalled();
    expect(fx.updateTimeBadge).toHaveBeenCalled();
    expect(fx.updateLauncher).toHaveBeenCalled();
    expect(fx.maybeAutoOpenPlayingPrimary).toHaveBeenCalled();
  });

  it("asks the background for the quality bridge only when the page loader needs it", async () => {
    await loadIndex();
    const ready = vi.fn();
    document.addEventListener(QUALITY_BRIDGE_READY_EVENT, ready);
    try {
      expect(document.documentElement.hasAttribute("data-vtp-quality-bridge-url")).toBe(false);
      expect(fx.sendMessage).not.toHaveBeenCalled();

      fx.sendMessage.mockImplementationOnce((_msg, done) => done({ ok: false }));
      document.dispatchEvent(new Event(QUALITY_BRIDGE_LOAD_EVENT));
      expect(ready).not.toHaveBeenCalled();

      fx.sendMessage.mockImplementationOnce((_msg, done) => done({ ok: true }));
      document.dispatchEvent(new Event(QUALITY_BRIDGE_LOAD_EVENT));
      expect(ready).toHaveBeenCalledTimes(1);

      document.dispatchEvent(new Event(QUALITY_BRIDGE_LOAD_EVENT));
      expect(fx.sendMessage).toHaveBeenCalledTimes(2);
      expect(fx.sendMessage).toHaveBeenLastCalledWith(
        { action: "injectQualityBridge" },
        expect.any(Function),
      );
    } finally {
      document.removeEventListener(QUALITY_BRIDGE_READY_EVENT, ready);
    }
  });

  it("touches no media before the first settings read, then replays the pending pass", async () => {
    vi.mocked(STORE.get).mockImplementation((_keys, cb) => cb({}));
    await loadIndex(); // the settings read has not landed yet

    media(false).dispatchEvent(new Event("play"));
    fx.storageListener?.({ globalSpeed: { newValue: 2 } }, "sync");
    await nextFrame();
    expect(fx.applyAll).not.toHaveBeenCalled();
    expect(fx.controlLive).not.toHaveBeenCalled();
    expect(fx.flashBadge).not.toHaveBeenCalled();

    fx.readyCallback?.(); // the site is on
    expect(fx.applyAll).toHaveBeenCalledTimes(1);
    await nextFrame();
    expect(fx.flashBadge).toHaveBeenCalledTimes(1); // the early autoplay still surfaces the badge
  });

  it("coalesces a burst of media events into one apply pass", async () => {
    await bootIndex();
    vi.clearAllMocks(); // forget the boot pass
    const v = media(false);

    v.dispatchEvent(new Event("loadedmetadata"));
    v.dispatchEvent(new Event("durationchange"));
    v.dispatchEvent(new Event("play"));
    expect(fx.applyAll).not.toHaveBeenCalled();

    await nextFrame();

    expect(fx.applyAll).toHaveBeenCalledTimes(1);
    expect(fx.controlLive).toHaveBeenCalledTimes(1);
    expect(fx.updateTimeBadge).toHaveBeenCalledTimes(1);
    expect(fx.flashBadge).toHaveBeenCalledTimes(1);
  });

  it("surfaces the badge when duration arrives after autoplay has already started", async () => {
    await bootIndex();
    vi.clearAllMocks();

    media(false).dispatchEvent(new Event("durationchange"));
    await nextFrame();

    expect(fx.applyAll).toHaveBeenCalled();
    expect(fx.controlLive).toHaveBeenCalled();
    expect(fx.updateTimeBadge).toHaveBeenCalled();
    expect(fx.flashBadge).toHaveBeenCalled();
  });

  it("does not flash the badge for idle metadata changes", async () => {
    await bootIndex();
    vi.clearAllMocks();

    media(true).dispatchEvent(new Event("durationchange"));
    await nextFrame();

    expect(fx.updateTimeBadge).not.toHaveBeenCalled();
    expect(fx.flashBadge).not.toHaveBeenCalled();
  });

  it("does not keep a live badge awake on repeated duration changes", async () => {
    fx.onStream = true;
    await bootIndex();
    vi.clearAllMocks();

    media(false).dispatchEvent(new Event("durationchange"));
    await nextFrame();

    expect(fx.applyAll).not.toHaveBeenCalled();
    expect(fx.controlLive).not.toHaveBeenCalled();
    expect(fx.updateTimeBadge).not.toHaveBeenCalled();
    expect(fx.flashBadge).not.toHaveBeenCalled();
  });

  it("does not surface page-originated media state changes as badge notices", async () => {
    await bootIndex();
    const v = media(false);

    v.dispatchEvent(new Event("play"));
    v.dispatchEvent(new Event("pause"));
    v.currentTime = 10;
    v.dispatchEvent(new Event("seeking"));
    v.currentTime = 35;
    v.dispatchEvent(new Event("seeked"));
    v.volume = 0.4;
    v.dispatchEvent(new Event("volumechange"));
    v.playbackRate = 1.75;
    v.dispatchEvent(new Event("ratechange"));

    expect(fx.showBadgeNotice).not.toHaveBeenCalled();
  });

  it("closes an active viewer when the viewer feature is disabled", async () => {
    await bootIndex();
    const { S } = await import("../src/content/state.js");
    S.viewerAutoEnabled = false;

    fx.storageListener?.({ viewerAutoEnabled: { newValue: false } }, "sync");

    expect(fx.exitViewer).toHaveBeenCalledTimes(1);
  });
});

describe("content graph samplers", () => {
  it("tears down the orphaned context on the next background tick", async () => {
    await bootIndex();
    fx.ctxValid = false;

    await vi.advanceTimersByTimeAsync(1000);

    expect(fx.stopTracking).toHaveBeenCalledTimes(1);
  });

  it("passes one media snapshot through the background tick", async () => {
    const v = media(false);
    fx.videos = [v];
    fx.live = v;
    fx.onStream = true;
    fx.onStream = true;
    await bootIndex();

    await vi.advanceTimersByTimeAsync(2000);

    expect(fx.applyAll).toHaveBeenCalledWith({ videos: [v], primary: v, primaryLive: true });
    expect(fx.controlLive).toHaveBeenCalledWith({ live: v, onStream: true });
    expect(fx.updateTimeBadge).toHaveBeenCalledWith({ video: v, stream: true });
    expect(fx.updateLauncher).toHaveBeenCalledWith({ primary: v });
  });

  it("does not run the buffer sampler before a page has video", async () => {
    await bootIndex();

    await vi.advanceTimersByTimeAsync(3000);

    expect(fx.recordBufferSample).not.toHaveBeenCalled();
  });

  it("backs the full reconcile off in an idle frame", async () => {
    await bootIndex();

    await vi.advanceTimersByTimeAsync(29_000);
    expect(fx.reconcile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(fx.reconcile).toHaveBeenCalledTimes(1);
  });

  it("reconciles once after page startup to discover late shadow roots", async () => {
    await bootIndex();
    fx.reconcile.mockReturnValueOnce(true);

    window.dispatchEvent(new Event("load"));
    await nextFrame();

    expect(fx.reconcile).toHaveBeenCalledTimes(1);
    expect(fx.applyAll).toHaveBeenCalled();
    expect(fx.updateTimeBadge).toHaveBeenCalled();
    expect(fx.updateLauncher).toHaveBeenCalled();
  });

  it("wakes an idle frame immediately when its observer finds media", async () => {
    await bootIndex();
    await vi.advanceTimersByTimeAsync(20_000);
    fx.applyAll.mockClear();

    const options = fx.startTracking.mock.calls[0]?.[0] as
      | { onMediaChange?: () => void }
      | undefined;
    options?.onMediaChange?.();
    await nextFrame();
    expect(fx.applyAll).toHaveBeenCalled();

    fx.applyAll.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fx.applyAll).toHaveBeenCalled();
  });

  it("starts the buffer sampler only after the video is identified as live", async () => {
    await bootIndex();
    const v = media(false);
    fx.videos = [v];
    fx.live = v;

    v.dispatchEvent(new Event("play"));
    await nextFrame();
    await vi.advanceTimersByTimeAsync(2000);

    expect(fx.recordBufferSample).toHaveBeenCalled();
  });

  it("stops the buffer sampler when the page is no longer live", async () => {
    await bootIndex();
    const v = media(false);
    fx.videos = [v];
    fx.live = v;
    v.dispatchEvent(new Event("play"));
    await vi.advanceTimersByTimeAsync(1001);
    fx.recordBufferSample.mockClear();

    fx.live = null;
    await vi.advanceTimersByTimeAsync(1000);

    expect(fx.recordBufferSample).toHaveBeenCalled();
    const callsAfterStop = fx.recordBufferSample.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(fx.recordBufferSample).toHaveBeenCalledTimes(callsAfterStop);
  });

  it("runs the audio sampler only while a running audio graph exists", async () => {
    await bootIndex();

    await vi.advanceTimersByTimeAsync(3000);
    expect(fx.recordAudioSample).not.toHaveBeenCalled();

    fx.audioSamplingReady = true;
    const v = media(false);
    fx.videos = [v];
    v.dispatchEvent(new Event("play"));
    await nextFrame();
    await vi.advanceTimersByTimeAsync(1100);
    expect(fx.recordAudioSample).toHaveBeenCalled();
    const calls = fx.recordAudioSample.mock.calls.length;

    fx.audioSamplingReady = false;
    await vi.advanceTimersByTimeAsync(1100);
    const callsAfterStop = fx.recordAudioSample.mock.calls.length;
    expect(callsAfterStop).toBeGreaterThanOrEqual(calls);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fx.recordAudioSample).toHaveBeenCalledTimes(callsAfterStop);
  });

  it("runs the auto-slow sampler only while auto-slow is enabled", async () => {
    await bootIndex();
    const { S } = await import("../src/content/state.js");
    fx.autoSlowSamplingReady = true;

    await vi.advanceTimersByTimeAsync(3000);
    expect(fx.autoSlowSample).not.toHaveBeenCalled();

    S.autoSlowEnabled = true;
    fx.storageListener?.({ autoSlowEnabled: { newValue: true } }, "sync");
    await vi.advanceTimersByTimeAsync(1000);
    expect(fx.autoSlowSample).toHaveBeenCalledTimes(1);

    S.autoSlowEnabled = false;
    fx.storageListener?.({ autoSlowEnabled: { newValue: false } }, "sync");
    expect(fx.autoSlowSample).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fx.autoSlowSample).toHaveBeenCalledTimes(2);
  });

  it("runs the auto-slow sampler only while the main video feeds an audio graph", async () => {
    await bootIndex();
    const { S } = await import("../src/content/state.js");
    fx.videos = [media(false)];
    S.autoSlowEnabled = true;
    fx.storageListener?.({ autoSlowEnabled: { newValue: true } }, "sync");
    await vi.advanceTimersByTimeAsync(3000);
    expect(fx.autoSlowSample).not.toHaveBeenCalled();

    fx.autoSlowSamplingReady = true; // the main video got routed through Web Audio
    await vi.advanceTimersByTimeAsync(2000);
    expect(fx.autoSlowSample).toHaveBeenCalled();

    fx.autoSlowSamplingReady = false;
    await vi.advanceTimersByTimeAsync(1000);
    const callsAfterStop = fx.autoSlowSample.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(fx.autoSlowSample).toHaveBeenCalledTimes(callsAfterStop);
  });
});

describe("content channel alias changes", () => {
  it("keeps the existing alias ahead of a late-rendered YouTube canonical id", async () => {
    fx.keys = ["@h"];
    await bootIndex({ domains: {}, channels: { "channel/UCabc": 2, "@h": 1.5 } });
    const { S } = await import("../src/content/state.js");

    await vi.advanceTimersByTimeAsync(1000);
    expect(S.currentSpeed).toBe(1.5);

    fx.keys = ["channel/UCabc", "@h"];
    await vi.advanceTimersByTimeAsync(2001);

    expect(S.currentSpeed).toBe(1.5);
    expect(fx.resolveSpeed).toHaveBeenLastCalledWith(
      ["@h", "channel/UCabc"],
      "example.com",
      {},
      { "channel/UCabc": 2, "@h": 1.5 },
      undefined,
    );
  });

  it("drops a manual override when an SPA navigation reaches a different channel", async () => {
    fx.keys = ["@one"];
    await bootIndex({ domains: {}, channels: { "@one": 1.5, "@two": 2 } });
    const { S } = await import("../src/content/state.js");

    await vi.advanceTimersByTimeAsync(1000);
    S.speedManual = true;
    S.currentSpeed = 1.25;
    S.userSpeed = 1.25;

    fx.keys = ["@two"];
    await vi.advanceTimersByTimeAsync(2000);

    expect(S.speedManual).toBe(false);
    expect(S.currentSpeed).toBe(2);
    expect(S.userSpeed).toBe(2);
  });
});

describe("content site blacklist", () => {
  const OFF = ["example.com"]; // getDomain() is mocked to example.com
  // loadIndex() resets the module registry, so each boot has its own S — import it after.
  const stateOf = async () => (await import("../src/content/state.js")).S;

  it("a blacklisted page never starts its timers or media tracking, and writes nothing", async () => {
    await bootIndex({ siteBlacklist: OFF });
    const S = await stateOf();
    expect(S.siteDisabled).toBe(true);

    const v = media(false);
    fx.videos = [v];
    v.dispatchEvent(new Event("loadedmetadata"));
    v.dispatchEvent(new Event("play"));
    window.dispatchEvent(new Event("load"));
    await nextFrame();
    await vi.advanceTimersByTimeAsync(40_000);

    expect(fx.startTracking).not.toHaveBeenCalled();
    expect(fx.applyAll).not.toHaveBeenCalled();
    expect(fx.controlLive).not.toHaveBeenCalled();
    expect(fx.reconcile).not.toHaveBeenCalled();
    expect(fx.updateTimeBadge).not.toHaveBeenCalled();
    expect(fx.maybeAutoOpenPlayingPrimary).not.toHaveBeenCalled();
    expect(fx.loadRegistry).not.toHaveBeenCalled();
    // Nothing of ours ran here, so the page's own playback rate is left alone.
    expect(fx.resetMedia).not.toHaveBeenCalled();
    expect(fx.updateBadge).toHaveBeenCalled(); // only to clear a toolbar badge, if any
  });

  it("writes nothing for media events that arrive before the first settings read", async () => {
    vi.mocked(STORE.get).mockImplementation((_keys, cb) => cb({ siteBlacklist: OFF }));
    await loadIndex(); // the settings read has not landed yet
    const v = media(false);
    fx.videos = [v];
    v.dispatchEvent(new Event("loadedmetadata"));
    v.dispatchEvent(new Event("play"));
    window.dispatchEvent(new Event("load"));
    await nextFrame();

    fx.readyCallback?.(); // …and it says this site is off
    await nextFrame();

    expect(fx.applyAll).not.toHaveBeenCalled();
    expect(fx.controlLive).not.toHaveBeenCalled();
    expect(fx.reconcile).not.toHaveBeenCalled();
  });

  it("a tab regaining focus does not restart a blacklisted page", async () => {
    await bootIndex({ siteBlacklist: OFF });

    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(5000);

    expect(fx.applyAll).not.toHaveBeenCalled();
  });

  it("reads hand-edited entries the way the editor would have saved them", async () => {
    await bootIndex({ siteBlacklist: ["https://WWW.Example.com/watch?v=1", 7, ""] });

    expect((await stateOf()).siteDisabled).toBe(true);
  });

  it("keeps the popup panel's saved spot while the site is off", async () => {
    await bootIndex({
      siteBlacklist: OFF,
      overlayPanelPos: { "example.com": { fx: 0.1, fy: 0.2 } },
    });
    const S = await stateOf();
    expect(S.overlayPanelPos).toEqual({ fx: 0.1, fy: 0.2 });

    // A drag saves a new spot; without this the next layout pass would snap the panel back.
    fx.storageListener?.(
      { overlayPanelPos: { newValue: { "example.com": { fx: 0.25, fy: 0.75 } } } },
      "sync",
    );

    expect(S.overlayPanelPos).toEqual({ fx: 0.25, fy: 0.75 });
  });

  it("switching a running page off hands it back and stops everything", async () => {
    await bootIndex();
    const S = await stateOf();
    expect(fx.startTracking).toHaveBeenCalledTimes(1);
    S.speedManual = true;
    S.holdActive = true;
    vi.clearAllMocks(); // forget the boot pass; only the switch-off is under test

    fx.storageListener?.({ siteBlacklist: { newValue: OFF } }, "sync");

    expect(S.siteDisabled).toBe(true);
    for (const fn of [
      fx.exitViewer,
      fx.releaseAutoSlow,
      fx.resetMedia,
      fx.applyAudioComp,
      fx.updateTimeBadge,
      fx.updateLauncher,
      fx.updateBadge,
      fx.stopTracking,
      fx.syncSuperTheater,
    ]) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
    expect(S.speedManual).toBe(false);
    expect(S.holdActive).toBe(false);

    // …and nothing keeps running: no tick, no media pass, no reaction to other settings.
    const v = media(false);
    fx.videos = [v];
    v.dispatchEvent(new Event("play"));
    await nextFrame();
    await vi.advanceTimersByTimeAsync(40_000);
    fx.storageListener?.({ keyboard: { newValue: false } }, "sync");
    expect(fx.applyAll).not.toHaveBeenCalled();
    expect(fx.controlLive).not.toHaveBeenCalled();
    expect(fx.reconcile).not.toHaveBeenCalled();
    expect(fx.applyRegistryChanges).not.toHaveBeenCalled();
  });

  it("switching a site back on re-reads its settings and restarts tracking and the tick", async () => {
    await bootIndex();
    fx.storageListener?.({ siteBlacklist: { newValue: OFF } }, "sync");
    vi.clearAllMocks();
    const S = await stateOf();

    fx.storageListener?.({ siteBlacklist: { newValue: [] } }, "sync");

    expect(S.siteDisabled).toBe(false);
    expect(fx.loadRegistry).toHaveBeenCalled();
    expect(fx.applyAll).toHaveBeenCalled();
    expect(fx.startTracking).toHaveBeenCalledTimes(1);
    expect(fx.syncSuperTheater).toHaveBeenCalledTimes(1);

    fx.applyAll.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fx.applyAll).toHaveBeenCalledWith(expect.objectContaining({ videos: [] }));
  });

  it("switching on a page that booted blacklisted starts it from scratch", async () => {
    await bootIndex({ siteBlacklist: OFF });
    const S = await stateOf();
    expect(fx.startTracking).not.toHaveBeenCalled();
    vi.mocked(STORE.get).mockImplementation((_keys, cb) => cb({ siteBlacklist: [] })); // the edit landed

    fx.storageListener?.({ siteBlacklist: { newValue: [] } }, "sync");

    expect(S.siteDisabled).toBe(false);
    expect(fx.startTracking).toHaveBeenCalledTimes(1);
  });

  it("leaves a running page alone when an edited list does not cover it", async () => {
    await bootIndex();
    const S = await stateOf();

    fx.storageListener?.(
      { siteBlacklist: { newValue: ["other.com", "notexample.com", "sub.example.com"] } },
      "sync",
    );

    expect(S.siteDisabled).toBe(false);
    expect(fx.resetMedia).not.toHaveBeenCalled();
    expect(fx.stopTracking).not.toHaveBeenCalled();
  });
});
