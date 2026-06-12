import { byId } from "../dom.js";
import { col, fitCanvas } from "./draw-util.js";
import { A_MIN, A_MAX, A_WINDOW } from "./state.js";
import type { GraphState, AudioSample } from "./state.js";

const A_OVER = "#ff9f0a";                          // over-threshold highlight (== threshold colour)

function fmtMag(d: number): string {               // magnitude only; direction shown by the arrow
  const v = Math.abs(d);
  return (v < 10 ? v.toFixed(1) : Math.round(v)) + " dB";
}
function fmtLevel(db: number): string {
  const v = Math.max(A_MIN, Math.round(db));
  return (v < 0 ? "−" + (-v) : String(v)) + " dB";
}

export function drawAudio(g: GraphState, t: number): void {
  const acx = g.acx;
  const { w, h } = fitCanvas(g.aCanvas, acx);
  if (!w) return;
  const muted = col("--muted", "#888"), accent = col("--accent", "#0a84ff");
  acx.clearRect(0, 0, w, h);
  const waveW = w;
  const mid = h / 2, maxAmp = h / 2 - 1;
  const ampFor = (db: number) => ((Math.max(A_MIN, Math.min(A_MAX, db)) - A_MIN) / (A_MAX - A_MIN)) * maxAmp;
  const xFor = (ts: number) => waveW * (1 - (t - ts) / A_WINDOW);
  const thr = Number(byId<HTMLInputElement>("acThreshold").value);
  const thrAmp = Number.isNaN(thr) ? null : ampFor(thr);

  acx.strokeStyle = "rgba(127,127,127,0.18)"; acx.lineWidth = 1;
  acx.beginPath(); acx.moveTo(0, Math.round(mid) + 0.5); acx.lineTo(waveW, Math.round(mid) + 0.5); acx.stroke();
  // threshold guide — only on the input (bottom) half; that's what's compressed
  if (thrAmp != null) {
    acx.strokeStyle = "rgba(255,159,10,0.55)"; acx.setLineDash([3, 3]);
    acx.beginPath();
    acx.moveTo(0, Math.round(mid + thrAmp) + 0.5); acx.lineTo(waveW, Math.round(mid + thrAmp) + 0.5);
    acx.stroke(); acx.setLineDash([]);
  }

  // one half of the waveform: dir -1 = upward (output), +1 = downward (input)
  const half = (getDb: (p: AudioSample) => number, dir: number, color: string, fillAlpha: number) => {
    const pts = g.audioHist.map((p) => ({ x: xFor(p.t), a: ampFor(getDb(p)) }));
    acx.beginPath();
    acx.moveTo(pts[0].x, mid);
    for (let i = 0; i < pts.length; i++) acx.lineTo(pts[i].x, mid + dir * pts[i].a);
    acx.lineTo(pts[pts.length - 1].x, mid); acx.closePath();
    acx.globalAlpha = fillAlpha; acx.fillStyle = color; acx.fill(); acx.globalAlpha = 1;
    acx.strokeStyle = color; acx.lineWidth = 1;
    acx.beginPath();
    acx.moveTo(pts[0].x, mid + dir * pts[0].a);
    for (let i = 1; i < pts.length; i++) acx.lineTo(pts[i].x, mid + dir * pts[i].a);
    acx.stroke();
  };

  if (g.audioHist.length >= 2) {
    half((p) => p.out, -1, accent, 0.55);
    half((p) => p.in, 1, muted, 0.45);
    // Fill the input above the threshold, clipped to below the line. Opacity
    // grows with level so it only goes solid on loud peaks: faint at the
    // threshold, ramping through the knee (the soft transition, threshold →
    // threshold+knee), and reaching full opacity only near 0 dB.
    if (thrAmp != null) {
      const knee = Number(byId<HTMLInputElement>("acKnee").value) || 0;
      const yThr = mid + thrAmp;
      const yLoud = mid + maxAmp;               // 0 dB — the loudest
      const kneeFrac = Math.min(0.8, Math.max(0.05, knee / Math.max(1, -thr)));
      const grad = acx.createLinearGradient(0, yThr, 0, yLoud);
      grad.addColorStop(0, "rgba(255,159,10,0.10)");          // just over threshold
      grad.addColorStop(kneeFrac, "rgba(255,159,10,0.34)");   // through the knee
      grad.addColorStop(1, "rgba(255,159,10,1)");             // solid only when loud
      const pts = g.audioHist.map((p) => ({ x: xFor(p.t), a: ampFor(p.in) }));
      acx.save();
      acx.beginPath(); acx.rect(0, yThr, waveW, h - yThr); acx.clip();
      acx.fillStyle = grad;
      acx.beginPath();
      acx.moveTo(pts[0].x, mid);
      for (let i = 0; i < pts.length; i++) acx.lineTo(pts[i].x, mid + pts[i].a);
      acx.lineTo(pts[pts.length - 1].x, mid); acx.closePath();
      acx.fill();
      acx.restore();
    }

    // Ghost of the input level mirrored onto the output (top) half: the gap down
    // to the actual output is how much the compressor pulled the level off. Fades
    // in with the compressor (compAnim); when off, output == input so it vanishes.
    if (g.compAnim > 0.01) {
      const gp = g.audioHist.map((p) => ({ x: xFor(p.t), gi: mid - ampFor(p.in), go: mid - ampFor(p.out) }));
      acx.save();
      acx.globalAlpha = 0.18 * g.compAnim;          // "removed" band
      acx.fillStyle = A_OVER;
      acx.beginPath();
      acx.moveTo(gp[0].x, gp[0].gi);
      for (let i = 0; i < gp.length; i++) acx.lineTo(gp[i].x, gp[i].gi);
      for (let i = gp.length - 1; i >= 0; i--) acx.lineTo(gp[i].x, gp[i].go);
      acx.closePath(); acx.fill();
      acx.globalAlpha = 0.5 * g.compAnim;           // dashed "would-be" input level
      acx.strokeStyle = "rgb(214,218,226)"; acx.lineWidth = 1; acx.setLineDash([2, 2]);
      acx.beginPath(); acx.moveTo(gp[0].x, gp[0].gi);
      for (let i = 1; i < gp.length; i++) acx.lineTo(gp[i].x, gp[i].gi);
      acx.stroke(); acx.setLineDash([]);
      acx.restore();
    }
  }

  // Readout (throttled so digits sit still). OFF → just the current level; ON →
  // before → after with the change. compAnim morphs between the two on toggle.
  if (g.audioActive && g.audioHist.length) {
    const last = g.audioHist[g.audioHist.length - 1];
    if (g.audioDiffShown == null || t - g.audioDiffAt > 600) {
      g.audioDiffShown = last.out - last.in;
      g.audioOutShown = last.out; g.audioInShown = last.in;
      g.audioDiffAt = t;
    }
    const diff = g.audioDiffShown ?? 0, inV = g.audioInShown ?? A_MIN, outV = g.audioOutShown ?? A_MIN;
    const seg = col("--seg", "#2c2c2e");
    acx.lineJoin = "round";
    // OFF: single current level, fades out as the compressor turns on
    const offA = Math.max(0, Math.min(1, 1 - g.compAnim * 2.4));
    if (offA > 0.01) {
      acx.globalAlpha = offA;
      acx.font = "700 13px -apple-system, sans-serif";
      acx.textAlign = "center"; acx.textBaseline = "middle"; acx.lineWidth = 3.5;
      const lvl = fmtLevel(inV);
      acx.strokeStyle = seg; acx.strokeText(lvl, w / 2, mid);
      acx.fillStyle = "#c7c7cc"; acx.fillText(lvl, w / 2, mid);
      acx.globalAlpha = 1;
    }
    // ON: a single column — output (после) on top, input (до) on the bottom,
    // and in the middle the change magnitude with a triangle for direction
    // (up = louder/boost, down = the compressor cut). Fades in after OFF clears.
    const onA = Math.max(0, Math.min(1, (g.compAnim - 0.45) * 2.2));
    if (onA > 0.01) {
      acx.globalAlpha = onA;
      const d = diff, up = d >= 0, dc = col("--text", "#fff"), cxn = w / 2;
      // output (top) / input (bottom) — lighter, theme-aware tints so the values
      // read over their own (busy) waveform without an outline scrim.
      const outC = col("--meter-out", "#7fb8ff"), inC = col("--meter-in", "#cfcfd4");
      acx.font = "700 12px -apple-system, sans-serif"; acx.textBaseline = "middle"; acx.textAlign = "center"; acx.lineWidth = 3;
      const outL = fmtLevel(outV), inL = fmtLevel(inV);
      acx.strokeStyle = seg; acx.strokeText(outL, cxn, mid - 13);
      acx.fillStyle = outC; acx.fillText(outL, cxn, mid - 13);
      acx.strokeStyle = seg; acx.strokeText(inL, cxn, mid + 13);
      acx.fillStyle = inC; acx.fillText(inL, cxn, mid + 13);
      // middle: direction triangle + magnitude (the arrow replaces the +/− sign)
      const mag = fmtMag(d);
      acx.font = "700 11px -apple-system, sans-serif";
      const tw = acx.measureText(mag).width, triW = 8, gap = 3, sx = cxn - (triW + gap + tw) / 2, ty = mid;
      const tri = () => {
        acx.beginPath();
        if (up) { acx.moveTo(sx + triW / 2, ty - 4); acx.lineTo(sx, ty + 3); acx.lineTo(sx + triW, ty + 3); }
        else { acx.moveTo(sx + triW / 2, ty + 4); acx.lineTo(sx, ty - 3); acx.lineTo(sx + triW, ty - 3); }
        acx.closePath();
      };
      tri(); acx.lineWidth = 3; acx.strokeStyle = seg; acx.stroke();
      tri(); acx.fillStyle = dc; acx.fill();
      acx.textAlign = "left";
      acx.lineWidth = 3; acx.strokeStyle = seg; acx.strokeText(mag, sx + triW + gap, ty);
      acx.fillStyle = dc; acx.fillText(mag, sx + triW + gap, ty);
      acx.globalAlpha = 1;
    }
    acx.textBaseline = "alphabetic";
  }
}
