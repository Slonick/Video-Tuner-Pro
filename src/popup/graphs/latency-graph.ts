// The latency graph: a scrolling time graph of latency-to-broadcaster (or
// buffered-ahead seconds where latency isn't exposed), with the allowed-delay
// target line and the download bitrate.
import { byId } from "../dom.js";
import { msg } from "../i18n.js";
import { col, fitCanvas, smoothLine, levelMark } from "./draw-util.js";
import { BUF_WINDOW } from "./state.js";
import type { GraphState, BufSample } from "./state.js";

function fmtBitrate(bps: number | null): string | null {
  if (bps == null || !isFinite(bps) || bps <= 0) return null;
  return bps >= 1e6 ? (bps / 1e6).toFixed(1) + " Mbps" : Math.round(bps / 1e3) + " kbps";
}

export function drawBuffer(g: GraphState, t: number): void {
  const bcx = g.bcx;
  const { w, h } = fitCanvas(g.bCanvas, bcx);
  if (!w) return;
  // Not a live stream → nothing to graph; show a short hint instead.
  if (!g.bufLive) {
    bcx.clearRect(0, 0, w, h);
    bcx.fillStyle = col("--muted", "#888");
    bcx.globalAlpha = 0.7;
    bcx.font = "11px -apple-system, sans-serif";
    bcx.textAlign = "center";
    bcx.textBaseline = "middle";
    bcx.fillText(msg("bufferLiveOnly") || "Live streams only", w / 2, h / 2);
    bcx.globalAlpha = 1;
    bcx.textBaseline = "alphabetic";
    return;
  }
  const target = Number(byId<HTMLInputElement>("syncTarget").value);
  // Latency = accent line/value, buffer-ahead = green. When the site exposes
  // latency both are shown; otherwise the single series IS the buffer (green).
  const LAT_COL = col("--accent", "#0a84ff");
  const BUF_COL = "#30d158";
  const hasAhead = g.bufAheadShown != null;
  const padT = 7,
    padB = 11,
    gh = h - padT - padB;
  const padR = 36,
    pw = w - padR; // right gutter reserved for the scale labels (matches the audio graph)
  const mid = padT + gh / 2; // centre line = 0 / "now"
  const halfAmp = gh / 2 - 1;
  // Each half scales to its OWN peak (plus the target so the dashed line stays in
  // view) — small values still fill the graph instead of hugging the centre.
  const tgt = Number.isNaN(target) ? 0 : target;
  let latMx = tgt,
    bufMx = tgt;
  for (const p of g.bufHist)
    if (t - p.t <= BUF_WINDOW) {
      if (hasAhead) {
        if (p.v > latMx) latMx = p.v;
        if (p.a != null && p.a > bufMx) bufMx = p.a;
      } else if (p.v > bufMx) bufMx = p.v;
    }
  g.yMax += (Math.max(1.5, latMx * 1.2) - g.yMax) * 0.08;
  g.yMaxAhead += (Math.max(1.5, bufMx * 1.2) - g.yMaxAhead) * 0.08;
  const xFor = (ts: number) => pw * (1 - (t - ts) / BUF_WINDOW);
  const ampLat = (v: number) => (Math.min(Math.max(v, 0), g.yMax) / g.yMax) * halfAmp;
  const ampBuf = (v: number) => (Math.min(Math.max(v, 0), g.yMaxAhead) / g.yMaxAhead) * halfAmp;

  const bottom = padT + gh;
  const ampFull = (v: number) => (Math.min(Math.max(v, 0), g.yMaxAhead) / g.yMaxAhead) * gh;
  const fmtS = (val: number) => val.toFixed(2) + "s";
  const halo = col("--glass-l3", "#eee"); // readout halo = the panel layer (was --seg)
  const v =
    g.bufShown != null
      ? g.bufHist.length
        ? g.bufShown
        : 0
      : g.bufHist.length
        ? g.bufHist[g.bufHist.length - 1].v
        : 0;
  bcx.clearRect(0, 0, w, h);

  // Scale grid (behind the series): each half autoscales to its own peak, so
  // labelling those peaks — each tied to its level by a gridline + tick in the
  // gutter — is what makes the shape legible. 0 ("now") sits on the centre line.
  if (g.bufHist.length) {
    const sLbl = (val: number) => (Math.round(val * 2) / 2).toFixed(1); // number only — the unit lives in the readout
    const zero = { line: "rgba(127,127,127,0.32)" };
    if (hasAhead) {
      levelMark(bcx, padT, sLbl(g.yMaxAhead), pw, w, h); // buffer-ahead peak (top)
      levelMark(bcx, mid, "0", pw, w, h, zero); // 0 / "now" (centre)
      levelMark(bcx, bottom, sLbl(g.yMax), pw, w, h); // latency peak (bottom)
    } else {
      levelMark(bcx, padT, sLbl(g.yMaxAhead), pw, w, h); // buffer peak (top)
      levelMark(bcx, bottom, "0", pw, w, h, zero); // 0 (bottom)
    }
  }

  const target2 = (y: number): void => {
    // dashed amber target line at y, labelled
    const yy = Math.round(y) + 0.5;
    bcx.strokeStyle = "#ff9f0a";
    bcx.lineWidth = 1.5;
    bcx.setLineDash([4, 3]);
    bcx.beginPath();
    bcx.moveTo(0, yy);
    bcx.lineTo(pw, yy);
    bcx.stroke();
    bcx.setLineDash([]);
    bcx.fillStyle = "#ff9f0a";
    bcx.textAlign = "right";
    bcx.font = "9px -apple-system, sans-serif";
    bcx.fillText(target + "s", pw - 2, yy - 2);
  };
  const put = (s: string, y: number, color: string): void => {
    // Soft halo (panel-coloured shadow) instead of a hard outline — reads over the
    // chart line but stays glassy/clean.
    bcx.save();
    bcx.shadowColor = halo;
    bcx.shadowBlur = 5;
    bcx.fillStyle = color;
    bcx.fillText(s, pw / 2, y);
    bcx.fillText(s, pw / 2, y); // twice → the soft halo reads a touch stronger
    bcx.restore();
  };
  // Amber gradient over the part of a series past the target (like the audio
  // over-threshold fill): faint at the target line, solid toward the scale edge.
  const overTarget = (
    pts: { x: number; y: number }[],
    base: number,
    yT: number,
    yEdge: number,
  ): void => {
    if (Number.isNaN(target) || pts.length < 2) return;
    const grad = bcx.createLinearGradient(0, yT, 0, yEdge);
    grad.addColorStop(0, "rgba(255,159,10,0.10)");
    grad.addColorStop(1, "rgba(255,159,10,0.7)");
    bcx.save();
    const c0 = Math.min(yT, yEdge),
      c1 = Math.max(yT, yEdge);
    bcx.beginPath();
    bcx.rect(0, c0, pw, c1 - c0);
    bcx.clip();
    bcx.fillStyle = grad;
    bcx.beginPath();
    smoothLine(bcx, pts);
    bcx.lineTo(pts[pts.length - 1].x, base);
    bcx.lineTo(pts[0].x, base);
    bcx.closePath();
    bcx.fill();
    bcx.restore();
  };

  if (hasAhead) {
    // Two series → mirror like the audio meter: latency fills DOWN from the centre
    // (accent), buffer-ahead fills UP (green); centre line = 0 ("now").
    const fillArea = (
      get: (p: BufSample) => number | null | undefined,
      dir: number,
      amp: (x: number) => number,
      color: string,
      fill: string,
    ): void => {
      const pts = g.bufHist
        .filter((p) => get(p) != null)
        .map((p) => ({ x: xFor(p.t), y: mid + dir * amp(get(p) as number) }));
      if (pts.length < 2) return;
      bcx.beginPath();
      smoothLine(bcx, pts);
      bcx.lineTo(pts[pts.length - 1].x, mid);
      bcx.lineTo(pts[0].x, mid);
      bcx.closePath();
      bcx.fillStyle = fill;
      bcx.fill();
      bcx.beginPath();
      smoothLine(bcx, pts);
      bcx.strokeStyle = color;
      bcx.lineWidth = 2;
      bcx.lineJoin = "round";
      bcx.lineCap = "round";
      bcx.stroke();
      overTarget(pts, mid, mid + dir * amp(target), mid + dir * halfAmp);
    };
    if (g.bufHist.length) {
      fillArea((p) => p.v, 1, ampLat, LAT_COL, "rgba(10,132,255,0.16)"); // latency ↓
      fillArea((p) => p.a, -1, ampBuf, BUF_COL, "rgba(48,209,88,0.16)"); // buffer ↑
    }
    // Target mirrored on both halves (each at its own scale).
    if (!Number.isNaN(target)) {
      target2(mid + ampLat(target));
      target2(mid - ampBuf(target));
    }
    if (g.bufHist.length) {
      bcx.font = "700 15px -apple-system, sans-serif";
      bcx.textAlign = "center";
      bcx.textBaseline = "middle";
      bcx.lineWidth = 3.5;
      bcx.lineJoin = "round";
      put(fmtS(g.bufAheadShown as number), mid - 12, BUF_COL); // buffer (top)
      put(fmtS(v), mid + 12, LAT_COL); // latency (bottom)
      bcx.textBaseline = "alphabetic";
    }
  } else {
    // One series (buffer only) → fill the FULL height from the bottom (0 = bottom),
    // with one big green value.
    if (g.bufHist.length) {
      const pts = g.bufHist.map((p) => ({ x: xFor(p.t), y: bottom - ampFull(p.v) }));
      bcx.beginPath();
      smoothLine(bcx, pts);
      bcx.lineTo(pts[pts.length - 1].x, bottom);
      bcx.lineTo(pts[0].x, bottom);
      bcx.closePath();
      bcx.fillStyle = "rgba(48,209,88,0.16)";
      bcx.fill();
      bcx.beginPath();
      smoothLine(bcx, pts);
      bcx.strokeStyle = BUF_COL;
      bcx.lineWidth = 2;
      bcx.lineJoin = "round";
      bcx.lineCap = "round";
      bcx.stroke();
      overTarget(pts, bottom, bottom - ampFull(target), bottom - gh);
    }
    if (!Number.isNaN(target)) target2(bottom - ampFull(target));
    if (g.bufHist.length) {
      bcx.font = "700 16px -apple-system, sans-serif";
      bcx.textAlign = "center";
      bcx.textBaseline = "middle";
      bcx.lineWidth = 4;
      bcx.lineJoin = "round";
      put(fmtS(v), h / 2, BUF_COL);
      bcx.textBaseline = "alphabetic";
    }
  }
  const br = fmtBitrate(g.bufBitrateShown);
  if (br) {
    bcx.font = "10px -apple-system, sans-serif";
    bcx.textAlign = "left";
    bcx.textBaseline = "alphabetic";
    bcx.fillStyle = col("--muted", "#888");
    bcx.fillText("≈ " + br, 3, h - 2);
  }
  // Far behind but the buffer is too thin to catch up — same signal as the
  // badge's "⚠"; without it a stuck-high latency looks like sync not working.
  if (g.bufLimited) {
    bcx.font = "600 10px -apple-system, sans-serif";
    bcx.textAlign = "right";
    bcx.textBaseline = "alphabetic";
    bcx.fillStyle = "#ff9f0a";
    bcx.fillText("⚠ " + (msg("bufferLowWarn") || "Low buffer — catch-up limited"), w - 3, h - 2);
  }
}
