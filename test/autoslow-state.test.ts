import { describe, it, expect, beforeEach, vi } from "vitest";
import { PACE } from "../src/content/audio/pace.js";
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
    expect(autoSlowHist).toHaveLength(90); // ≈9 s at one sample per 100 ms
    expect(autoSlowHist[0].rate).toBe(110);
    expect(autoSlowHist[autoSlowHist.length - 1].rate).toBe(199);
  });

  it("exposes a positive sample interval", () => {
    expect(AUTO_SLOW_HIST_MS).toBeGreaterThan(0);
  });
});

describe("initial readout", () => {
  it("starts inactive at the default ceiling with an empty history", async () => {
    // A fresh module instance: the shared one above is cleared before every test.
    vi.resetModules();
    const fresh = await import("../src/content/audio/autoslow-state.js");
    expect(fresh.autoSlowLive).toEqual({
      active: false,
      rate: 0,
      target: PACE.TARGET_RATE,
      speed: 1,
    });
    expect(fresh.autoSlowHist).toEqual([]);
  });
});
