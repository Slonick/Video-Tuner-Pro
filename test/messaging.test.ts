// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// messaging.ts registers one runtime.onMessage listener at import. Capture it via
// a mocked api, then invoke each action and assert the right speed.ts call + the
// reply payload, including the video-frame vs top-frame fallback.
const h = vi.hoisted(() => ({
  listener: null as
    | null
    | ((req: unknown, sender: unknown, send: (r?: unknown) => void) => boolean),
  hasVideo: true,
  onStream: false,
  channel: "UCabc" as string | null,
  channelKeys: ["UCabc"] as string[],
  channelName: "Cool Channel",
  drm: false,
}));

vi.mock("../src/content/platform/browser.js", () => ({
  api: {
    runtime: {
      onMessage: {
        addListener: (fn: typeof h.listener) => {
          h.listener = fn;
        },
      },
    },
  },
}));
vi.mock("../src/content/channel.js", () => ({
  channelKeys: () => h.channelKeys,
  currentChannel: () => h.channel,
  currentChannelName: () => h.channelName,
}));
vi.mock("../src/content/videos.js", () => ({
  collectVideos: () => (h.hasVideo ? [{}] : []),
  hasVideos: () => h.hasVideo,
  primaryVideo: () => (h.hasVideo ? ({} as HTMLVideoElement) : null),
  isDrmVideo: () => h.drm,
}));
vi.mock("../src/content/live/detection.js", () => ({ onStreamPage: () => h.onStream }));
const speed = vi.hoisted(() => ({
  setSpeed: vi.fn(),
  persistDomainSpeed: vi.fn(),
  persistChannelSpeed: vi.fn(),
  persistGlobalSpeed: vi.fn(),
  resetScope: vi.fn(),
}));
vi.mock("../src/content/speed.js", () => speed);
const target = vi.hoisted(() => ({
  setTarget: vi.fn(),
  persistSiteTarget: vi.fn(),
  persistChannelTarget: vi.fn(),
  persistGlobalTarget: vi.fn(),
  resetTargetScope: vi.fn(),
}));
vi.mock("../src/content/live/target.js", () => target);
vi.mock("../src/content/monitor.js", () => ({ monitorData: () => ({ mock: "monitor" }) }));
vi.mock("../src/content/audio/metering.js", () => ({
  audioLevelHist: [{ in: -10, out: -12 }],
  A_HIST_MS: 150,
}));
vi.mock("../src/content/bitrate.js", () => ({ bufferLevelHist: [] }));
const autoslow = vi.hoisted(() => ({
  persistSiteAutoSlow: vi.fn(),
  persistChannelAutoSlow: vi.fn(),
  persistGlobalAutoSlow: vi.fn(),
  resetAutoSlowScope: vi.fn(),
  setAutoSlowPreview: vi.fn(),
  applyResolvedAutoSlowFromStore: vi.fn(),
}));
vi.mock("../src/content/audio/autoslow-config.js", () => autoslow);
vi.mock("../src/content/audio/autoslow-state.js", () => ({
  autoSlowHist: [{ rate: 7, speed: 1.4 }],
  AUTO_SLOW_HIST_MS: 100,
}));
const viewer = vi.hoisted(() => ({
  setViewerState: vi.fn(),
  setViewerFitMode: vi.fn((mode: unknown) => mode),
  viewerFormat: vi.fn(() => "normal" as "normal" | "theater" | null),
}));
vi.mock("../src/content/viewer.js", () => viewer);
const viewerAuto = vi.hoisted(() => ({
  persistSiteViewerAuto: vi.fn(),
  persistChannelViewerAuto: vi.fn(),
  persistGlobalViewerAuto: vi.fn(),
  resetViewerAutoScope: vi.fn(),
  applyResolvedViewerAutoFromStore: vi.fn(),
}));
vi.mock("../src/content/viewer-auto.js", () => viewerAuto);
const viewerFit = vi.hoisted(() => ({
  persistSiteViewerFit: vi.fn(),
  persistChannelViewerFit: vi.fn(),
  persistGlobalViewerFit: vi.fn(),
  resetViewerFitScope: vi.fn(),
  applyResolvedViewerFitFromStore: vi.fn(),
}));
vi.mock("../src/content/viewer-fit.js", () => viewerFit);

