// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// messaging.ts registers one runtime.onMessage listener at import. Capture it via
// a mocked api, then invoke each action and assert the right speed.ts call + the
// reply payload, including the video-frame vs top-frame fallback.
const h = vi.hoisted(() => ({
  listener: null as null | ((req: unknown, sender: unknown, send: (r?: unknown) => void) => boolean),
  hasVideo: true,
  onStream: false,
  channel: "UCabc" as string | null,
  channelName: "Cool Channel",
}));

vi.mock("../src/content/platform/browser.js", () => ({
  api: { runtime: { onMessage: { addListener: (fn: typeof h.listener) => { h.listener = fn; } } } },
}));
vi.mock("../src/content/channel.js", () => ({
  currentChannel: () => h.channel, currentChannelName: () => h.channelName,
}));
vi.mock("../src/content/videos.js", () => ({ collectVideos: () => (h.hasVideo ? [{}] : []) }));
vi.mock("../src/content/live/detection.js", () => ({ onStreamPage: () => h.onStream }));
const speed = vi.hoisted(() => ({
  setSpeed: vi.fn(), persistDomainSpeed: vi.fn(), persistChannelSpeed: vi.fn(), resetChannelSpeed: vi.fn(),
}));
vi.mock("../src/content/speed.js", () => speed);
vi.mock("../src/content/monitor.js", () => ({ monitorData: () => ({ mock: "monitor" }) }));
vi.mock("../src/content/audio/metering.js", () => ({ audioLevelHist: [{ in: -10, out: -12 }], A_HIST_MS: 150 }));
vi.mock("../src/content/bitrate.js", () => ({ bufferLevelHist: [] }));

import { S } from "../src/content/state.js";
import "../src/content/messaging.js";

function send(req: unknown): { ret: boolean; resp: unknown; called: boolean } {
  let resp: unknown, called = false;
  const ret = h.listener!(req, {}, (r?: unknown) => { called = true; resp = r; });
  return { ret, resp, called };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.hasVideo = true; h.onStream = false; h.channel = "UCabc"; h.channelName = "Cool Channel";
  S.currentSpeed = 1.0;
  try { Object.defineProperty(window, "top", { value: window, configurable: true }); } catch (e) { /* ignore */ }
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
});

describe("rememberSite / rememberChannel / resetChannel", () => {
  it("rememberSite clamps and persists the domain speed", () => {
    const { resp } = send({ action: "rememberSite", speed: 99 });
    expect(speed.persistDomainSpeed).toHaveBeenCalled();
    const passed = speed.persistDomainSpeed.mock.calls[0][0];
    expect(passed).toBeLessThanOrEqual(16); // clamped
    expect((resp as { success: boolean }).success).toBe(true);
  });

  it("rememberSite without a number falls back to the current speed", () => {
    S.currentSpeed = 1.3;
    send({ action: "rememberSite" });
    expect(speed.persistDomainSpeed).toHaveBeenCalledWith(1.3);
  });

  it("rememberChannel persists the channel speed", () => {
    send({ action: "rememberChannel", speed: 1.2 });
    expect(speed.persistChannelSpeed).toHaveBeenCalledWith(1.2);
  });

  it("resetChannel resets and acknowledges", () => {
    const { resp } = send({ action: "resetChannel" });
    expect(speed.resetChannelSpeed).toHaveBeenCalled();
    expect(resp).toEqual({ success: true });
  });
});

describe("getSpeed", () => {
  it("returns speed + domain + channel context", () => {
    S.currentSpeed = 1.25;
    const { resp } = send({ action: "getSpeed" });
    expect(resp).toEqual({ speed: 1.25, domain: "localhost", channel: "UCabc", channelName: "Cool Channel", live: false });
  });
});

describe("getMonitor / getHistory", () => {
  it("getMonitor returns the monitor snapshot", () => {
    expect(send({ action: "getMonitor" }).resp).toEqual({ mock: "monitor" });
  });

  it("getHistory rounds and shapes the audio/buffer history", () => {
    const resp = send({ action: "getHistory" }).resp as { audio: number[][]; audioStep: number; buffer: number[][] };
    expect(resp.audio).toEqual([[-10, -12]]);
    expect(resp.audioStep).toBe(150);
    expect(resp.buffer).toEqual([]);
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
    const ret = h.listener!({ action: "getSpeed" }, {}, () => { called = true; });
    expect(ret).toBe(true);
    expect(called).toBe(false);   // not yet
    vi.advanceTimersByTime(60);
    expect(called).toBe(true);    // deferred reply fired
    vi.useRealTimers();
  });
});
