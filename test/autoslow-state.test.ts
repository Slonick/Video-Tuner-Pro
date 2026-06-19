import { describe, it, expect, beforeEach } from "vitest";
import {
  autoSlowHist,
  recordAutoSlowSample,
  AUTO_SLOW_HIST_MS,
} from "../src/content/audio/autoslow-state.js";

beforeEach(() => {
  autoSlowHist.length = 0;
});

describe("recordAutoSlowSample", () => {
  it("appends {rate, speed} samples in order", () => {
    recordAutoSlowSample(7, 1.4);
    recordAutoSlowSample(6, 1.5);
    expect(autoSlowHist).toEqual([
      { rate: 7, speed: 1.4 },
      { rate: 6, speed: 1.5 },
    ]);
  });

  it("caps the rolling buffer, keeping the most recent", () => {
    for (let i = 0; i < 200; i++) recordAutoSlowSample(i, 1);
    expect(autoSlowHist.length).toBeLessThanOrEqual(90);
    expect(autoSlowHist[autoSlowHist.length - 1].rate).toBe(199);
  });

  it("exposes a positive sample interval", () => {
    expect(AUTO_SLOW_HIST_MS).toBeGreaterThan(0);
  });
});
