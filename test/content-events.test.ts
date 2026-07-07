// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  applyAll: vi.fn(),
  controlLive: vi.fn(),
  updateTimeBadge: vi.fn(),
  flashBadge: vi.fn(),
  startTracking: vi.fn(),
  stopTracking: vi.fn(),
  reconcile: vi.fn(),
  markDrmVideo: vi.fn(),
  addStorageListener: vi.fn(),
}));

vi.mock("../src/content/platform/browser.js", () => ({
  api: { storage: { onChanged: { addListener: fx.addStorageListener } } },
  ctxValid: () => true,
}));
vi.mock("../src/content/platform/storage.js", () => ({
  STORE: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
  OUR_AREAS: new Set(["sync", "local"]),
  whenReady: vi.fn(),
}));
vi.mock("../src/content/core/clamp.js", () => ({
  clamp: (n: number) => n,
  clampTarget: (n: number) => n,
}));
vi.mock("../src/content/core/domain.js", () => ({ getDomain: () => "example.com" }));
vi.mock("../src/content/core/resolve.js", () => ({
  resolveSpeed: () => ({ speed: 1, scope: "site" }),
  resolveSyncTarget: () => ({ target: 5, scope: "site" }),
  resolveAutoSlow: () => ({ target: 6, scope: "site" }),
  resolveViewerAuto: () => ({ mode: "off", scope: "site" }),
  resolveViewerFit: () => ({ mode: "contain", scope: "site" }),
}));
vi.mock("../src/shared/presets.js", () => ({
  DEFAULT_PRESETS: [100],
  DEFAULT_PRESET_KEYS: [null],
  normalizePresetSet: () => ({ presets: [], keys: {} }),
}));
vi.mock("../src/content/speed.js", () => ({ applyAll: fx.applyAll, reassertRate: vi.fn() }));
vi.mock("../src/content/live/sync.js", () => ({ controlLive: fx.controlLive }));
vi.mock("../src/content/live/detection.js", () => ({ onStreamPage: () => false }));
vi.mock("../src/content/live/target.js", () => ({ applyResolvedTargetFromStore: vi.fn() }));
vi.mock("../src/content/audio/compressor.js", () => ({ applyAudioComp: vi.fn() }));
vi.mock("../src/content/audio/status.js", () => ({ engageAudio: vi.fn() }));
vi.mock("../src/content/badge/overlay.js", () => ({
  updateTimeBadge: fx.updateTimeBadge,
  flashBadge: fx.flashBadge,
  ownsBadgeNode: () => false,
}));
vi.mock("../src/content/overlay/launcher.js", () => ({
  updateLauncher: vi.fn(),
  ownsLauncherNode: () => false,
}));
vi.mock("../src/content/viewer.js", () => ({
  ownsViewerNode: () => false,
  refreshViewerBackdrop: vi.fn(),
}));
vi.mock("../src/content/settings/registry.js", () => ({
  REGISTRY_KEYS: [],
  loadRegistry: vi.fn(),
  applyRegistryChanges: vi.fn(),
}));
vi.mock("../src/content/audio/metering.js", () => ({
  recordAudioSample: vi.fn(),
  A_HIST_MS: 1000,
}));
vi.mock("../src/content/audio/autoslow.js", () => ({ autoSlowSample: vi.fn(), AUTOSLOW_MS: 1000 }));
vi.mock("../src/content/audio/autoslow-config.js", () => ({
  applyResolvedAutoSlowFromStore: vi.fn(),
}));
vi.mock("../src/content/viewer-auto.js", () => ({ applyResolvedViewerAutoFromStore: vi.fn() }));
vi.mock("../src/content/viewer-fit.js", () => ({ applyResolvedViewerFitFromStore: vi.fn() }));
vi.mock("../src/content/bitrate.js", () => ({ recordBufferSample: vi.fn(), BUF_HIST_MS: 1000 }));
vi.mock("../src/content/videos.js", () => ({
  collectVideos: () => [],
  startTracking: fx.startTracking,
  stopTracking: fx.stopTracking,
  reconcile: fx.reconcile,
  markDrmVideo: fx.markDrmVideo,
}));
vi.mock("../src/content/messaging.js", () => ({}));
vi.mock("../src/content/keyboard.js", () => ({}));
vi.mock("../src/content/theater.js", () => ({}));
vi.mock("../src/content/channel.js", () => ({
  channelKeys: () => [],
  sameChannelKeys: () => true,
}));

async function loadIndex(): Promise<void> {
  vi.resetModules();
  await import("../src/content/index.js");
}

function media(paused: boolean): HTMLVideoElement {
  const v = document.createElement("video");
  Object.defineProperty(v, "paused", { value: paused, configurable: true });
  document.body.append(v);
  return v;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  document.body.textContent = "";
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("content media events", () => {
  it("surfaces the badge when duration arrives after autoplay has already started", async () => {
    await loadIndex();

    media(false).dispatchEvent(new Event("durationchange"));

    expect(fx.applyAll).toHaveBeenCalled();
    expect(fx.controlLive).toHaveBeenCalled();
    expect(fx.updateTimeBadge).toHaveBeenCalled();
    expect(fx.flashBadge).toHaveBeenCalled();
  });

  it("does not flash the badge for idle metadata changes", async () => {
    await loadIndex();

    media(true).dispatchEvent(new Event("durationchange"));

    expect(fx.updateTimeBadge).not.toHaveBeenCalled();
    expect(fx.flashBadge).not.toHaveBeenCalled();
  });
});
