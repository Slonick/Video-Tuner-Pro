// Poll the page for monitor data ~13×/s and fold it into the shared graph state;
// the rAF loop interpolates between samples. Also seeds both graphs once from the
// background-collected history so they don't start empty.
import { api } from "../platform/browser.js";
import { ctx } from "../state.js";
import { now } from "./draw-util.js";
import { A_WINDOW, BUF_WINDOW } from "./state.js";
import type { GraphState, BufSample } from "./state.js";
import { setAudioTranslating } from "./translation-warn.js";

export function startPoll(g: GraphState): void {
  setInterval(() => {
    const tabId = ctx.activeTabId;
    if (tabId == null) return;
    api.tabs.sendMessage(tabId, { action: "getMonitor" }, (resp) => {
      if (api.runtime.lastError || !resp) { g.audioActive = false; setAudioTranslating(false); return; }
      const a = resp.audio || {};
      const wasActive = g.audioActive;
      g.audioActive = !!a.active;
      g.audioEnabled = !!a.enabled;
      setAudioTranslating(!!a.translation);  // VOT etc. playing → warn + lock the section
      if (g.audioActive) {
        g.tgt.in = a.in; g.tgt.out = a.out;
        // Snap on (re)activation instead of easing up from the −100 floor, so the
        // very first readout shows the real level rather than a low ramp.
        if (!wasActive) { g.cur.in = a.in; g.cur.out = a.out; }
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
            const step = r.audioStep || 150, n = r.audio.length;
            const seed = r.audio.map((p: number[], i: number) => ({ t: t0 - (n - 1 - i) * step, in: p[0], out: p[1] }));
            g.audioHist.unshift(...seed);
            while (g.audioHist.length && t0 - g.audioHist[0].t > A_WINDOW + 200) g.audioHist.shift();
          }
          if (r.buffer && r.buffer.length) {
            const seedB = r.buffer.map((p: number[]) => ({ t: t0 - p[0], v: p[1] })).sort((x: BufSample, y: BufSample) => x.t - y.t);
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
        g.bufHist.push({ t, v: bs });
        while (g.bufHist.length && t - g.bufHist[0].t > BUF_WINDOW + 1000) g.bufHist.shift();
        g.bufBitrate = typeof resp.bitrate === "number" ? resp.bitrate : null;
        // Refresh the displayed value at most once a second so the digits sit still.
        if (g.bufBitrateShown == null || t - g.bufBitrateAt > 1000) {
          g.bufBitrateShown = g.bufBitrate; g.bufBitrateAt = t;
        }
      } else {
        // Not a live stream — the graph is meaningless, so keep it empty.
        g.bufHist.length = 0; g.bufSmooth = null;
        g.bufBitrate = g.bufBitrateShown = null;
      }
    });
  }, 75);
}
