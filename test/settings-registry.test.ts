import { describe, it, expect, vi, beforeEach } from "vitest";

// The registry's side-effects live in DOM/browser modules — mock them so the test
// stays on the value-loading + apply-dispatch logic.
const fx = vi.hoisted(() => ({
  applyAll: vi.fn(),
  resetAudios: vi.fn(),
  updateTimeBadge: vi.fn(),
  flashBadge: vi.fn(),
  updateLauncher: vi.fn(),
  releaseAutoSlow: vi.fn(),
  applyViewerChatMode: vi.fn(),
  applyViewerChatSettings: vi.fn(),
}));
vi.mock("../src/content/speed.js", () => ({ applyAll: fx.applyAll, resetAudios: fx.resetAudios }));
vi.mock("../src/content/badge/overlay.js", () => ({
  updateTimeBadge: fx.updateTimeBadge,
  flashBadge: fx.flashBadge,
}));
vi.mock("../src/content/overlay/launcher.js", () => ({ updateLauncher: fx.updateLauncher }));
vi.mock("../src/content/audio/autoslow.js", () => ({ releaseAutoSlow: fx.releaseAutoSlow }));
vi.mock("../src/content/viewer.js", () => ({
  applyViewerChatMode: fx.applyViewerChatMode,
  applyViewerChatSettings: fx.applyViewerChatSettings,
}));

import { S } from "../src/content/state.js";
import {
  REGISTRY_KEYS,
  loadRegistry,
  applyRegistryChanges,
} from "../src/content/settings/registry.js";

// Wrap raw newValues into the storage.onChanged shape.
function changes(map: Record<string, unknown>) {
  const out: Record<string, { newValue?: unknown }> = {};
  for (const k of Object.keys(map)) out[k] = { newValue: map[k] };
  return out;
}

beforeEach(() => {
  for (const fn of Object.values(fx)) fn.mockClear();
});

describe("REGISTRY_KEYS", () => {
  it("covers the simple keys and excludes the bespoke ones", () => {
    expect(REGISTRY_KEYS).toContain("showRemaining");
    expect(REGISTRY_KEYS).toContain("overlayButton");
    expect(REGISTRY_KEYS).toContain("audioCompGain");
    // Cross-scope / per-domain keys must NOT be in the registry.
    for (const k of [
      "domains",
      "syncTargets",
      "autoSlowSites",
      "viewerAutoSites",
      "viewerAutoChannels",
      "viewerFitSites",
      "viewerFitChannels",
      "badgePos",
      "overlayBtnPos",
    ]) {
      expect(REGISTRY_KEYS).not.toContain(k);
    }
  });
});

describe("loadRegistry — defaults", () => {
  it("applies each key's default when storage is empty", () => {
    loadRegistry({});
    expect(S.showRemaining).toBe(true); // defaults-on
    expect(S.streamBadge).toBe(true);
    expect(S.audioSpeedEnabled).toBe(false); // opt-in
    expect(S.forceRate).toBe(false);
    expect(S.keyboardEnabled).toBe(true);
    expect(S.keymap.hold).toBe("KeyX");
    expect(S.holdSpeed).toBe(2.0);
    expect(S.overlayButton).toBe("fullscreen");
    expect(S.audioCompEnabled).toBe(true);
    expect(S.audioCompThreshold).toBe(-60);
    expect(S.autoSlowFloor).toBe(1.0);
    expect(S.autoSlowKnee).toBe(0.5);
  });
});

describe("loadRegistry — viewer chat keys", () => {
  it("applies defaults when storage is empty", () => {
    loadRegistry({});
    expect(S.viewerChatMode).toBe("off");
    expect(S.viewerChatOpacity).toBe(0.4);
    expect(S.viewerChatInput).toBe(true);
    expect(S.viewerChatWidth).toBe(340);
    expect(S.viewerChatHeight).toBe(420);
  });

  it("accepts the two on modes and rejects garbage", () => {
    loadRegistry({ viewerChatMode: "side" });
    expect(S.viewerChatMode).toBe("side");
    loadRegistry({ viewerChatMode: "overlay" });
    expect(S.viewerChatMode).toBe("overlay");
    loadRegistry({ viewerChatMode: "garbage" });
    expect(S.viewerChatMode).toBe("off");
  });

  it("normalizes the per-site side-width map (clamps, drops junk)", () => {
    loadRegistry({
      viewerChatSideWidths: {
        "twitch.tv": { theater: 5000, normal: 250.7 },
        "youtube.com": { theater: "wide" },
        junk: "nope",
      },
    });
    expect(S.viewerChatSideWidths).toEqual({
      "twitch.tv": { theater: 600, normal: 251 },
    });
    loadRegistry({});
    expect(S.viewerChatSideWidths).toEqual({});
  });

  it("normalizes the per-site panel prefs (clamps, drops junk fields)", () => {
    loadRegistry({
      viewerChatPanelSites: {
        "twitch.tv": {
          opacity: 3,
          width: 100.4,
          height: 9999,
          h: "right",
          v: "bottom",
          dx: -20.6,
          dy: 96,
        },
        "youtube.com": { h: "sideways", dx: "far" },
        junk: 12,
      },
    });
    expect(S.viewerChatPanelSites).toEqual({
      "twitch.tv": {
        opacity: 1,
        width: 240,
        height: 720,
        h: "right",
        v: "bottom",
        dx: -21,
        dy: 96,
      },
    });
    loadRegistry({});
    expect(S.viewerChatPanelSites).toEqual({});
  });

  it("clamps and rounds the panel scalars", () => {
    loadRegistry({
      viewerChatOpacity: 7,
      viewerChatInput: false,
      viewerChatWidth: 100,
      viewerChatHeight: 9999,
    });
    expect(S.viewerChatOpacity).toBe(1);
    expect(S.viewerChatInput).toBe(false);
    expect(S.viewerChatWidth).toBe(240);
    expect(S.viewerChatHeight).toBe(720);
  });
});

