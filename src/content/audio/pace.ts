// Estimates how dense ("fast") the speech currently sounds and, from that,
// suggests a temporary playback speed that keeps the *perceived* density under a
// comfort ceiling — no ASR, no neural nets.
//
// Method: energy-envelope modulation analysis. Naive peak-counting of the RMS
// envelope undercounts fast continuous speech, because the level stays high
// without dipping to silence between syllables. Instead we high-pass the RMS to
// isolate the syllable-rate modulation (~2–10 Hz) and count its positive-going
// zero-crossings — robust to absolute level. (Approach adapted from the
// ywong137/speech-speed extension's "v3" detector.) We measure on the audio the
// listener actually hears (post-speed), so the rate already reflects how dense it
// sounds at the current playback rate.
//
// This file is pure (no DOM / Web Audio) so the estimator and controller can be
// unit-tested by feeding synthetic envelopes.

export const PACE = {
  SAMPLE_MS: 30, // RMS sampled at ~33 Hz — the rate the reference detector is tuned for
  WINDOW_MS: 4000, // sliding window the syllable rate is averaged over
  REFRACTORY_MS: 70, // min gap between two nuclei → caps the estimate near ~14 syll/s
  HP_ALPHA: 0.9, // high-pass of the RMS (~0.5 Hz cutoff at 33 Hz) — extracts syllable modulation
  ENV_ALPHA: 0.3, // one-pole low-pass envelope, for the silence gate
  MIN_ENERGY: 0.003, // RMS floor — below this is silence, nothing is counted
  TARGET_RATE: 6, // comfort ceiling (syll/sec at sensitivity 50) we slow down to stay under
  COMP_STRENGTH: 0.7, // 0..1 — how far toward full compensation each step eases (lower = gentler)
};

// Linear map of a 0..100 setting onto a [lo, hi] range. Backs the "reaction" and
// "ease-back" knobs (how fast the speed is allowed to move per step).
export function rampStep(pct: number, lo: number, hi: number): number {
  const p = Math.min(100, Math.max(0, pct));
  return lo + (p / 100) * (hi - lo);
}

// Counts syllable nuclei in a rolling window from a stream of RMS samples, via
// zero-crossings of the high-passed envelope. `push` one RMS reading per
// SAMPLE_MS, then read `rate`.
export class SyllableMeter {
  private env = 0; // low-pass envelope — silence gate
  private hp = 0; // high-passed RMS — the syllable-rate modulation
  private prevRms = 0;
  private prevHp = 0;
  private lastFireMs = -Infinity;
  private firstMs = NaN;
  private lastMs = 0;
  private nuclei: number[] = []; // timestamps (ms) of recent nuclei

  reset(): void {
    this.env = 0;
    this.hp = 0;
    this.prevRms = 0;
    this.prevHp = 0;
    this.lastFireMs = -Infinity;
    this.firstMs = NaN;
    this.lastMs = 0;
    this.nuclei.length = 0;
  }

  // Feed one RMS reading (linear, 0..1) taken at time `tMs`.
  push(rms: number, tMs: number): void {
    const P = PACE;
    if (Number.isNaN(this.firstMs)) this.firstMs = tMs;
    this.lastMs = tMs;
    this.env += (rms - this.env) * P.ENV_ALPHA;
    // DC-removing high-pass of the RMS: leaves only the syllable-rate oscillation.
    const hp = P.HP_ALPHA * (this.hp + rms - this.prevRms);
    // A positive-going zero-crossing of the high-passed envelope = one syllable
    // nucleus — works even in continuous fast speech, where the level never dips.
    if (
      this.prevHp <= 0 &&
      hp > 0 &&
      this.env > P.MIN_ENERGY && // gated to actual speech, not silence
      tMs - this.lastFireMs >= P.REFRACTORY_MS
    ) {
      this.nuclei.push(tMs);
      this.lastFireMs = tMs;
    }
    this.prevRms = rms;
    this.prevHp = hp;
    this.hp = hp;

    const cutoff = tMs - P.WINDOW_MS;
    while (this.nuclei.length && this.nuclei[0] < cutoff) this.nuclei.shift();
  }

  // Perceived syllables/sec over the trailing window.
  // Nuclei per second over the window. Divides by the elapsed span (capped at the
  // window) so the estimate is right from the first second, not artificially low
  // while the window fills.
  rate(): number {
    const span = Math.min(this.lastMs - this.firstMs, PACE.WINDOW_MS);
    return span > 250 ? this.nuclei.length / (span / 1000) : 0;
  }
}

// Given the perceived syllable rate and the speed it was measured at, suggest the
// effective playback speed.
//
// `perceivedRate` already includes the current speed, so the speed-invariant
// intrinsic rate is `perceivedRate / effSpeed`. `veFull = target / intrinsic` is
// the speed that would hold the perceived rate exactly at the comfort ceiling —
// but easing all the way there slams to the floor the moment speech gets dense.
// Instead we ease only COMP_STRENGTH of the way toward it, so the slowdown grows
// gradually with density and reaches the floor only on genuinely fast passages.
// Both `veFull` (and therefore the suggestion) are independent of the current
// speed, so the controller still converges rather than oscillating.
//
// Clamped to [floor, userSpeed]: never speeds up past what the user asked for, nor
// below their floor. If they're already watching below the floor, nothing to do.
export function suggestEffectiveSpeed(
  perceivedRate: number,
  effSpeed: number,
  userSpeed: number,
  floor: number,
  target: number = PACE.TARGET_RATE,
): number {
  if (effSpeed <= 0 || userSpeed <= 0) return userSpeed;
  const intrinsic = perceivedRate / effSpeed;
  if (intrinsic <= 0) return userSpeed;
  const veFull = target / intrinsic; // full compensation
  if (veFull >= userSpeed) return userSpeed; // not dense enough at this speed → leave it
  const ve = userSpeed - (userSpeed - veFull) * PACE.COMP_STRENGTH; // partial → gradual
  return Math.max(Math.min(floor, userSpeed), Math.min(userSpeed, ve));
}
