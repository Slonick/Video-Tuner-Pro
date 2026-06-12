import { MIN_FORWARD_BUFFER, CATCHUP_START, CATCHUP_STOP } from "../core/constants.js";

export interface CatchupInput {
  currentSpeed: number;
  buffer: number;
  latency: number | null;
  dropped: number;
  target: number;          // already floored at MIN_FORWARD_BUFFER
  rate: number;
}

// Latency drives the lag where the site exposes it (else the buffer); the buffer
// still gates catch-up so it can't stall. Hysteresis (START vs STOP) + the buffer
// floor avoid oscillation once latency can't be reduced further.
export function decideCatchupSpeed(o: CatchupInput): number {
  const lag = o.latency != null ? o.latency : o.buffer;
  if (o.currentSpeed > 1.0) {
    if (lag <= o.target + CATCHUP_STOP || o.dropped > 0 || o.buffer <= MIN_FORWARD_BUFFER) return 1.0;
    return o.currentSpeed;
  }
  if (lag > o.target + CATCHUP_START && o.dropped === 0 && o.buffer > MIN_FORWARD_BUFFER + CATCHUP_STOP) return o.rate;
  return o.currentSpeed;
}

// True when we're clearly behind the live edge but the buffer is too thin to
// catch up safely (same gate decideCatchupSpeed uses) — latency will stay high
// until the buffer refills, which the UI warns about.
export function catchupBufferLimited(lag: number, buffer: number, target: number): boolean {
  return lag > target + CATCHUP_START && buffer <= MIN_FORWARD_BUFFER + CATCHUP_STOP;
}