describe("loadRegistry — parsing + clamping", () => {
  it("respects explicit values and clamps out-of-range numbers", () => {
    loadRegistry({
      showRemaining: false,
      audioSpeed: true,
      overlayButton: "always",
      audioCompThreshold: 999, // above max → clamps to 0
      autoSlowFloor: 0, // below min → clamps to 0.5
    });
    expect(S.showRemaining).toBe(false);
    expect(S.audioSpeedEnabled).toBe(true);
    expect(S.overlayButton).toBe("always");
    expect(S.audioCompThreshold).toBe(0);
    expect(S.autoSlowFloor).toBe(0.5);
  });

  it("falls back to fullscreen for a bad overlayButton value", () => {
    loadRegistry({ overlayButton: "garbage" });
    expect(S.overlayButton).toBe("fullscreen");
  });

  it("loadRegistry never fires side-effects", () => {
    loadRegistry({ showRemaining: false, audioSpeed: true, overlayButton: "off" });
    expect(fx.updateTimeBadge).not.toHaveBeenCalled();
    expect(fx.applyAll).not.toHaveBeenCalled();
    expect(fx.updateLauncher).not.toHaveBeenCalled();
  });
});

describe("applyRegistryChanges — value + side-effects", () => {
  it("runs the badge re-render for a badge toggle", () => {
    const touched = applyRegistryChanges(changes({ showRemaining: false }));
    expect(touched).toBe(true);
    expect(S.showRemaining).toBe(false);
    expect(fx.updateTimeBadge).toHaveBeenCalledTimes(1);
    expect(fx.flashBadge).toHaveBeenCalledTimes(1);
  });

  it("re-applies when audio-speed turns on, resets when off", () => {
    applyRegistryChanges(changes({ audioSpeed: true }));
    expect(S.audioSpeedEnabled).toBe(true);
    expect(fx.applyAll).toHaveBeenCalledTimes(1);
    expect(fx.resetAudios).not.toHaveBeenCalled();

    fx.applyAll.mockClear();
    applyRegistryChanges(changes({ audioSpeed: false }));
    expect(S.audioSpeedEnabled).toBe(false);
    expect(fx.resetAudios).toHaveBeenCalledTimes(1);
    expect(fx.applyAll).not.toHaveBeenCalled();
  });

  it("re-evaluates the launcher when the overlay button changes", () => {
    applyRegistryChanges(changes({ overlayButton: "always" }));
    expect(S.overlayButton).toBe("always");
    expect(fx.updateLauncher).toHaveBeenCalledTimes(1);
  });

  it("re-evaluates the launcher when viewer modes are toggled", () => {
    applyRegistryChanges(changes({ viewerAutoEnabled: false }));
    expect(S.viewerAutoEnabled).toBe(false);
    expect(fx.updateLauncher).toHaveBeenCalledTimes(1);
  });

  it("releases auto-slow immediately when the master toggle is disabled", () => {
    applyRegistryChanges(changes({ autoSlowEnabled: false }));

    expect(S.autoSlowEnabled).toBe(false);
    expect(fx.releaseAutoSlow).toHaveBeenCalledTimes(1);
  });

  it("remounts chat on a mode change and restyles the panel on scalar changes", () => {
    applyRegistryChanges(changes({ viewerChatMode: "side" }));
    expect(S.viewerChatMode).toBe("side");
    expect(fx.applyViewerChatMode).toHaveBeenCalledTimes(1);
    expect(fx.applyViewerChatSettings).not.toHaveBeenCalled();

    applyRegistryChanges(changes({ viewerChatOpacity: 0.5, viewerChatInput: false }));
    expect(S.viewerChatOpacity).toBe(0.5);
    expect(S.viewerChatInput).toBe(false);
    // Both scalars share one apply — deduped to a single call per batch.
    expect(fx.applyViewerChatSettings).toHaveBeenCalledTimes(1);
  });

  it("sets audio-compressor values without firing a side-effect (that stays bespoke)", () => {
    const touched = applyRegistryChanges(changes({ audioCompRatio: 4 }));
    expect(touched).toBe(true);
    expect(S.audioCompRatio).toBe(4);
    // No apply hook on the compressor entries — index.ts owns the engage/re-apply.
    expect(fx.applyAll).not.toHaveBeenCalled();
  });

  it("returns false and does nothing when no registry key is present", () => {
    const touched = applyRegistryChanges(changes({ domains: {}, badgePos: {} }));
    expect(touched).toBe(false);
    expect(fx.updateTimeBadge).not.toHaveBeenCalled();
    expect(fx.updateLauncher).not.toHaveBeenCalled();
  });

  it("runs each changed key's apply (the two badge toggles refresh independently)", () => {
    applyRegistryChanges(changes({ showRemaining: true, streamBadge: false }));
    // Each toggle has its own apply (matching the original per-key branches), so
    // the badge refresh runs once per changed key.
    expect(fx.updateTimeBadge).toHaveBeenCalledTimes(2);
    expect(fx.flashBadge).toHaveBeenCalledTimes(2);
  });
});
