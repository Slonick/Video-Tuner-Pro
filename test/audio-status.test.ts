import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// engageAudio re-applies compression a few times after the toggle flips, because
// the first try often misses (src loading, context suspended, <video> swapped).
const m = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock("../src/content/audio/compressor.js", () => ({ applyAudioComp: m.apply }));

import { S } from "../src/content/state.js";
import { engageAudio } from "../src/content/audio/status.js";

const engaged = (n: number) => ({ engaged: n, skipped: 0, reason: null });
const skipped = (reason: string) => ({ engaged: 0, skipped: 1, reason });

describe("engageAudio", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    m.apply.mockReset();
    S.audioCompEnabled = true;
  });
  afterEach(() => vi.useRealTimers());

  it("does nothing when compression is disabled", () => {
    S.audioCompEnabled = false;
    engageAudio();
    expect(m.apply).not.toHaveBeenCalled();
  });

  it("stops immediately once a graph engages", () => {
    m.apply.mockReturnValue(engaged(1));
    engageAudio();
    vi.advanceTimersByTime(5000);
    expect(m.apply).toHaveBeenCalledTimes(1);
  });

  it("retries every 500 ms until it engages", () => {
    m.apply
      .mockReturnValueOnce(engaged(0))
      .mockReturnValueOnce(engaged(0))
      .mockReturnValue(engaged(1));
    engageAudio();
    expect(m.apply).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    expect(m.apply).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(m.apply).toHaveBeenCalledTimes(3); // engaged → no more
    vi.advanceTimersByTime(2000);
    expect(m.apply).toHaveBeenCalledTimes(3);
  });

  it("stops retrying when the element is already in use (can't ever route)", () => {
    m.apply.mockReturnValue(skipped("inuse"));
    engageAudio();
    vi.advanceTimersByTime(5000);
    expect(m.apply).toHaveBeenCalledTimes(1);
  });

  it("gives up after ~6 retries (7 attempts) when it never engages", () => {
    m.apply.mockReturnValue(skipped("cors"));
    engageAudio();
    vi.advanceTimersByTime(10000);
    expect(m.apply).toHaveBeenCalledTimes(7);
  });
});
