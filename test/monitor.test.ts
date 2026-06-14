import { describe, it, expect, vi, beforeEach } from "vitest";

// monitorData assembles the popup's live readout: it plots latency where the site
// exposes it (Twitch/YouTube), else the buffered-ahead seconds, and computes the
// thin-buffer warning. Mock its data sources and assert the selection logic.
const h = vi.hoisted(() => ({
  primary: null as unknown,
  onStream: false,
  latency: null as number | null,
  buffer: 0,
  limited: false,
  bitrate: null as number | null,
  levels: { active: false, enabled: true, translation: false },
}));
vi.mock("../src/content/videos.js", () => ({ primaryVideo: () => h.primary }));
vi.mock("../src/content/live/detection.js", () => ({ onStreamPage: () => h.onStream }));
vi.mock("../src/content/live/metrics.js", () => ({ forwardBuffer: () => h.buffer, streamLatency: () => h.latency }));
vi.mock("../src/content/live/catchup.js", () => ({ catchupBufferLimited: () => h.limited }));
vi.mock("../src/content/audio/compressor.js", () => ({ applyAudioComp: vi.fn() }));
vi.mock("../src/content/audio/metering.js", () => ({ audioLevels: () => h.levels }));
vi.mock("../src/content/bitrate.js", () => ({ streamBitrate: () => h.bitrate }));

import { S } from "../src/content/state.js";
import { monitorData } from "../src/content/monitor.js";

beforeEach(() => {
  h.primary = null; h.onStream = false; h.latency = null; h.buffer = 0; h.limited = false; h.bitrate = null;
  S.liveSyncEnabled = false; S.liveSyncTarget = 5;
});

describe("monitorData", () => {
  it("reports no video / no live metrics when nothing is playing", () => {
    const d = monitorData();
    expect(d.hasVideo).toBe(false);
    expect(d.live).toBe(false);
    expect(d.buffer).toBeNull();
    expect(d.bufferAhead).toBeNull();
    expect(d.bitrate).toBeNull();
  });

  it("plots site latency and rides the buffered-ahead seconds alongside it", () => {
    h.primary = {}; h.onStream = true; h.latency = 4.2; h.buffer = 9;
    const d = monitorData();
    expect(d.buffer).toBe(4.2);       // latency is the plotted value
    expect(d.bufferAhead).toBe(9);    // buffer rides along separately
  });

  it("falls back to the buffered-ahead seconds when the site exposes no latency", () => {
    h.primary = {}; h.onStream = true; h.latency = null; h.buffer = 6;
    const d = monitorData();
    expect(d.buffer).toBe(6);
    expect(d.bufferAhead).toBeNull(); // no dupe when buffer IS the plotted value
  });

  it("surfaces the thin-buffer warning only while live-sync is on", () => {
    h.primary = {}; h.onStream = true; h.latency = 12; h.buffer = 1; h.limited = true;
    expect(monitorData().bufLimited).toBe(false); // sync off → never warns
    S.liveSyncEnabled = true;
    expect(monitorData().bufLimited).toBe(true);
  });

  it("reports bitrate only on a live video", () => {
    h.bitrate = 5_000_000;
    h.primary = {}; h.onStream = false;
    expect(monitorData().bitrate).toBeNull();
    h.onStream = true;
    expect(monitorData().bitrate).toBe(5_000_000);
  });
});
