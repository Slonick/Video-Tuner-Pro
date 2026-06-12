import { createGraphState, A_WINDOW } from "./state.js";
import { now } from "./draw-util.js";
import { drawAudio } from "./audio-meter.js";
import { drawBuffer } from "./latency-graph.js";
import { startPoll } from "./poll.js";

export function setupGraphs(): void {
  const aCanvas = document.getElementById("audioMeter") as HTMLCanvasElement | null;
  const bCanvas = document.getElementById("bufferMeter") as HTMLCanvasElement | null;
  const acx = aCanvas ? aCanvas.getContext("2d") : null;
  const bcx = bCanvas ? bCanvas.getContext("2d") : null;
  if (!aCanvas || !acx || !bCanvas || !bcx) return;
  const g = createGraphState(aCanvas, acx, bCanvas, bcx);

  function frame(): void {
    const t = now();
    g.cur.in += (g.tgt.in - g.cur.in) * 0.3;
    g.cur.out += (g.tgt.out - g.cur.out) * 0.3;
    g.compAnim += ((g.audioEnabled ? 1 : 0) - g.compAnim) * 0.12; // morph readout/ghost on toggle
    // Record the eased level each frame so the waveform scrolls smoothly.
    if (g.audioActive) {
      g.audioHist.push({ t, in: g.cur.in, out: g.cur.out });
      while (g.audioHist.length && t - g.audioHist[0].t > A_WINDOW + 200) g.audioHist.shift();
    } else if (g.audioHist.length) {
      g.audioHist.length = 0; g.audioDiffShown = null;
    }
    drawAudio(g, t);
    drawBuffer(g, t);
    requestAnimationFrame(frame);
  }

  startPoll(g);
  requestAnimationFrame(frame);
}