import { S } from "../src/content/state.js";
import "../src/content/messaging.js";

function send(req: unknown): { ret: boolean; resp: unknown; called: boolean } {
  let resp: unknown,
    called = false;
  const ret = h.listener!(req, {}, (r?: unknown) => {
    called = true;
    resp = r;
  });
  return { ret, resp, called };
}

const okWrite = (...args: unknown[]) => {
  const done = args[args.length - 1];
  if (typeof done === "function") done(true);
};

beforeEach(() => {
  vi.clearAllMocks();
  speed.persistDomainSpeed.mockImplementation(okWrite);
  speed.persistChannelSpeed.mockImplementation(okWrite);
  speed.persistGlobalSpeed.mockImplementation(okWrite);
  speed.resetScope.mockImplementation(okWrite);
  target.persistSiteTarget.mockImplementation(okWrite);
  target.persistChannelTarget.mockImplementation(okWrite);
  target.persistGlobalTarget.mockImplementation(okWrite);
  target.resetTargetScope.mockImplementation(okWrite);
  autoslow.persistSiteAutoSlow.mockImplementation(okWrite);
  autoslow.persistChannelAutoSlow.mockImplementation(okWrite);
  autoslow.persistGlobalAutoSlow.mockImplementation(okWrite);
  autoslow.resetAutoSlowScope.mockImplementation(okWrite);
  viewerAuto.persistSiteViewerAuto.mockImplementation(okWrite);
  viewerAuto.persistChannelViewerAuto.mockImplementation(okWrite);
  viewerAuto.persistGlobalViewerAuto.mockImplementation(okWrite);
  viewerAuto.resetViewerAutoScope.mockImplementation(okWrite);
  viewerFit.persistSiteViewerFit.mockImplementation(okWrite);
  viewerFit.persistChannelViewerFit.mockImplementation(okWrite);
  viewerFit.persistGlobalViewerFit.mockImplementation(okWrite);
  viewerFit.resetViewerFitScope.mockImplementation(okWrite);
  h.hasVideo = true;
  h.onStream = false;
  h.channel = "UCabc";
  h.channelKeys = ["UCabc"];
  h.channelName = "Cool Channel";
  h.drm = false;
  S.currentSpeed = 1.0;
  try {
    Object.defineProperty(window, "top", { value: window, configurable: true });
  } catch (e) {
    /* ignore */
  }
});

describe("setSpeed action", () => {
  it("applies a manual speed and replies from the video frame", () => {
    S.currentSpeed = 1.5;
    const { ret, resp, called } = send({ action: "setSpeed", speed: 1.5 });
    expect(speed.setSpeed).toHaveBeenCalledWith(1.5, false, true);
    expect(ret).toBe(true);
    expect(called).toBe(true);
    expect(resp).toEqual({ success: true, speed: 1.5, live: false });
  });

  it("rejects invalid speed payloads without corrupting the current speed", () => {
    S.currentSpeed = 1.25;
    const { ret, resp, called } = send({ action: "setSpeed", speed: "fast" });

    expect(speed.setSpeed).not.toHaveBeenCalled();
    expect(ret).toBe(true);
    expect(called).toBe(true);
    expect(resp).toEqual({ success: false, speed: 1.25, live: false });
  });
});

