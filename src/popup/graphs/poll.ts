// Poll the page for monitor data ~13×/s and fold it into the shared graph state;
// the rAF loop interpolates between samples. Also seeds both graphs once from the
// background-collected history so they don't start empty.
import { api } from "../platform/browser.js";
import { now } from "./draw-util.js";
import { A_WINDOW, BUF_WINDOW } from "./state.js";
import type { GraphState, BufSample } from "./state.js";

// Poll the page ~13×/s and fold monitor data into the shared graph state. `getTabId`
// supplies the active tab; `onTranslating` reports VOT state to the caller (React).
// Returns a function that stops the interval.
export function startPoll(
  g: GraphState,
  getTabId: () => number | null,
  onTranslating: (on: boolean) => void,
): () => void {
  const id = setInterval(() => {
    const tabId = getTabId();
    if (tabId == null) return;
    api.tabs.sendMessage(tabId, { action: "getMonitor" }, (resp) => {
      if (api.runtime.lastError || !resp) {
        g.audioActive = false;
        onTranslating(false);
        return;
      }
      const a = resp.audio || {};
      const wasActive = g.audioActive;
      g.audioActive = !!a.active;
      g.audioEnabled = !!a.enabled;
      onTranslating(!!a.translation); // VOT etc. playing → warn + lock the section
      if (g.audioActive) {
        g.tgt.in = a.in;
        g.tgt.out = a.out;
        // Snap on (re)activation instead of easing up from the −100 floor, so the
        // very first readout shows the real level rather than a low ramp.
        if (!wasActive) {
          g.cur.in = a.in;
          g.cur.out = a.out;
        }
      }
      g.bufLive = !!resp.live;

      // Pre-fill both graphs once from the background-collected history so they
      // don't start empty (when there's any history to fill them with).
      if (!g.histSeeded && (g.audioActive || g.bufLive)) {
        g.histSeeded = true;
        api.tabs.sendMessage(tabId, { action: "getHistory" }, (r) => {
          if (api.runtime.lastError || !r) return;
          const t0 = now();
          if (r.audio && r.audio.length) {
            const step = r.audioStep || 150,
              n = r.audio.length;
            const seed = r.audio.map((p: number[], i: number) => ({
              t: t0 - (n - 1 - i) * step,
              in: p[0],
              out: p[1],
            }));
            g.audioHist.unshift(...seed);
            while (g.audioHist.length && t0 - g.audioHist[0].t > A_WINDOW + 200)
              g.audioHist.shift();
          }
          if (r.buffer && r.buffer.length) {
            const seedB = r.buffer
              .map((p: number[]) => ({ t: t0 - p[0], v: p[1] }))
              .sort((x: BufSample, y: BufSample) => x.t - y.t);
            g.bufHist.unshift(...seedB);
            if (g.bufSmooth == null && seedB.length) g.bufSmooth = seedB[seedB.length - 1].v;
            while (g.bufHist.length && t0 - g.bufHist[0].t > BUF_WINDOW + 1000) g.bufHist.shift();
          }
        });
      }
      if (g.bufLive && typeof resp.buffer === "number") {
        const t = now();
        // Smooth the raw reading (it sawtooths per segment) before plotting.
        const raw = Number(resp.buffer);
        const bs = g.bufSmooth == null ? raw : g.bufSmooth + (raw - g.bufSmooth) * 0.18;
        g.bufSmooth = bs;
        // Buffer-ahead, smoothed the same way, plotted as its own line. Null when
        // the site doesn't expose latency (then the primary line IS the buffer).
        const rawA = typeof resp.bufferAhead === "number" ? resp.bufferAhead : null;
        const as =
          rawA == null
            ? null
            : g.bufAheadSmooth == null
              ? rawA
              : g.bufAheadSmooth + (rawA - g.bufAheadSmooth) * 0.18;
        g.bufAheadSmooth = as;
        // The point itself is recorded per-frame (see graphs/index.ts) so the live
        // edge advances smoothly; here we only update the eased targets above.
        g.bufBitrate = typeof resp.bitrate === "number" ? resp.bitrate : null;
        g.bufAhead = as;
        g.bufLimited = !!resp.bufLimited;
        // Refresh the displayed values at most once a second so the digits sit still.
        if (g.bufShown == null || t - g.bufShownAt > 1000) {
          g.bufShown = bs;
          g.bufShownAt = t;
        }
        if (g.bufBitrateShown == null || t - g.bufBitrateAt > 1000) {
          g.bufBitrateShown = g.bufBitrate;
          g.bufBitrateAt = t;
        }
        if (g.bufAheadAt === 0 || t - g.bufAheadAt > 1000) {
          g.bufAheadShown = g.bufAhead;
          g.bufAheadAt = t;
        }
      } else {
        // Not a live stream — the graph is meaningless, so keep it empty.
        g.bufHist.length = 0;
        g.bufSmooth = null;
        g.bufShown = null;
        g.bufShownAt = 0;
        g.bufBitrate = g.bufBitrateShown = null;
        g.bufAhead = g.bufAheadSmooth = g.bufAheadShown = null;
        g.bufAheadAt = 0;
        g.bufLimited = false;
      }
    });
  }, 75);
  return () => clearInterval(id);
}
