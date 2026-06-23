// Drives S.autoSlowFactor from the primary video's input analyser: measure how
// dense the speech sounds (SyllableMeter), ask pace.ts for a comfortable speed,
// and ramp the factor toward it. The pure DSP lives in pace.ts; this file is the
// browser-wired glue (analyser reads, ramping, re-applying the rate).
import { S } from "../state.js";
import { primaryVideo } from "../videos.js";
import { isLive, onStreamPage } from "../live/detection.js";
import { reapplyPrimaryRate } from "../speed.js";
import { audioContext, audioGraphs } from "./routing.js";
import { rmsLinear } from "./levels.js";
import { SyllableMeter, suggestEffectiveSpeed, rampStep, PACE } from "./pace.js";
import { autoSlowLive, recordAutoSlowSample } from "./autoslow-state.js";

const APPLY_MS = 100; // how often we re-evaluate and move the factor
// The reaction / ease-back settings (0..100) map onto these per-step move caps
// (fraction of the user's speed changed per APPLY_MS). Slow-down can be brisker
// than recovery, so the ranges differ.
const REACTION_RANGE: [number, number] = [0.03, 0.18];
const EASEBACK_RANGE: [number, number] = [0.02, 0.16];

const meter = new SyllableMeter();
let buf: Float32Array<ArrayBuffer> | null = null;
let lastPrimary: HTMLVideoElement | null = null;
let appliedEff = 0; // effective speed we last drove toward (0 = uninitialised)
let lastApplyAt = -Infinity;
let lastDenseAt = -Infinity; // last time the perceived rate was at/over the ceiling

// Playback speed sampled each tick, kept over the same trailing window as the
// syllable meter. The perceived rate is a ~4 s average, so to recover a stable
// intrinsic rate we must divide it by the AVERAGE playback speed over that window —
// not the instantaneous one. Dividing by the current speed makes the estimate lurch
// while a speed change is still working its way through the window, which oscillates
// the controller (slam to the floor, jump back up, repeat).
const speedT: number[] = []; // sample timestamps (ms)
const speedV: number[] = []; // playback speed at each sample
function pushSpeed(s: number, now: number): void {
  speedT.push(now);
  speedV.push(s);
  const cutoff = now - PACE.WINDOW_MS;
  while (speedT.length && speedT[0] < cutoff) {
    speedT.shift();
    speedV.shift();
  }
}
function windowSpeed(): number {
  if (!speedV.length) return 0;
  let sum = 0;
  for (const s of speedV) sum += s;
  return sum / speedV.length;
}
function resetSpeedWindow(): void {
  speedT.length = 0;
  speedV.length = 0;
}

// Hand the rate back to the user's intended speed (factor → 1). Used when the
// feature is turned off or the analyser goes away mid-play.
function release(): void {
  meter.reset();
  resetSpeedWindow();
  appliedEff = 0;
  lastDenseAt = -Infinity;
  autoSlowLive.active = false;
  if (S.autoSlowFactor !== 1) {
    S.autoSlowFactor = 1;
    reapplyPrimaryRate();
  }
}

// One sample tick (scheduled at PACE.SAMPLE_MS by the content entry). Reads the
// primary analyser's RMS, feeds the meter, and every APPLY_MS nudges the factor.
export function autoSlowSample(): void {
  // Master off, or the hold-to-speed key is held (a deliberate temporary speed) →
  // stay out of the way and hand the rate back.
  if (!S.autoSlowEnabled || S.holdActive) {
    release();
    return;
  }
  const ctx = audioContext();
  if (!ctx || ctx.state !== "running") return;

  const v = primaryVideo();
  const g = v ? audioGraphs.get(v) : null;
  // Streams are owned by live-sync (which drives the rate to stay near the edge),
  // so auto-slow stays out — same as manual speed, which onStreamPage() also gates.
  if (!v || !g || !g.analyserIn || isLive(v) || onStreamPage() || v.paused) {
    release();
    return;
  }
  if (v !== lastPrimary) {
    lastPrimary = v;
    meter.reset();
    resetSpeedWindow();
    appliedEff = 0;
  }

  const an = g.analyserIn;
  if (!buf || buf.length !== an.fftSize) buf = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(buf);

  const now = Date.now();
  // ~23 ms RMS window — the high-pass detector reads the envelope's modulation, not peaks.
  meter.push(rmsLinear(buf), now);
  // Track the actual playback speed over the same window as the meter.
  pushSpeed(S.currentSpeed * S.autoSlowFactor, now);

  if (now - lastApplyAt < APPLY_MS) return;
  lastApplyAt = now;

  const user = S.currentSpeed;
  if (user <= 0) return;
  if (!appliedEff) appliedEff = user * S.autoSlowFactor;

  const target = S.autoSlowTarget; // comfort ceiling in syll/s — the graph's target line
  const rate = meter.rate();
  // Divide the windowed rate by the windowed speed (see speedT/speedV above) so the
  // intrinsic estimate stays steady through a speed change instead of oscillating.
  const measSpeed = windowSpeed() || appliedEff;
  const desired = suggestEffectiveSpeed(
    rate,
    measSpeed,
    user,
    S.autoSlowFloor,
    target,
    S.autoSlowKnee,
  );
  // "Dense" = perceived rate at/over the comfort ceiling. While it stays dense (or
  // within HOLD_MS of the last dense moment) we never ramp the speed back up — only
  // down — so a breath mid-passage doesn't bounce the speed.
  if (rate >= target) lastDenseAt = now;
  const holding = now - lastDenseAt < S.autoSlowHold * 1000;

  const stepDown = rampStep(S.autoSlowReaction, REACTION_RANGE[0], REACTION_RANGE[1]);
  const stepUp = rampStep(S.autoSlowEaseBack, EASEBACK_RANGE[0], EASEBACK_RANGE[1]);
  const span = user || 1;
  if (desired < appliedEff) {
    appliedEff = Math.max(desired, appliedEff - stepDown * span); // slow briskly
  } else if (!holding) {
    appliedEff = Math.min(desired, appliedEff + stepUp * span); // recover gently, after the hold
  }
  // Stay within [floor, user] even if the user just changed speed mid-slowdown —
  // we never speed up past their setting, nor below the floor.
  appliedEff = Math.min(user, Math.max(Math.min(S.autoSlowFloor, user), appliedEff));

  const factor = appliedEff / user;
  if (Math.abs(factor - S.autoSlowFactor) > 0.005) {
    S.autoSlowFactor = factor;
    reapplyPrimaryRate();
  }

  autoSlowLive.active = true;
  autoSlowLive.rate = rate;
  autoSlowLive.target = target;
  autoSlowLive.speed = appliedEff; // effective playback speed after the slowdown
  recordAutoSlowSample(rate, appliedEff);
}

export const AUTOSLOW_MS = PACE.SAMPLE_MS;
