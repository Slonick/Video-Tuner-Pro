import { MIN_FORWARD_BUFFER, CATCHUP_START, CATCHUP_STOP } from "../core/constants.js";

export interface CatchupInput {
  currentSpeed: number;
  buffer: number;
  latency: number | null;
  dropped: number;
  target: number;          // already floored at MIN_FORWARD_BUFFER
  rate: number;
}

// Buffer needed to sustain catch-up at `rate`: the floor plus what one full
// control interval (worst case 1s between ticks) drains at that rate. At 3×
// playback eats 2s of buffer per second — a thin low-latency buffer can die
// between two checks, so the reserve scales with the rate.
export function catchupReserve(rate: number): number {
  return MIN_FORWARD_BUFFER + Math.max(0, rate - 1);
}

// Latency drives the lag where the site exposes it (else the buffer); the buffer
// still gates catch-up so it can't stall. Hysteresis (START vs STOP) + the
// rate-aware reserve avoid oscillation once latency can't be reduced further.
export function decideCatchupSpeed(o: CatchupInput): number {
  const lag = o.latency != null ? o.latency : o.buffer;
  const reserve = catchupReserve(o.rate);
  if (o.currentSpeed > 1.0) {
    if (lag <= o.target + CATCHUP_STOP || o.dropped > 0 || o.buffer <= reserve) return 1.0;
    return o.currentSpeed;
  }
  if (lag > o.target + CATCHUP_START && o.dropped === 0 && o.buffer > reserve + CATCHUP_STOP) return o.rate;
  return o.currentSpeed;
}

// True when we're clearly behind the live edge but the buffer is too thin to
// catch up safely (same gate decideCatchupSpeed uses) — latency will stay high
// until the buffer refills, which the UI warns about.
export function catchupBufferLimited(lag: number, buffer: number, target: number, rate: number): boolean {
  return lag > target + CATCHUP_START && buffer <= catchupReserve(rate) + CATCHUP_STOP;
}
