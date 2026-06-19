// Live readout for the popup's speech graph — perceived rate, the trigger target,
// and the resulting effective speed. Kept in its own tiny module (pace.js is pure)
// so the monitor can read it without pulling in the sampler's DOM dependencies.
import { PACE } from "./pace.js";

export const autoSlowLive = { active: false, rate: 0, target: PACE.TARGET_RATE, speed: 1 };

// Recent {rate, speed} samples (≈9s at 100ms) so a re-opened popup shows a
// pre-filled speech graph instead of an empty one.
export const autoSlowHist: { rate: number; speed: number }[] = [];
export const AUTO_SLOW_HIST_MS = 100;
const HIST_MAX = 90;

export function recordAutoSlowSample(rate: number, speed: number): void {
  autoSlowHist.push({ rate, speed });
  while (autoSlowHist.length > HIST_MAX) autoSlowHist.shift();
}