describe("remember / reset by scope", () => {
  it("remember site clamps and persists the domain speed", () => {
    const { resp } = send({ action: "remember", scope: "site", speed: 99 });
    expect(speed.persistDomainSpeed).toHaveBeenCalled();
    const passed = speed.persistDomainSpeed.mock.calls[0][0];
    expect(passed).toBeLessThanOrEqual(16); // clamped
    expect((resp as { success: boolean }).success).toBe(true);
  });

  it("remember without a number falls back to the current speed", () => {
    S.currentSpeed = 1.3;
    send({ action: "remember", scope: "site" });
    expect(speed.persistDomainSpeed).toHaveBeenCalledWith(1.3, expect.any(Function));
  });

  it("remember channel persists the channel speed", () => {
    send({ action: "remember", scope: "channel", speed: 1.2 });
    expect(speed.persistChannelSpeed).toHaveBeenCalledWith(1.2, expect.any(Function));
  });

  it("remember global persists the global speed", () => {
    send({ action: "remember", scope: "global", speed: 1.5 });
    expect(speed.persistGlobalSpeed).toHaveBeenCalledWith(1.5, expect.any(Function));
  });

  it("reset routes the scope through resetScope and acknowledges", () => {
    const { resp } = send({ action: "reset", scope: "global" });
    expect(speed.resetScope).toHaveBeenCalledWith("global", expect.any(Function));
    expect(resp).toEqual({ success: true });
  });

  it("reset defaults an unknown/absent scope to site", () => {
    send({ action: "reset" });
    expect(speed.resetScope).toHaveBeenCalledWith("site", expect.any(Function));
  });

  it("reports a failed scoped save instead of faking Saved", () => {
    speed.persistDomainSpeed.mockImplementationOnce((...args: unknown[]) => {
      const done = args[args.length - 1];
      if (typeof done === "function") done(false);
    });
    expect(send({ action: "remember", scope: "site", speed: 1.2 }).resp).toEqual({
      success: false,
      speed: 1.2,
    });
  });

  it("ignores scoped save/reset messages in subframes", () => {
    Object.defineProperty(window, "top", { value: {}, configurable: true });

    expect(send({ action: "remember", scope: "site", speed: 1.2 })).toEqual({
      ret: false,
      resp: undefined,
      called: false,
    });
    expect(send({ action: "reset", scope: "site" })).toEqual({
      ret: false,
      resp: undefined,
      called: false,
    });

    expect(speed.persistDomainSpeed).not.toHaveBeenCalled();
    expect(speed.resetScope).not.toHaveBeenCalled();
  });
});

describe("getSpeed", () => {
  it("returns speed + domain + channel + scope context", () => {
    S.currentSpeed = 1.25;
    S.speedScope = "channel";
    const { resp } = send({ action: "getSpeed" });
    expect(resp).toEqual({
      speed: 1.25,
      domain: "localhost",
      channel: "UCabc",
      channelKeys: ["UCabc"],
      channelName: "Cool Channel",
      scope: "channel",
      live: false,
      viewerSupported: true,
    });
  });

  it("returns every channel key alias so the popup can match old saved values", () => {
    h.channel = "channel/UCabc";
    h.channelKeys = ["channel/UCabc", "@cool"];
    const { resp } = send({ action: "getSpeed" });
    expect(resp).toMatchObject({
      channel: "channel/UCabc",
      channelKeys: ["channel/UCabc", "@cool"],
    });
  });

  it("includes DRM status only when the active video is protected", () => {
    h.drm = true;
    const { resp } = send({ action: "getSpeed" });
    expect(resp).toMatchObject({ drm: true });
  });

  it("reports that the viewer is supported in the top frame", () => {
    const { resp } = send({ action: "getSpeed" });
    expect(resp).toMatchObject({ viewerSupported: true });
  });
});

describe("live-sync target by scope", () => {
  it("setTarget previews live and replies from the video frame", () => {
    S.liveSyncTarget = 7;
    const { resp } = send({ action: "setTarget", target: 7 });
    expect(target.setTarget).toHaveBeenCalledWith(7);
    expect(resp).toEqual({ success: true, target: 7 });
  });

  it("rememberTarget clamps and persists by scope", () => {
    send({ action: "rememberTarget", scope: "channel", target: 99 });
    expect(target.persistChannelTarget).toHaveBeenCalledWith(30, expect.any(Function)); // clamped to the 30s cap
    send({ action: "rememberTarget", scope: "global", target: 12 });
    expect(target.persistGlobalTarget).toHaveBeenCalledWith(12, expect.any(Function));
    send({ action: "rememberTarget", scope: "site", target: 8 });
    expect(target.persistSiteTarget).toHaveBeenCalledWith(8, expect.any(Function));
  });

  it("resetTarget routes the scope and defaults to site", () => {
    expect(send({ action: "resetTarget", scope: "global" }).resp).toEqual({ success: true });
    expect(target.resetTargetScope).toHaveBeenCalledWith("global", expect.any(Function));
    send({ action: "resetTarget" });
    expect(target.resetTargetScope).toHaveBeenCalledWith("site", expect.any(Function));
  });

  it("reports failed target writes/resets", () => {
    target.persistSiteTarget.mockImplementationOnce((...args: unknown[]) => {
      const done = args[args.length - 1];
      if (typeof done === "function") done(false);
    });
    expect(send({ action: "rememberTarget", scope: "site", target: 8 }).resp).toEqual({
      success: false,
      target: 8,
    });

    target.resetTargetScope.mockImplementationOnce((...args: unknown[]) => {
      const done = args[args.length - 1];
      if (typeof done === "function") done(false);
    });
    expect(send({ action: "resetTarget", scope: "site" }).resp).toEqual({ success: false });
  });

  it("getTarget returns target + scope + channel context", () => {
    S.liveSyncTarget = 9;
    S.targetScope = "site";
    const { resp } = send({ action: "getTarget" });
    expect(resp).toEqual({
      target: 9,
      scope: "site",
      channel: "UCabc",
      channelKeys: ["UCabc"],
      channelName: "Cool Channel",
      live: false,
    });
  });
});

