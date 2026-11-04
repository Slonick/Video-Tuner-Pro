import {
  MIN_FORWARD_BUFFER,
  CATCHUP_MAX,
  CATCHUP_STEP_LAG,
  CATCHUP_START,
} from "../core/constants.js";

export interface CatchupInput {
  buffer: number;
  latency: number | null;
  dropped: number;
  target: number; // already floored at MIN_FORWARD_BUFFER
  reserve: number; // buffer reserve (s) — the stall-safe cushion, user-configurable
}

// The buffer level catch-up must never drain below. With a real
// latency-to-broadcaster reading the floor is the allowed delay, but capped at
// the buffer reserve (default 3s): when the lag is far larger than the buffer,
// fully reaching a high allowed-delay would be impossible anyway — chasing it
// just drains the buffer toward a stall. Capping the reserve lets catch-up spend
// the surplus buffer to claw back as much lag as it can while still keeping a
// stall-safe cushion. (e.g. lag 24s, buffer 16s, delay 5s, reserve 3s → catch-up
// drains 16→3 and pulls lag 24→~11, instead of touching 0.) Without latency the
// lag IS the buffer, so the floor stays at the bare minimum.
export function catchupBufferFloor(
  latency: number | null,
  target: number,
  reserve: number,
): number {
  return latency != null ? Math.min(reserve, target) : MIN_FORWARD_BUFFER;
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
  const byBuffer =
    Math.floor((o.buffer - catchupBufferFloor(o.latency, o.target, o.reserve)) * 20) / 20;
  return 1 + Math.max(0, Math.min(CATCHUP_MAX - 1, byLag, byBuffer));
}

// Gate a fresh step decision behind a minimum dwell on the currently applied one.
// Every playbackRate write restarts the audio time-stretcher with an audible
// click, and the buffer sawtooths across the 5%-step boundaries (segments append
// in ~2s bursts while playback drains continuously), so applying every decision
// as it flips clicks on each control tick. Holding each step for the dwell caps
// that at one write per dwell window. Bailing to 1× stays immediate — that's the
// anti-stall / dropped-frames path, and reaching the target should end catch-up
// without lingering at a stale step.
export function settleCatchupRate(
  desired: number,
  applied: number,
  sinceChangeMs: number,
  dwellMs: number,
): number {
  if (desired <= 1) return desired;
  return sinceChangeMs < dwellMs ? applied : desired;
}

// True when we're clearly behind the live edge but the buffer is too thin to
// catch up at all (not even the smallest 5% step) — latency will stay high
// until the buffer refills, which the UI warns about. Needs a latency reading:
// on the buffer fallback the lag IS the buffer, which can't be both large and thin.
export function catchupBufferLimited(
  latency: number | null,
  buffer: number,
  target: number,
  reserve: number,
): boolean {
  return (
    latency != null &&
    latency > target + CATCHUP_START &&
    buffer < catchupBufferFloor(latency, target, reserve) + 0.05
  );
}
