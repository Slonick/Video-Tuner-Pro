import { createGraphState, A_WINDOW, BUF_WINDOW, AS_WINDOW } from "./state.js";
import { now } from "./draw-util.js";
import { drawAudio } from "./audio-meter.js";
import { drawBuffer } from "./latency-graph.js";
import { drawAutoSlow } from "./autoslow-graph.js";
import { startPoll } from "./poll.js";

// Drive the audio + buffer canvases. `getTabId` supplies the tab to poll (the
// popup resolves it asynchronously); `onTranslating` reports VOT state up to React
// so the audio card can lock itself. Returns a teardown that stops the rAF + poll.
export function setupGraphs(
  getTabId: () => number | null,
  onTranslating: (on: boolean) => void,
  onBlocked: (reason: string | null) => void,
): () => void {
  const aCanvas = document.getElementById("audioMeter") as HTMLCanvasElement | null;
  const bCanvas = document.getElementById("bufferMeter") as HTMLCanvasElement | null;
  const asCanvas = document.getElementById("autoSlowMeter") as HTMLCanvasElement | null;
  const acx = aCanvas ? aCanvas.getContext("2d") : null;
  const bcx = bCanvas ? bCanvas.getContext("2d") : null;
  const ascx = asCanvas ? asCanvas.getContext("2d") : null;
  if (!aCanvas || !acx || !bCanvas || !bcx) return () => {};
  const g = createGraphState(aCanvas, acx, bCanvas, bcx, asCanvas, ascx);
  let raf = 0;

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
      g.audioHist.length = 0;
      g.audioInShown = g.audioOutShown = null;
    }
    // Same for the buffer: ease toward the latest poll reading and record a point
    // every frame, so the live (right) edge advances smoothly. The poll only fires
    // ~13×/s, which otherwise makes the leading edge step.
    if (g.bufLive && g.bufSmooth != null) {
      g.bufCur = g.bufCur == null ? g.bufSmooth : g.bufCur + (g.bufSmooth - g.bufCur) * 0.3;
      g.bufCurAhead =
        g.bufAheadSmooth == null
          ? null
          : g.bufCurAhead == null
            ? g.bufAheadSmooth
            : g.bufCurAhead + (g.bufAheadSmooth - g.bufCurAhead) * 0.3;
      g.bufHist.push({ t, v: g.bufCur, a: g.bufCurAhead });
      while (g.bufHist.length && t - g.bufHist[0].t > BUF_WINDOW + 1000) g.bufHist.shift();
    } else {
      g.bufCur = g.bufCurAhead = null;
    }
    // Auto-slow speech graph: ease toward the latest polled rate/speed and record
    // a point per frame so the line scrolls smoothly.
    if (g.asActive) {
      g.asRateCur += (g.asRate - g.asRateCur) * 0.3;
      g.asSpeedCur += (g.asSpeed - g.asSpeedCur) * 0.3;
      g.asHist.push({ t, rate: g.asRateCur, speed: g.asSpeedCur });
      while (g.asHist.length && t - g.asHist[0].t > AS_WINDOW + 200) g.asHist.shift();
    } else if (g.asHist.length) {
      g.asHist.length = 0;
    }
    drawAudio(g, t);
    drawBuffer(g, t);
    drawAutoSlow(g, t);
    raf = requestAnimationFrame(frame);
  }

  const stopPoll = startPoll(g, getTabId, onTranslating, onBlocked);
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    stopPoll();
  };
}
