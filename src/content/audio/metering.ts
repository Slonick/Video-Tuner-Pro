import { ctxValid } from "../platform/browser.js";
import { S } from "../state.js";
import { primaryVideo } from "../videos.js";
import { compOn, translationActive } from "./translation.js";
import { audioContext, graphForCurrentSource, lastSkip } from "./routing.js";
import { rmsToDb, deriveOutDb } from "./levels.js";
import type { AudioGraph, AudioLevels } from "./types.js";

// Recent {in,out} dB samples kept while a graph exists (≈7s at 150ms).
export const audioLevelHist: { in: number; out: number }[] = [];
export const A_HIST_MS = 150;
const A_HIST_MAX = 48;

export function audioSamplingReady(): boolean {
  const ctx = audioContext();
  return !!ctx && ctx.state === "running";
}

// Only capture failures that make audio features currently unusable become a popup
// warning. Loading/VOT are transient; a suspended context needs a user gesture.
function blockReason(skip: string | null): {
  blocked?: "inuse" | "cors" | "noctx" | "suspended";
} {
  return skip === "inuse" || skip === "cors" || skip === "noctx" || skip === "suspended"
    ? { blocked: skip }
    : {};
}

function analyserDb(an: AnalyserNode): number {
  const buf = an._buf || (an._buf = new Float32Array(an.fftSize));
  an.getFloatTimeDomainData(buf);
  return rmsToDb(buf);
}

function audioOutDb(g: AudioGraph, inDb: number): number {
  const reduction = g.comp && typeof g.comp.reduction === "number" ? g.comp.reduction : 0;
  const limiterReduction =
    g.limiter && typeof g.limiter.reduction === "number" ? g.limiter.reduction : 0;
  return deriveOutDb(inDb, reduction + limiterReduction, compOn() ? S.audioCompGain : 0);
}

function translationStatus(): boolean {
  return S.audioCompEnabled && translationActive();
}

export function audioLevels(): AudioLevels {
  const v = primaryVideo();
  const g = v ? graphForCurrentSource(v) : null;
  // Report levels whenever the graph exists — even with compression off (it runs
  // transparent), so the meter and threshold preview stay live.
  if (!g || !g.analyserIn) {
    return {
      active: false,
      enabled: S.audioCompEnabled,
      translation: translationStatus(),
      // Surface a hard capture failure so the popup can warn + lock the audio cards
      // (monitor.ts runs applyAudioComp() right before this, so the skip is current).
      // Transient reasons (loading/VOT) are left off.
      ...blockReason(lastSkip(v)),
    };
  }
  const inDb = analyserDb(g.analyserIn);
  return {
    active: true,
    enabled: S.audioCompEnabled,
    in: inDb,
    out: audioOutDb(g, inDb),
    threshold: S.audioCompThreshold,
    knee: S.audioCompKnee, // the meter draws the soft-knee band; popup no longer has the slider
    translation: translationStatus(), // a voice-over translator is playing → compression is paused
  };
}

// Accumulate audio-level history whenever a graph already exists (no new routing),
// so re-opening the popup shows a pre-filled graph. One sample per call — the
// content entry schedules it every A_HIST_MS; keeping the body here (and the
// setInterval at the entry point) leaves this unit-testable.
export function recordAudioSample(): void {
  if (!ctxValid()) return;
  // No running AudioContext means no media has been routed yet — skip the
  // full-document walk that primaryVideo() does until there's actually a graph.
  if (!audioSamplingReady()) return;
  const v = primaryVideo();
  const g = v ? graphForCurrentSource(v) : null;
  if (!g || !g.analyserIn) return;
  const inDb = analyserDb(g.analyserIn);
  audioLevelHist.push({ in: inDb, out: audioOutDb(g, inDb) });
  while (audioLevelHist.length > A_HIST_MAX) audioLevelHist.shift();
}
