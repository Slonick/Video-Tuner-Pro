import { describe, it, expect } from "vitest";
import { SyllableMeter, suggestEffectiveSpeed, rampStep, PACE } from "../src/content/audio/pace.js";

// Drive the meter with a synthetic raised-sine envelope at `freq` Hz for
// `seconds`, sampled at PACE.SAMPLE_MS, then read the rate. The sine stands in
// for the loudness rise/fall of one syllable per cycle.
function runEnvelope(freq: number, seconds: number, base = 0.02, amp = 0.1): number {
  const m = new SyllableMeter();
  const dt = PACE.SAMPLE_MS;
  for (let t = 0; t <= seconds * 1000; t += dt) {
    const rms = base + amp * (0.5 + 0.5 * Math.sin((2 * Math.PI * freq * t) / 1000));
    m.push(rms, t);
  }
  return m.rate();
}

describe("SyllableMeter", () => {
  it("counts roughly one nucleus per envelope cycle (4 Hz → ~4 syll/s)", () => {
    const r = runEnvelope(4, 3);
    expect(r).toBeGreaterThan(3);
    expect(r).toBeLessThan(5);
  });

  it("tracks a slower 2 Hz envelope at a proportionally lower rate", () => {
    const r = runEnvelope(2, 3);
    expect(r).toBeGreaterThan(1.3);
    expect(r).toBeLessThan(3);
  });

  it("reports a higher rate for denser (6 Hz) speech than for sparse (3 Hz)", () => {
    expect(runEnvelope(6, 3)).toBeGreaterThan(runEnvelope(3, 3));
  });

  it("reports zero for silence", () => {
    const m = new SyllableMeter();
    for (let t = 0; t <= 2000; t += PACE.SAMPLE_MS) m.push(0, t);
    expect(m.rate()).toBe(0);
  });

  it("a steady tone produces no sustained syllable stream", () => {
    const m = new SyllableMeter();
    // Only the silence→tone onset registers; a constant level has no modulation,
    // so the rate stays far below any speech rate.
    for (let t = 0; t <= 4000; t += PACE.SAMPLE_MS) m.push(0.2, t);
    expect(m.rate()).toBeLessThan(1);
  });

  it("reset() clears the rolling window", () => {
    const m = new SyllableMeter();
    for (let t = 0; t <= 2000; t += PACE.SAMPLE_MS) {
      m.push(0.02 + 0.1 * (0.5 + 0.5 * Math.sin((2 * Math.PI * 4 * t) / 1000)), t);
    }
    expect(m.rate()).toBeGreaterThan(0);
    m.reset();
    expect(m.rate()).toBe(0);
  });
});

describe("suggestEffectiveSpeed", () => {
  it("leaves the speed alone when density is low", () => {
    expect(suggestEffectiveSpeed(2, 2, 2, 1)).toBe(2);
  });

  it("hard knee (softKnee 0) fully compensates to the target", () => {
    // perceived 8 at 2× → intrinsic 4 → clamp perceived to target 6 → 6/4 = 1.5×.
    expect(suggestEffectiveSpeed(8, 2, 2, 1, 6, 0)).toBeCloseTo(1.5, 5);
  });

  it("soft knee engages gradually inside the band", () => {
    // intrinsic 2.5 → at 2× perceived is 5, inside the knee [4,8] (target 6, ±2):
    // q = 5 − (5−6+2)²/8 = 4.875 → 4.875/2.5 = 1.95× — barely slowed.
    expect(suggestEffectiveSpeed(5, 2, 2, 1, 6, 2)).toBeCloseTo(1.95, 5);
  });

  it("soft knee leaves the speed alone below the band (target − knee)", () => {
    // perceived 4 at 2× → intrinsic 2, p = 4 = target − 2 → no slowdown.
    expect(suggestEffectiveSpeed(4, 2, 2, 1, 6, 2)).toBeCloseTo(2, 5);
  });

  it("a wider knee starts slowing earlier than a narrow one", () => {
    const wide = suggestEffectiveSpeed(5, 2, 2, 1, 6, 2); // band [4,8] → engaged
    const narrow = suggestEffectiveSpeed(5, 2, 2, 1, 6, 0.5); // band [5.5,6.5] → not yet
    expect(wide).toBeLessThan(narrow);
    expect(narrow).toBeCloseTo(2, 5);
  });

  it("reaches the floor only on very dense speech", () => {
    expect(suggestEffectiveSpeed(40, 2, 2, 1)).toBe(1); // intrinsic 20 → floored
    expect(suggestEffectiveSpeed(20, 2, 3, 1.5)).toBe(1.5);
  });

  it("never speeds up past the user's speed", () => {
    expect(suggestEffectiveSpeed(8, 2, 2, 1)).toBeLessThanOrEqual(2);
  });

  it("does nothing when the user is already watching below the floor", () => {
    expect(suggestEffectiveSpeed(12, 0.8, 0.8, 1)).toBe(0.8);
  });
});

describe("rampStep", () => {
  it("maps the 0..100 setting linearly onto [lo, hi]", () => {
    expect(rampStep(0, 0.04, 0.25)).toBeCloseTo(0.04, 5);
    expect(rampStep(100, 0.04, 0.25)).toBeCloseTo(0.25, 5);
    expect(rampStep(50, 0.04, 0.25)).toBeCloseTo(0.145, 5);
  });

  it("clamps out-of-range input", () => {
    expect(rampStep(-10, 0.02, 0.18)).toBe(0.02);
    expect(rampStep(150, 0.02, 0.18)).toBe(0.18);
  });
});
