import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Controls for the live-stream sampler's data sources.
const h = vi.hoisted(() => ({
  onStream: false,
  live: null as unknown,
  latency: null as number | null,
  buffer: 0,
}));
vi.mock("../src/content/live/detection.js", () => ({
  onStreamPage: () => h.onStream,
  liveVideo: () => h.live,
}));
vi.mock("../src/content/live/metrics.js", () => ({
  streamLatency: () => h.latency,
  forwardBuffer: () => h.buffer,
}));

import { streamBitrate, recordBufferSample, bufferLevelHist } from "../src/content/bitrate.js";

// streamBitrate estimates download rate from the decoder's byte counter over a
// sliding window. Drive Date.now() with fake timers and feed a fake decoder.
type Decoder = HTMLVideoElement & {
  webkitVideoDecodedByteCount?: number;
  webkitAudioDecodedByteCount?: number;
};
const video = (bytes?: number): Decoder =>
  ({ webkitVideoDecodedByteCount: bytes, webkitAudioDecodedByteCount: 0 }) as Decoder;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe("streamBitrate", () => {
  it("null without a video", () => {
    expect(streamBitrate(null)).toBeNull();
  });

  it("null when the decoder counter is unavailable (e.g. Firefox)", () => {
    expect(streamBitrate(video(undefined))).toBeNull();
  });

  it("null on the first sample (needs two points)", () => {
    expect(streamBitrate(video(0))).toBeNull();
  });

  it("null until at least ~1s of data has accumulated", () => {
    const v = video(0);
    streamBitrate(v);
    vi.setSystemTime(500);
    v.webkitVideoDecodedByteCount = 1_000_000;
    expect(streamBitrate(v)).toBeNull(); // dt < 1s
  });

  it("computes bits/s across the window once enough data exists", () => {
    const v = video(0);
    streamBitrate(v); // t=0, 0 bytes
    vi.setSystemTime(2000);
    v.webkitVideoDecodedByteCount = 2_000_000;
    // (2,000,000 bytes * 8) / 2s = 8,000,000 bit/s
    expect(streamBitrate(v)).toBeCloseTo(8_000_000, -3);
  });

  it("resets the history when the counter goes backwards (seek / quality switch)", () => {
    const v = video(0);
    streamBitrate(v);
    vi.setSystemTime(2000);
    v.webkitVideoDecodedByteCount = 2_000_000;
    streamBitrate(v); // valid reading
    vi.setSystemTime(2500);
    v.webkitVideoDecodedByteCount = 100; // counter dropped → history cleared
    expect(streamBitrate(v)).toBeNull(); // only one sample again
  });
});

describe("recordBufferSample", () => {
  beforeEach(() => {
    bufferLevelHist.length = 0;
    h.onStream = false;
    h.live = null;
    h.latency = null;
    h.buffer = 0;
  });

  it("clears the history and skips when off a stream page", () => {
    bufferLevelHist.push({ at: 0, v: 5 });
    h.onStream = false;
    recordBufferSample();
    expect(bufferLevelHist.length).toBe(0);
  });

  it("skips when there's no live video yet", () => {
    h.onStream = true;
    h.live = null;
    recordBufferSample();
    expect(bufferLevelHist.length).toBe(0);
  });

  it("samples site latency where exposed", () => {
    h.onStream = true;
    h.live = {};
    h.latency = 3.5;
    h.buffer = 8;
    recordBufferSample();
    expect(bufferLevelHist.at(-1)?.v).toBe(3.5);
  });

  it("falls back to the buffered-ahead seconds without site latency", () => {
    h.onStream = true;
    h.live = {};
    h.latency = null;
    h.buffer = 6;
    recordBufferSample();
    expect(bufferLevelHist.at(-1)?.v).toBe(6);
  });

  it("caps the history at 64 samples", () => {
    h.onStream = true;
    h.live = {};
    h.latency = 2;
    for (let i = 0; i < 80; i++) recordBufferSample();
    expect(bufferLevelHist.length).toBe(64);
  });
});
