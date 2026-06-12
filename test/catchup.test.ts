import { describe, it, expect } from "vitest";
import { decideCatchupSpeed, catchupBufferLimited } from "../src/content/live/catchup.js";

// constants: MIN_FORWARD_BUFFER=1.0, CATCHUP_START=2.0, CATCHUP_STOP=0.3
const base = { target: 5, rate: 1.5, dropped: 0, buffer: 8, latency: null as number | null, currentSpeed: 1 };

describe("decideCatchupSpeed — start (at 1×)", () => {
  it("stays 1× when within the allowed delay", () => {
    expect(decideCatchupSpeed({ ...base, buffer: 3 })).toBe(1);          // lag 3 < target+START(7)
  });
  it("starts catching up once clearly behind with enough buffer", () => {
    expect(decideCatchupSpeed({ ...base, buffer: 8 })).toBe(1.5);        // lag 8 > 7, buffer ok
  });
  it("latency drives the lag when exposed (buffer may be small)", () => {
    expect(decideCatchupSpeed({ ...base, latency: 8, buffer: 2 })).toBe(1.5);
  });
  it("won't start if the buffer is too low to do it safely (anti-stall)", () => {
    expect(decideCatchupSpeed({ ...base, latency: 8, buffer: 1.2 })).toBe(1); // buffer ≤ 1.3
  });
  it("buffer-fallback (no latency) matches buffer-as-lag", () => {
    expect(decideCatchupSpeed({ ...base, latency: null, buffer: 6 })).toBe(1);   // 6 < 7
    expect(decideCatchupSpeed({ ...base, latency: null, buffer: 8 })).toBe(1.5); // 8 > 7
  });
});

describe("decideCatchupSpeed — stop (catching up at rate)", () => {
  const up = { ...base, currentSpeed: 1.5 };
  it("stops once back near the target", () => {
    expect(decideCatchupSpeed({ ...up, latency: 5.2 })).toBe(1);         // 5.2 ≤ target+STOP(5.3)
  });
  it("bails if frames drop", () => {
    expect(decideCatchupSpeed({ ...up, latency: 8, dropped: 2 })).toBe(1);
  });
  it("bails if the buffer runs low (anti-stall)", () => {
    expect(decideCatchupSpeed({ ...up, latency: 8, buffer: 0.3 })).toBe(1);
  });
  it("never drains the buffer below the 1s floor", () => {
    expect(decideCatchupSpeed({ ...up, latency: 30, buffer: 0.9 })).toBe(1);
  });
  it("keeps catching up while still behind with buffer", () => {
    expect(decideCatchupSpeed({ ...up, latency: 8, buffer: 5 })).toBe(1.5);
  });
});

describe("decideCatchupSpeed — no oscillation", () => {
  it("after a buffer-floor stop, won't restart unless clearly behind again", () => {
    // Latency stuck at 6.5 (target 5) — above STOP but below START. At 1× it must
    // NOT restart (6.5 < target+START 7), so no speed flapping.
    expect(decideCatchupSpeed({ ...base, currentSpeed: 1, latency: 6.5, buffer: 2 })).toBe(1);
  });
});

describe("catchupBufferLimited (the UI warning)", () => {
  it("warns when far behind with a too-thin buffer", () => {
    expect(catchupBufferLimited(30, 1.1, 5)).toBe(true);
  });
  it("quiet when the buffer is healthy", () => {
    expect(catchupBufferLimited(30, 4, 5)).toBe(false);
  });
  it("quiet when not behind, however small the buffer", () => {
    expect(catchupBufferLimited(5.5, 1.1, 5)).toBe(false);
  });
});