describe("getMonitor / getHistory", () => {
  it("getMonitor returns the monitor snapshot", () => {
    expect(send({ action: "getMonitor" }).resp).toEqual({ mock: "monitor" });
  });

  it("getHistory rounds and shapes the audio/buffer/auto-slow history", () => {
    const resp = send({ action: "getHistory" }).resp as {
      audio: number[][];
      audioStep: number;
      buffer: number[][];
      autoSlow: number[][];
      autoSlowStep: number;
    };
    expect(resp.audio).toEqual([[-10, -12]]);
    expect(resp.audioStep).toBe(150);
    expect(resp.buffer).toEqual([]);
    expect(resp.autoSlow).toEqual([[7, 1.4]]);
    expect(resp.autoSlowStep).toBe(100);
  });
});

describe("auto-slow actions", () => {
  it("setAutoSlow previews the clamped target live", () => {
    const { resp } = send({ action: "setAutoSlow", enabled: true, target: 99 });
    expect(autoslow.setAutoSlowPreview).toHaveBeenCalledWith({ target: 12 });
    expect((resp as { success: boolean }).success).toBe(true);
  });

  it("setAutoSlow falls back to the default target when none is given", () => {
    send({ action: "setAutoSlow", enabled: true }); // no target → NaN → default
    expect(autoslow.setAutoSlowPreview).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.any(Number) }),
    );
  });

  it("rememberAutoSlow persists the target by scope", () => {
    send({ action: "rememberAutoSlow", scope: "channel", enabled: true, target: 7 });
    expect(autoslow.persistChannelAutoSlow).toHaveBeenCalledWith(
      { target: 7 },
      expect.any(Function),
    );
    send({ action: "rememberAutoSlow", scope: "global", enabled: false, target: 5 });
    expect(autoslow.persistGlobalAutoSlow).toHaveBeenCalledWith(
      { target: 5 },
      expect.any(Function),
    );
    send({ action: "rememberAutoSlow", scope: "site", enabled: true, target: 6 });
    expect(autoslow.persistSiteAutoSlow).toHaveBeenCalledWith({ target: 6 }, expect.any(Function));
  });

  it("resetAutoSlow routes the scope and resetAutoSlowToSaved re-resolves", () => {
    send({ action: "resetAutoSlow", scope: "global" });
    expect(autoslow.resetAutoSlowScope).toHaveBeenCalledWith("global", expect.any(Function));
    send({ action: "resetAutoSlowToSaved" });
    expect(autoslow.applyResolvedAutoSlowFromStore).toHaveBeenCalled();
  });

  it("reports failed auto-slow writes/resets", () => {
    autoslow.persistSiteAutoSlow.mockImplementationOnce((...args: unknown[]) => {
      const done = args[args.length - 1];
      if (typeof done === "function") done(false);
    });
    expect(
      send({ action: "rememberAutoSlow", scope: "site", enabled: true, target: 6 }).resp,
    ).toEqual({ success: false });

    autoslow.resetAutoSlowScope.mockImplementationOnce((...args: unknown[]) => {
      const done = args[args.length - 1];
      if (typeof done === "function") done(false);
    });
    expect(send({ action: "resetAutoSlow", scope: "site" }).resp).toEqual({ success: false });
  });

  it("getAutoSlow replies with global enable plus resolved target and scope", () => {
    S.autoSlowEnabled = true;
    S.autoSlowTarget = 6;
    S.autoSlowScope = "site";
    const { resp } = send({ action: "getAutoSlow" });
    expect(resp).toMatchObject({ enabled: true, target: 6, scope: "site", channel: "UCabc" });
  });
});

