import { describe, it, expect } from "vitest";
import {
  decideCatchupSpeed,
  catchupBufferLimited,
  catchupBufferFloor,
} from "../src/content/live/catchup.js";

// constants: MIN_FORWARD_BUFFER=1.0, CATCHUP_MAX=1.25, CATCHUP_STEP_LAG=7,
// CATCHUP_START=2.0 (warning threshold).
// 105% just past the target (deadband 1s), +5% per full 7s of excess, ≤125%;
// the buffer caps the step by the same 5% scale.
const base = { target: 5, dropped: 0, buffer: 60, latency: null as number | null, reserve: 3 };

describe("decideCatchupSpeed — stepped ramp", () => {
  it("stays 1× at or near the allowed delay", () => {
    expect(decideCatchupSpeed({ ...base, latency: 4 })).toBe(1);
    expect(decideCatchupSpeed({ ...base, latency: 5.9 })).toBe(1); // within the 1s deadband
  });
  it("105% just past the target, +5% per full 7s of excess", () => {
    expect(decideCatchupSpeed({ ...base, latency: 6.5 })).toBe(1.05); // excess 1.5s
    expect(decideCatchupSpeed({ ...base, latency: 12.1 })).toBe(1.1); // excess ≥7s
    expect(decideCatchupSpeed({ ...base, latency: 19.1 })).toBe(1.15); // excess ≥14s
  });
  it("matches the spec example: target 3 → 110% from 10s, 115% from 17s", () => {
    const t3 = { ...base, target: 3 };
    expect(decideCatchupSpeed({ ...t3, latency: 9.9 })).toBe(1.05);
    expect(decideCatchupSpeed({ ...t3, latency: 10 })).toBe(1.1);
    expect(decideCatchupSpeed({ ...t3, latency: 17 })).toBe(1.15);
  });
  it("caps at 125% no matter how far behind", () => {
    expect(decideCatchupSpeed({ ...base, latency: 33.1 })).toBe(1.25); // excess ≥28s
    expect(decideCatchupSpeed({ ...base, latency: 300 })).toBe(1.25);
  });
  it("buffer-fallback (no latency) uses the buffer as the lag", () => {
    expect(decideCatchupSpeed({ ...base, latency: null, buffer: 5.5 })).toBe(1);
    expect(decideCatchupSpeed({ ...base, latency: null, buffer: 11 })).toBe(1.05);
  });
});

describe("decideCatchupSpeed — anti-stall guards", () => {
  it("with real latency, the buffer floor is min(3, allowed delay)", () => {
    // far behind, but the buffer barely exceeds the 3s reserve → small steps only
    expect(decideCatchupSpeed({ ...base, latency: 100, buffer: 3.06 })).toBe(1.05);
    expect(decideCatchupSpeed({ ...base, latency: 100, buffer: 3.19 })).toBe(1.15);
    expect(decideCatchupSpeed({ ...base, latency: 100, buffer: 3.0 })).toBe(1);
    expect(decideCatchupSpeed({ ...base, latency: 100, buffer: 1.5 })).toBe(1);
  });
  it("spends surplus buffer down to the 3s reserve when lag far exceeds it", () => {
    // lag 24, buffer 16, delay 5 → reserve 3, so the buffer (13 above it) never
    // caps the step; catch-up runs at the lag-driven rate (excess 19 → +15%).
    expect(decideCatchupSpeed({ ...base, target: 5, latency: 24, buffer: 16 })).toBe(1.15);
    // …and as the buffer nears 3, byBuffer caps the step, stopping at the reserve.
    expect(decideCatchupSpeed({ ...base, target: 5, latency: 24, buffer: 3.1 })).toBe(1.1);
    expect(decideCatchupSpeed({ ...base, target: 5, latency: 24, buffer: 3.0 })).toBe(1);
  });
  it("without latency (buffer is the lag), the floor stays at the 1s minimum", () => {
    // lag = buffer = 11 → excess 6 → 105%; byBuffer (11-1=10) doesn't cap it
    expect(decideCatchupSpeed({ ...base, latency: null, buffer: 11 })).toBe(1.05);
  });
  it("bails if frames drop", () => {
    expect(decideCatchupSpeed({ ...base, latency: 100, dropped: 2 })).toBe(1);
  });
});

describe("catchupBufferLimited (the UI warning)", () => {
  it("warns when far behind with a buffer at/below the floor", () => {
    expect(catchupBufferLimited(30, 3.0, 5, 3)).toBe(true); // latency-based floor = min(3, target)
    expect(catchupBufferLimited(30, 1.5, 5, 3)).toBe(true);
  });
  it("quiet when the buffer sustains some catch-up", () => {
    expect(catchupBufferLimited(30, 6, 5, 3)).toBe(false);
    expect(catchupBufferLimited(30, 4, 5, 3)).toBe(false); // above the 3s reserve now
  });
  it("quiet when not behind, however small the buffer", () => {
    expect(catchupBufferLimited(5.5, 1.0, 5, 3)).toBe(false);
  });
  it("a larger reserve warns sooner (the cushion is wider)", () => {
    expect(catchupBufferLimited(30, 4, 5, 3)).toBe(false); // 4s clears the 3s reserve
    expect(catchupBufferLimited(30, 4, 5, 5)).toBe(true); // but not the 5s reserve
  });
});

describe("catchupBufferFloor", () => {
  it("min(reserve, allowed delay) with latency, bare 1s minimum without", () => {
    expect(catchupBufferFloor(12, 5, 3)).toBe(3); // delay above the reserve → capped at the reserve
    expect(catchupBufferFloor(12, 2, 3)).toBe(2); // delay below the reserve → the delay itself
    expect(catchupBufferFloor(12, 5, 6)).toBe(5); // reserve above the delay → capped at the delay
    expect(catchupBufferFloor(null, 5, 3)).toBe(1);
  });
});
