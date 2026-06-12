import { describe, it, expect } from "vitest";
import { rmsToDb, deriveOutDb } from "../src/content/audio/levels.js";

describe("rmsToDb", () => {
  it("silence floors at -100 dB", () => {
    expect(rmsToDb(new Float32Array(8))).toBe(-100);
  });
  it("full-scale (rms 1) is 0 dB", () => {
    expect(rmsToDb([1, 1, 1, 1])).toBeCloseTo(0, 6);
  });
  it("half amplitude ≈ -6 dB", () => {
    expect(rmsToDb([0.5, 0.5, 0.5, 0.5])).toBeCloseTo(-6.02, 1);
  });
  it("below the noise floor → -100", () => {
    expect(rmsToDb([1e-6, 1e-6])).toBe(-100);
  });
});

describe("deriveOutDb", () => {
  it("silence stays silent", () => {
    expect(deriveOutDb(-100, -6, true, 10)).toBe(-100);
  });
  it("output = input + reduction + make-up when on", () => {
    expect(deriveOutDb(-30, -6, true, 10)).toBe(-26);
  });
  it("no make-up when off", () => {
    expect(deriveOutDb(-30, -6, false, 10)).toBe(-36);
  });
  it("transparent (no reduction, no make-up) → output == input", () => {
    expect(deriveOutDb(-30, 0, false, 10)).toBe(-30);
  });
});