describe("viewer frame actions", () => {
  it("setViewerState only runs in a frame with video", () => {
    const { resp } = send({ action: "setViewerState", mode: "theater" });
    expect(viewer.setViewerState).toHaveBeenCalledWith("theater", false);
    expect(resp).toEqual({ success: true, mode: "normal" });
  });

  it("passes the popup's confirmed live verdict into Viewer", () => {
    send({ action: "setViewerState", mode: "normal", live: true });
    expect(viewer.setViewerState).toHaveBeenCalledWith("normal", true);
  });

  it("setViewerState stays silent in a frame without video", () => {
    h.hasVideo = false;
    const { ret, called } = send({ action: "setViewerState", mode: "theater" });
    expect(ret).toBe(false);
    expect(called).toBe(false);
    expect(viewer.setViewerState).not.toHaveBeenCalled();
  });

  it("setViewerFit only runs in a frame with video", () => {
    const { resp } = send({ action: "setViewerFit", mode: "cover" });
    expect(viewer.setViewerFitMode).toHaveBeenCalledWith("cover", true);
    expect(resp).toEqual({ success: true, mode: "cover" });
  });

  it("setViewerFit stays silent in a frame without video", () => {
    h.hasVideo = false;
    const { ret, called } = send({ action: "setViewerFit", mode: "cover" });
    expect(ret).toBe(false);
    expect(called).toBe(false);
    expect(viewer.setViewerFitMode).not.toHaveBeenCalled();
  });

  it("reports failed viewer-auto writes/resets", () => {
    viewerAuto.persistSiteViewerAuto.mockImplementationOnce((...args: unknown[]) => {
      const done = args[args.length - 1];
      if (typeof done === "function") done(false);
    });
    expect(send({ action: "rememberViewerAuto", scope: "site", mode: "normal" }).resp).toEqual({
      success: false,
      mode: "normal",
    });

    viewerAuto.resetViewerAutoScope.mockImplementationOnce((...args: unknown[]) => {
      const done = args[args.length - 1];
      if (typeof done === "function") done(false);
    });
    expect(send({ action: "resetViewerAuto", scope: "site" }).resp).toEqual({ success: false });
  });

  it("reports failed viewer-fit writes/resets", () => {
    viewerFit.persistSiteViewerFit.mockImplementationOnce((...args: unknown[]) => {
      const done = args[args.length - 1];
      if (typeof done === "function") done(false);
    });
    expect(send({ action: "rememberViewerFit", scope: "site", mode: "cover" }).resp).toEqual({
      success: false,
      mode: "cover",
    });

    viewerFit.resetViewerFitScope.mockImplementationOnce((...args: unknown[]) => {
      const done = args[args.length - 1];
      if (typeof done === "function") done(false);
    });
    expect(send({ action: "resetViewerFit", scope: "site" }).resp).toEqual({ success: false });
  });
});

describe("unknown actions", () => {
  it("ignores an unrecognized action (returns false, never replies)", () => {
    const { ret, called } = send({ action: "totallyUnknown" });
    expect(ret).toBe(false);
    expect(called).toBe(false);
    expect(speed.setSpeed).not.toHaveBeenCalled();
  });

  it("ignores a message with no action", () => {
    const { ret, called } = send({});
    expect(ret).toBe(false);
    expect(called).toBe(false);
  });
});

describe("replyFromVideoFrame fallback", () => {
  it("a subframe without a video stays silent (returns false)", () => {
    h.hasVideo = false;
    Object.defineProperty(window, "top", { value: {}, configurable: true });
    const { ret, called } = send({ action: "getSpeed" });
    expect(ret).toBe(false);
    expect(called).toBe(false);
  });

  it("the top frame without a video replies after a deferred fallback", () => {
    vi.useFakeTimers();
    h.hasVideo = false; // window.top === window (top frame)
    let called = false;
    const ret = h.listener!({ action: "getSpeed" }, {}, () => {
      called = true;
    });
    expect(ret).toBe(true);
    expect(called).toBe(false); // not yet
    vi.advanceTimersByTime(60);
    expect(called).toBe(true); // deferred reply fired
    vi.useRealTimers();
  });
});
