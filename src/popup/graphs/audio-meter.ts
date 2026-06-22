import { byId } from "../dom.js";
import { msg } from "../i18n.js";
import { col, fitCanvas, levelMark, cornerReadout } from "./draw-util.js";
import { A_MIN, A_MAX, A_WINDOW } from "./state.js";
import type { GraphState } from "./state.js";

const A_OVER = "#ff9f0a"; // over-threshold highlight (== threshold colour)

function fmtLevel(db: number): string {
  const v = Math.max(A_MIN, Math.round(db));
  return (v < 0 ? "−" + -v : String(v)) + " dB";
}

export function drawAudio(g: GraphState, t: number): void {
  const acx = g.acx;
  const { w, h } = fitCanvas(g.aCanvas, acx);
  if (!w) return;
  const muted = col("--muted", "#888"),
    accent = col("--accent", "#0a84ff");
  acx.clearRect(0, 0, w, h);

  const c = g.compAnim; // 0 = off (input only, full height) … 1 = on (mirrored)
  const padR = 36,
    pw = w - padR; // right gutter reserved for the scale labels (matches the buffer graph)
  const pad = 7; // top/bottom inset so the 0 / −100 ticks aren't flush to the edge
  const top = pad,
    bottom = h - pad,
    center = h / 2,
    halfAmp = h / 2 - pad,
    fullH = bottom - top;
  const frac = (db: number) => (Math.max(A_MIN, Math.min(A_MAX, db)) - A_MIN) / (A_MAX - A_MIN);
  // Input y morphs from "rise from the bottom" (off, −100 at the floor) to "fall
  // from the centre" (on); at c=1 this equals centre + halfAmp·frac — the mirror.
  const inY = (db: number) =>
    (bottom - fullH * frac(db)) * (1 - c) + (center + halfAmp * frac(db)) * c;
  const baseY = inY(A_MIN); // the −100 dB baseline
  const xFor = (ts: number) => pw * (1 - (t - ts) / A_WINDOW);
  const thr = Number(byId<HTMLInputElement>("acThreshold").value);

  // Scale grid (behind the waveform): −100 dB sits on the baseline — silence —
  // which slides to the centre as the compressor mirrors; 0 dB (loudest) at the
  // top edge. Each value is tied to its level by a gridline + tick in the gutter.
  const dbTick = (db: number) => (db < 0 ? "−" + -db : String(db)); // number only — the unit lives in the readout
  levelMark(acx, baseY, dbTick(A_MIN), pw, w, h, { line: "rgba(127,127,127,0.32)" });
  levelMark(acx, top, dbTick(A_MAX), pw, w, h);
  // Mirrored mode: the bottom half is the input rising back to 0 dB (loudest), so
  // label it too — otherwise markers on the input scale (e.g. the threshold) look
  // like they sit below −100. Fades in with the compressor.
  if (c > 0.01) levelMark(acx, inY(A_MAX), dbTick(A_MAX), pw, w, h, { alpha: c });

  if (g.audioHist.length >= 2) {
    // Input area (always): baseline → input level (muted).
    const ip = g.audioHist.map((p) => ({ x: xFor(p.t), y: inY(p.in) }));
    acx.beginPath();
    acx.moveTo(ip[0].x, baseY);
    for (const p of ip) acx.lineTo(p.x, p.y);
    acx.lineTo(ip[ip.length - 1].x, baseY);
    acx.closePath();
    acx.globalAlpha = 0.45;
    acx.fillStyle = muted;
    acx.fill();
    acx.globalAlpha = 1;
    acx.strokeStyle = muted;
    acx.lineWidth = 1;
    acx.beginPath();
    acx.moveTo(ip[0].x, ip[0].y);
    for (let i = 1; i < ip.length; i++) acx.lineTo(ip[i].x, ip[i].y);
    acx.stroke();

    // Over-threshold highlight on the input — what actually gets compressed.
    // Faint at the threshold, ramping through the knee, solid only near 0 dB;
    // fades in with the compressor and morphs with the input.
    if (!Number.isNaN(thr) && c > 0.01) {
      const yThr = inY(thr),
        yLoud = inY(A_MAX);
      const knee = g.knee;
      const kneeFrac = Math.min(0.8, Math.max(0.05, knee / Math.max(1, -thr)));
      const grad = acx.createLinearGradient(0, yThr, 0, yLoud);
      grad.addColorStop(0, "rgba(255,159,10,0.10)"); // just over threshold
      grad.addColorStop(kneeFrac, "rgba(255,159,10,0.34)"); // through the knee
      grad.addColorStop(1, "rgba(255,159,10,1)"); // solid only when loud
      acx.save();
      acx.globalAlpha = c;
      const cy0 = Math.min(yThr, yLoud),
        cy1 = Math.max(yThr, yLoud);
      acx.beginPath();
      acx.rect(0, cy0, pw, cy1 - cy0);
      acx.clip();
      acx.fillStyle = grad;
      acx.beginPath();
      acx.moveTo(ip[0].x, baseY);
      for (const p of ip) acx.lineTo(p.x, p.y);
      acx.lineTo(ip[ip.length - 1].x, baseY);
      acx.closePath();
      acx.fill();
      acx.restore();
    }

    // Output area (top, accent): centre → output level. Fades in with the
    // compressor — off, output == input, so there's nothing to show.
    if (c > 0.01) {
      const op = g.audioHist.map((p) => ({ x: xFor(p.t), y: center - halfAmp * frac(p.out) }));
      acx.globalAlpha = 0.55 * c;
      acx.fillStyle = accent;
      acx.beginPath();
      acx.moveTo(op[0].x, center);
      for (const p of op) acx.lineTo(p.x, p.y);
      acx.lineTo(op[op.length - 1].x, center);
      acx.closePath();
      acx.fill();
      acx.globalAlpha = Math.min(1, c * 1.6);
      acx.strokeStyle = accent;
      acx.lineWidth = 1;
      acx.beginPath();
      acx.moveTo(op[0].x, op[0].y);
      for (let i = 1; i < op.length; i++) acx.lineTo(op[i].x, op[i].y);
      acx.stroke();
      acx.globalAlpha = 1;

      // Ghost of the input level mirrored onto the output (top) half: the gap down
      // to the actual output is how much the compressor pulled the level off — the
      // before/after difference. Fades in with the compressor; off, output == input
      // so it vanishes.
      const gp = g.audioHist.map((p) => ({
        x: xFor(p.t),
        gi: center - halfAmp * frac(p.in),
        go: center - halfAmp * frac(p.out),
      }));
      acx.save();
      acx.globalAlpha = 0.18 * c; // "removed" band
      acx.fillStyle = A_OVER;
      acx.beginPath();
      acx.moveTo(gp[0].x, gp[0].gi);
      for (let i = 0; i < gp.length; i++) acx.lineTo(gp[i].x, gp[i].gi);
      for (let i = gp.length - 1; i >= 0; i--) acx.lineTo(gp[i].x, gp[i].go);
      acx.closePath();
      acx.fill();
      acx.globalAlpha = 0.5 * c; // dashed "would-be" input level
      acx.strokeStyle = "rgb(214,218,226)";
      acx.lineWidth = 1;
      acx.setLineDash([2, 2]);
      acx.beginPath();
      acx.moveTo(gp[0].x, gp[0].gi);
      for (let i = 1; i < gp.length; i++) acx.lineTo(gp[i].x, gp[i].gi);
      acx.stroke();
      acx.setLineDash([]);
      acx.restore();
    }
  }

  // Threshold guide (level above which the input is compressed) — amber dashed,
  // drawn inside the plot like the buffer's target line. The value sits at the
  // right end, nudged above or below the line so it never clips at the edges.
  if (!Number.isNaN(thr) && c > 0.01) {
    const y = inY(thr),
      yy = Math.round(y) + 0.5;
    acx.save();
    acx.globalAlpha = c;
    acx.strokeStyle = A_OVER;
    acx.lineWidth = 1.2;
    acx.setLineDash([3, 3]);
    acx.beginPath();
    acx.moveTo(0, yy);
    acx.lineTo(pw, yy);
    acx.stroke();
    acx.setLineDash([]);
    acx.fillStyle = A_OVER;
    acx.font = "9px -apple-system, sans-serif";
    acx.textAlign = "right";
    acx.textBaseline = "alphabetic";
    acx.fillText(dbTick(thr) + " dB", pw - 2, y < 12 ? yy + 10 : yy - 3); // below the line near the top, above otherwise
    acx.restore();
  }

  // Readout (throttled so digits sit still), bigger, no difference. OFF → the
  // single input level; ON → output (top) over input (bottom). compAnim cross-fades.
  const active = g.audioActive && g.audioHist.length > 0;
  let inV = A_MIN,
    outV = A_MIN;
  if (active) {
    const last = g.audioHist[g.audioHist.length - 1];
    if (g.audioOutShown == null || t - g.audioDiffAt > 600) {
      g.audioOutShown = last.out;
      g.audioInShown = last.in;
      g.audioDiffAt = t;
    }
    inV = g.audioInShown ?? A_MIN;
    outV = g.audioOutShown ?? A_MIN;
  }
  // Silence (the readout would just be "−100 dB") or no audio context → idle hint on
  // the centre line, matching the auto-slow graph, instead of a dead "−100 dB".
  if (!active || Math.round(inV) <= A_MIN) {
    acx.font = "11px -apple-system, sans-serif";
    acx.textAlign = "center";
    acx.textBaseline = "middle";
    acx.fillStyle = muted;
    acx.globalAlpha = 0.7;
    acx.fillText(
      g.audioEnabled
        ? msg("audioIdle") || "Waiting for audio…"
        : msg("audioOff") || "Compression off",
      pw / 2,
      center,
    );
    acx.globalAlpha = 1;
    acx.textBaseline = "alphabetic";
  } else {
    // Level readout — a small backed chip in the top-left corner, off the moving
    // bars so it stays legible (was two big numbers centred on the waveform).
    // Labelled In / Out so it's clear which level is which. With the compressor off
    // the stream is still captured (out runs transparent = in), so only In is shown.
    // Out on top, In below — matching the graph (output fills up, input down). With
    // the compressor off the stream is still captured (out runs transparent = in),
    // so only In is shown.
    const rows: { label: string; value: string; color: string }[] = [];
    if (g.audioEnabled) {
      rows.push({ label: "Out", value: fmtLevel(outV), color: col("--meter-out", "#7fb8ff") });
    }
    rows.push({ label: "In", value: fmtLevel(inV), color: col("--meter-in", "#cfcfd4") });
    cornerReadout(acx, rows);
  }
}
