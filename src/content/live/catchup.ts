import { MIN_FORWARD_BUFFER, CATCHUP_MAX, CATCHUP_STEP_LAG, CATCHUP_START } from "../core/constants.js";

export interface CatchupInput {
  buffer: number;
  latency: number | null;
  dropped: number;
  target: number;          // already floored at MIN_FORWARD_BUFFER
}

// Buffer needed to sustain catch-up at `rate`: the floor plus what one full
// control interval (worst case 1s between ticks) drains at that rate.
export function catchupReserve(rate: number): number {
  return MIN_FORWARD_BUFFER + Math.max(0, rate - 1);
}

// Stepped catch-up: 105% engages just past the allowed delay, and each full
// 7s of lag beyond it adds another +5% (e.g. target 3s → 110% from 10s,
// 115% from 17s …), capped at 125%. Pitch IS preserved; the low steps keep
// the time-stretcher's speech warble inaudible at the usual 105–110%.
// The buffer caps the rate by the same 5% scale (a thin buffer sustains a
// small step rather than none), and dropped frames pause catch-up entirely.
export function decideCatchupSpeed(o: CatchupInput): number {
  if (o.dropped > 0) return 1.0;
  const lag = o.latency != null ? o.latency : o.buffer;
  const excess = lag - o.target;
  if (excess < 1) return 1.0; // deadband: don't dither right at the target
  const byLag = 0.05 + Math.floor(excess / CATCHUP_STEP_LAG) * 0.05;
  const byBuffer = Math.floor((o.buffer - MIN_FORWARD_BUFFER) * 20) / 20; // inverse of catchupReserve
  return 1 + Math.max(0, Math.min(CATCHUP_MAX - 1, byLag, byBuffer));
}

// True when we're clearly behind the live edge but the buffer is too thin to
// catch up at all (not even the smallest 5% step) — latency will stay high
// until the buffer refills, which the UI warns about.
export function catchupBufferLimited(lag: number, buffer: number, target: number): boolean {
  return lag > target + CATCHUP_START && buffer < catchupReserve(1.05);
}
