import { byId } from "../dom.js";
import { col, fitCanvas } from "./draw-util.js";
import { A_MIN, A_MAX, A_WINDOW } from "./state.js";
import type { GraphState } from "./state.js";

const A_OVER = "#ff9f0a";                          // over-threshold highlight (== threshold colour)

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

  const c = g.compAnim;                          // 0 = off (input only, full height) … 1 = on (mirrored)
  const top = 1, bottom = h - 1, center = h / 2, halfAmp = h / 2 - 1, fullH = bottom - top;
  const frac = (db: number) => (Math.max(A_MIN, Math.min(A_MAX, db)) - A_MIN) / (A_MAX - A_MIN);
  // Input y morphs from "rise from the bottom" (off, −100 at the floor) to "fall
  // from the centre" (on); at c=1 this equals centre + halfAmp·frac — the mirror.
  const inY = (db: number) => (bottom - fullH * frac(db)) * (1 - c) + (center + halfAmp * frac(db)) * c;
  const baseY = inY(A_MIN);                       // the −100 dB baseline
  const xFor = (ts: number) => w * (1 - (t - ts) / A_WINDOW);
  const thr = Number(byId<HTMLInputElement>("acThreshold").value);

  // Baseline (input zero / −100 dB).
  acx.strokeStyle = "rgba(127,127,127,0.18)"; acx.lineWidth = 1;
  acx.beginPath(); acx.moveTo(0, Math.round(baseY) + 0.5); acx.lineTo(w, Math.round(baseY) + 0.5); acx.stroke();

  if (g.audioHist.length >= 2) {
    // Input area (always): baseline → input level (muted).
    const ip = g.audioHist.map((p) => ({ x: xFor(p.t), y: inY(p.in) }));
    acx.beginPath(); acx.moveTo(ip[0].x, baseY);
    for (const p of ip) acx.lineTo(p.x, p.y);
    acx.lineTo(ip[ip.length - 1].x, baseY); acx.closePath();
    acx.globalAlpha = 0.45; acx.fillStyle = muted; acx.fill(); acx.globalAlpha = 1;
    acx.strokeStyle = muted; acx.lineWidth = 1;
    acx.beginPath(); acx.moveTo(ip[0].x, ip[0].y);
    for (let i = 1; i < ip.length; i++) acx.lineTo(ip[i].x, ip[i].y);
    acx.stroke();

    // Over-threshold highlight on the input — what actually gets compressed.
    // Faint at the threshold, ramping through the knee, solid only near 0 dB;
    // fades in with the compressor and morphs with the input.
    if (!Number.isNaN(thr) && c > 0.01) {
      const yThr = inY(thr), yLoud = inY(A_MAX);
      const knee = Number(byId<HTMLInputElement>("acKnee").value) || 0;
      const kneeFrac = Math.min(0.8, Math.max(0.05, knee / Math.max(1, -thr)));
      const grad = acx.createLinearGradient(0, yThr, 0, yLoud);
      grad.addColorStop(0, "rgba(255,159,10,0.10)");          // just over threshold
      grad.addColorStop(kneeFrac, "rgba(255,159,10,0.34)");   // through the knee
      grad.addColorStop(1, "rgba(255,159,10,1)");             // solid only when loud
      acx.save();
      acx.globalAlpha = c;
      const cy0 = Math.min(yThr, yLoud), cy1 = Math.max(yThr, yLoud);
      acx.beginPath(); acx.rect(0, cy0, w, cy1 - cy0); acx.clip();
      acx.fillStyle = grad;
      acx.beginPath(); acx.moveTo(ip[0].x, baseY);
      for (const p of ip) acx.lineTo(p.x, p.y);
      acx.lineTo(ip[ip.length - 1].x, baseY); acx.closePath(); acx.fill();
      acx.restore();
    }

    // Output area (top, accent): centre → output level. Fades in with the
    // compressor — off, output == input, so there's nothing to show.
    if (c > 0.01) {
      const op = g.audioHist.map((p) => ({ x: xFor(p.t), y: center - halfAmp * frac(p.out) }));
      acx.globalAlpha = 0.55 * c; acx.fillStyle = accent;
      acx.beginPath(); acx.moveTo(op[0].x, center);
      for (const p of op) acx.lineTo(p.x, p.y);
      acx.lineTo(op[op.length - 1].x, center); acx.closePath(); acx.fill();
      acx.globalAlpha = Math.min(1, c * 1.6); acx.strokeStyle = accent; acx.lineWidth = 1;
      acx.beginPath(); acx.moveTo(op[0].x, op[0].y);
      for (let i = 1; i < op.length; i++) acx.lineTo(op[i].x, op[i].y);
      acx.stroke(); acx.globalAlpha = 1;

      // Ghost of the input level mirrored onto the output (top) half: the gap down
      // to the actual output is how much the compressor pulled the level off — the
      // before/after difference. Fades in with the compressor; off, output == input
      // so it vanishes.
      const gp = g.audioHist.map((p) => ({ x: xFor(p.t), gi: center - halfAmp * frac(p.in), go: center - halfAmp * frac(p.out) }));
      acx.save();
      acx.globalAlpha = 0.18 * c;                   // "removed" band
      acx.fillStyle = A_OVER;
      acx.beginPath();
      acx.moveTo(gp[0].x, gp[0].gi);
      for (let i = 0; i < gp.length; i++) acx.lineTo(gp[i].x, gp[i].gi);
      for (let i = gp.length - 1; i >= 0; i--) acx.lineTo(gp[i].x, gp[i].go);
      acx.closePath(); acx.fill();
      acx.globalAlpha = 0.5 * c;                    // dashed "would-be" input level
      acx.strokeStyle = "rgb(214,218,226)"; acx.lineWidth = 1; acx.setLineDash([2, 2]);
      acx.beginPath(); acx.moveTo(gp[0].x, gp[0].gi);
      for (let i = 1; i < gp.length; i++) acx.lineTo(gp[i].x, gp[i].gi);
      acx.stroke(); acx.setLineDash([]);
      acx.restore();
    }
  }

  // Threshold guide (level above which the input is compressed) — dashed amber,
  // fades in with the compressor and morphs with the input.
  if (!Number.isNaN(thr) && c > 0.01) {
    const y = Math.round(inY(thr)) + 0.5;
    acx.globalAlpha = c;
    acx.strokeStyle = A_OVER; acx.lineWidth = 1.2; acx.setLineDash([3, 3]);
    acx.beginPath(); acx.moveTo(0, y); acx.lineTo(w, y); acx.stroke();
    acx.setLineDash([]); acx.globalAlpha = 1;
  }

  // Readout (throttled so digits sit still), bigger, no difference. OFF → the
  // single input level; ON → output (top) over input (bottom). compAnim cross-fades.
  if (g.audioActive && g.audioHist.length) {
    const last = g.audioHist[g.audioHist.length - 1];
    if (g.audioOutShown == null || t - g.audioDiffAt > 600) {
      g.audioOutShown = last.out; g.audioInShown = last.in; g.audioDiffAt = t;
    }
    const inV = g.audioInShown ?? A_MIN, outV = g.audioOutShown ?? A_MIN;
    const seg = col("--seg", "#2c2c2e");
    acx.textAlign = "center"; acx.lineJoin = "round";
    const offA = Math.max(0, Math.min(1, 1 - c * 2.4));
    if (offA > 0.01) {
      acx.globalAlpha = offA;
      acx.font = "700 16px -apple-system, sans-serif"; acx.textBaseline = "middle"; acx.lineWidth = 4;
      const lvl = fmtLevel(inV);
      acx.strokeStyle = seg; acx.strokeText(lvl, w / 2, center);
      acx.fillStyle = "#c7c7cc"; acx.fillText(lvl, w / 2, center);
      acx.globalAlpha = 1;
    }
    const onA = Math.max(0, Math.min(1, (c - 0.45) * 2.2));
    if (onA > 0.01) {
      acx.globalAlpha = onA;
      const outC = col("--meter-out", "#7fb8ff"), inC = col("--meter-in", "#cfcfd4");
      acx.font = "700 15px -apple-system, sans-serif"; acx.textBaseline = "middle"; acx.lineWidth = 3.5;
      const outL = fmtLevel(outV), inL = fmtLevel(inV);
      acx.strokeStyle = seg; acx.strokeText(outL, w / 2, center - 12);
      acx.fillStyle = outC; acx.fillText(outL, w / 2, center - 12);
      acx.strokeStyle = seg; acx.strokeText(inL, w / 2, center + 12);
      acx.fillStyle = inC; acx.fillText(inL, w / 2, center + 12);
      acx.globalAlpha = 1;
    }
    acx.textBaseline = "alphabetic";
  }
}
