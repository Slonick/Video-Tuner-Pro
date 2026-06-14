import { MIN_FORWARD_BUFFER, MAX_BUFFER_RESERVE, CATCHUP_MAX, CATCHUP_STEP_LAG, CATCHUP_START } from "../core/constants.js";

export interface CatchupInput {
  buffer: number;
  latency: number | null;
  dropped: number;
  target: number;          // already floored at MIN_FORWARD_BUFFER
}

// The buffer level catch-up must never drain below. With a real
// latency-to-broadcaster reading the floor is the allowed delay, but capped at
// MAX_BUFFER_RESERVE (3s): when the lag is far larger than the buffer, fully
// reaching a high allowed-delay would be impossible anyway — chasing it just
// drains the buffer toward a stall. Capping the reserve at 3s lets catch-up
// spend the surplus buffer to claw back as much lag as it can while still
// keeping a stall-safe cushion. (e.g. lag 24s, buffer 16s, delay 5s → reserve
// 3s, so catch-up drains 16→3 and pulls lag 24→~11, instead of touching 0.)
// Without latency the lag IS the buffer, so the floor stays at the bare minimum.
export function catchupBufferFloor(latency: number | null, target: number): number {
  return latency != null ? Math.min(MAX_BUFFER_RESERVE, target) : MIN_FORWARD_BUFFER;
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
  const byBuffer = Math.floor((o.buffer - catchupBufferFloor(o.latency, o.target)) * 20) / 20;
  return 1 + Math.max(0, Math.min(CATCHUP_MAX - 1, byLag, byBuffer));
}

// True when we're clearly behind the live edge but the buffer is too thin to
// catch up at all (not even the smallest 5% step) — latency will stay high
// until the buffer refills, which the UI warns about.
export function catchupBufferLimited(latency: number | null, buffer: number, target: number): boolean {
  const lag = latency != null ? latency : buffer;
  return lag > target + CATCHUP_START && buffer < catchupBufferFloor(latency, target) + 0.05;
}
