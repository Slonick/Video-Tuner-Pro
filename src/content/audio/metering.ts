import { ctxValid } from "../platform/browser.js";
import { S } from "../state.js";
import { primaryVideo } from "../videos.js";
import { translationActive } from "./translation.js";
import { audioContext, audioGraphs } from "./routing.js";
import { rmsToDb, deriveOutDb } from "./levels.js";
import type { AudioGraph, AudioLevels } from "./types.js";

// Recent {in,out} dB samples kept while a graph exists (≈7s at 150ms).
export const audioLevelHist: { in: number; out: number }[] = [];
export const A_HIST_MS = 150;
const A_HIST_MAX = 48;

function analyserDb(an: AnalyserNode): number {
  const buf = an._buf || (an._buf = new Float32Array(an.fftSize));
  an.getFloatTimeDomainData(buf);
  return rmsToDb(buf);
}

function audioOutDb(g: AudioGraph, inDb: number): number {
  const reduction = (g.comp && typeof g.comp.reduction === "number") ? g.comp.reduction : 0;
  return deriveOutDb(inDb, reduction);
}

export function audioLevels(): AudioLevels {
  const v = primaryVideo();
  const g = v ? audioGraphs.get(v) : null;
  // Report levels whenever the graph exists — even with compression off (it runs
  // transparent), so the meter and threshold preview stay live.
  if (!g || !g.analyserIn) {
    return { active: false, enabled: S.audioCompEnabled, translation: translationActive() };
  }
  const inDb = analyserDb(g.analyserIn);
  return {
    active: true,
    enabled: S.audioCompEnabled,
    in: inDb,
    out: audioOutDb(g, inDb),
    threshold: S.audioCompThreshold,
    translation: translationActive(),  // a voice-over translator is playing → compression is paused
  };
}

// Accumulate audio-level history whenever a graph already exists (no new routing),
// so re-opening the popup shows a pre-filled graph. One sample per call — the
// content entry schedules it every A_HIST_MS; keeping the body here (and the
// setInterval at the entry point) leaves this unit-testable.
export function recordAudioSample(): void {
  if (!ctxValid()) return;
  const v = primaryVideo();
  const g = v ? audioGraphs.get(v) : null;
  const ctx = audioContext();
  if (!g || !g.analyserIn || !ctx || ctx.state !== "running") return;
  const inDb = analyserDb(g.analyserIn);
  audioLevelHist.push({ in: inDb, out: audioOutDb(g, inDb) });
  while (audioLevelHist.length > A_HIST_MAX) audioLevelHist.shift();
}
