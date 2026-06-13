import { describe, it, expect } from "vitest";
import { decideCatchupSpeed, catchupBufferLimited, catchupReserve } from "../src/content/live/catchup.js";

// constants: MIN_FORWARD_BUFFER=1.0, CATCHUP_MAX=1.25, CATCHUP_STEP_LAG=7,
// CATCHUP_START=2.0 (warning threshold).
// 105% just past the target (deadband 1s), +5% per full 7s of excess, ≤125%;
// the buffer caps the step by the same 5% scale.
const base = { target: 5, dropped: 0, buffer: 60, latency: null as number | null };

describe("decideCatchupSpeed — stepped ramp", () => {
  it("stays 1× at or near the allowed delay", () => {
    expect(decideCatchupSpeed({ ...base, latency: 4 })).toBe(1);
    expect(decideCatchupSpeed({ ...base, latency: 5.9 })).toBe(1);   // within the 1s deadband
  });
  it("105% just past the target, +5% per full 7s of excess", () => {
    expect(decideCatchupSpeed({ ...base, latency: 6.5 })).toBe(1.05);   // excess 1.5s
    expect(decideCatchupSpeed({ ...base, latency: 12.1 })).toBe(1.1);   // excess ≥7s
    expect(decideCatchupSpeed({ ...base, latency: 19.1 })).toBe(1.15);  // excess ≥14s
  });
  it("matches the spec example: target 3 → 110% from 10s, 115% from 17s", () => {
    const t3 = { ...base, target: 3 };
    expect(decideCatchupSpeed({ ...t3, latency: 9.9 })).toBe(1.05);
    expect(decideCatchupSpeed({ ...t3, latency: 10 })).toBe(1.1);
    expect(decideCatchupSpeed({ ...t3, latency: 17 })).toBe(1.15);
  });
  it("caps at 125% no matter how far behind", () => {
    expect(decideCatchupSpeed({ ...base, latency: 33.1 })).toBe(1.25);  // excess ≥28s
    expect(decideCatchupSpeed({ ...base, latency: 300 })).toBe(1.25);
  });
  it("buffer-fallback (no latency) uses the buffer as the lag", () => {
    expect(decideCatchupSpeed({ ...base, latency: null, buffer: 5.5 })).toBe(1);
    expect(decideCatchupSpeed({ ...base, latency: null, buffer: 11 })).toBe(1.05);
  });
});

describe("decideCatchupSpeed — anti-stall guards", () => {
  it("a thin buffer sustains a small step rather than none", () => {
    // far behind, but the buffer only covers a small step (reserve = 1 + rate-1)
    expect(decideCatchupSpeed({ ...base, latency: 100, buffer: 1.06 })).toBe(1.05);
    expect(decideCatchupSpeed({ ...base, latency: 100, buffer: 1.19 })).toBe(1.15);
  });
  it("no speed-up at all below the 1s buffer floor", () => {
    expect(decideCatchupSpeed({ ...base, latency: 100, buffer: 1.0 })).toBe(1);
    expect(decideCatchupSpeed({ ...base, latency: 100, buffer: 0.4 })).toBe(1);
  });
  it("bails if frames drop", () => {
    expect(decideCatchupSpeed({ ...base, latency: 100, dropped: 2 })).toBe(1);
  });
});

describe("catchupBufferLimited (the UI warning)", () => {
  it("warns when far behind with a buffer too thin for even the smallest step", () => {
    expect(catchupBufferLimited(30, 1.0, 5)).toBe(true);
  });
  it("quiet when the buffer sustains some catch-up", () => {
    expect(catchupBufferLimited(30, 4, 5)).toBe(false);
  });
  it("quiet when not behind, however small the buffer", () => {
    expect(catchupBufferLimited(5.5, 1.0, 5)).toBe(false);
  });
});

describe("catchupReserve", () => {
  it("scales with the catch-up rate", () => {
    expect(catchupReserve(1.05)).toBe(1.05);
    expect(catchupReserve(1.25)).toBe(1.25);
  });
});
