import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { streamBitrate } from "../src/content/bitrate.js";

// streamBitrate estimates download rate from the decoder's byte counter over a
// sliding window. Drive Date.now() with fake timers and feed a fake decoder.
type Decoder = HTMLVideoElement & { webkitVideoDecodedByteCount?: number; webkitAudioDecodedByteCount?: number };
const video = (bytes?: number): Decoder =>
  ({ webkitVideoDecodedByteCount: bytes, webkitAudioDecodedByteCount: 0 } as Decoder);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
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
    streamBitrate(v);                       // t=0, 0 bytes
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
    streamBitrate(v);                       // valid reading
    vi.setSystemTime(2500);
    v.webkitVideoDecodedByteCount = 100;    // counter dropped → history cleared
    expect(streamBitrate(v)).toBeNull();    // only one sample again
  });
});
