// The latency graph: a scrolling time graph of latency-to-broadcaster (or
// buffered-ahead seconds where latency isn't exposed), with the allowed-delay
// target line and the download bitrate.
import { byId } from "../dom.js";
import { msg } from "../i18n.js";
import { col, fitCanvas, smoothLine } from "./draw-util.js";
import { BUF_WINDOW } from "./state.js";
import type { GraphState } from "./state.js";

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
    bcx.fillStyle = col("--muted", "#888"); bcx.globalAlpha = 0.7;
    bcx.font = "11px -apple-system, sans-serif"; bcx.textAlign = "center"; bcx.textBaseline = "middle";
    bcx.fillText(msg("bufferLiveOnly") || "Live streams only", w / 2, h / 2);
    bcx.globalAlpha = 1; bcx.textBaseline = "alphabetic";
    return;
  }
  const target = Number(byId<HTMLInputElement>("syncTarget").value);
  const padT = 5, padB = 11, gh = h - padT - padB;
  // dynamic Y scale that fits target + recent history
  let mx = (Number.isNaN(target) ? 6 : target + 1);
  for (const p of g.bufHist) if (t - p.t <= BUF_WINDOW && p.v > mx) mx = p.v;
  g.yMax += (Math.max(6, mx * 1.15) - g.yMax) * 0.08;
  const yMax = g.yMax;
  const yFor = (v: number) => padT + gh * (1 - Math.min(Math.max(v, 0), yMax) / yMax);
  const xFor = (ts: number) => w * (1 - (t - ts) / BUF_WINDOW);

  bcx.clearRect(0, 0, w, h);
  bcx.strokeStyle = "rgba(127,127,127,0.16)"; bcx.lineWidth = 1;
  bcx.fillStyle = col("--muted", "#888"); bcx.font = "9px -apple-system, sans-serif"; bcx.textAlign = "left";
  const step = yMax <= 8 ? 2 : (yMax <= 16 ? 5 : 10);
  for (let v = step; v < yMax; v += step) {
    const y = Math.round(yFor(v)) + 0.5;
    bcx.beginPath(); bcx.moveTo(0, y); bcx.lineTo(w, y); bcx.stroke();
    bcx.fillText(v + "s", 3, y - 2);
  }
  if (g.bufHist.length) {
    const pts = g.bufHist.map((p) => ({ x: xFor(p.t), y: yFor(p.v) }));
    const baseY = padT + gh;
    bcx.beginPath();
    smoothLine(bcx, pts);
    bcx.lineTo(pts[pts.length - 1].x, baseY); bcx.lineTo(pts[0].x, baseY); bcx.closePath();
    bcx.fillStyle = "rgba(10,132,255,0.16)"; bcx.fill();
    bcx.beginPath(); smoothLine(bcx, pts);
    bcx.strokeStyle = col("--accent", "#0a84ff"); bcx.lineWidth = 2; bcx.lineJoin = "round"; bcx.lineCap = "round"; bcx.stroke();
  }
  if (!Number.isNaN(target)) {
    const y = Math.round(yFor(target)) + 0.5;
    bcx.strokeStyle = "#ff9f0a"; bcx.lineWidth = 1.5; bcx.setLineDash([4, 3]);
    bcx.beginPath(); bcx.moveTo(0, y); bcx.lineTo(w, y); bcx.stroke();
    bcx.setLineDash([]);
    bcx.fillStyle = "#ff9f0a"; bcx.textAlign = "right";
    bcx.fillText(target + "s", w - 3, y - 2);
  }
  // background-colored halo so the value stays readable over the line, grid and target dash
  if (g.bufHist.length) {
    const fmtS = (v: number) => (v < 10 ? v.toFixed(1) : Math.round(v)) + "s";
    const v = g.bufHist[g.bufHist.length - 1].v;
    // "latency (buffer)" when the plotted value is the site latency; without it
    // the plotted value already IS the buffer, so there's nothing to append.
    const label = fmtS(v) + (g.bufAheadShown != null ? ` (${fmtS(g.bufAheadShown)})` : "");
    bcx.font = "700 17px -apple-system, sans-serif";
    bcx.textAlign = "center"; bcx.textBaseline = "middle";
    bcx.lineWidth = 4; bcx.lineJoin = "round";
    bcx.strokeStyle = col("--seg", "#eee");
    bcx.strokeText(label, w / 2, h / 2);
    bcx.fillStyle = col("--text", "#222");
    bcx.fillText(label, w / 2, h / 2);
    bcx.textBaseline = "alphabetic";
  }
  const br = fmtBitrate(g.bufBitrateShown);
  if (br) {
    bcx.font = "10px -apple-system, sans-serif";
    bcx.textAlign = "left"; bcx.textBaseline = "alphabetic";
    bcx.fillStyle = col("--muted", "#888");
    bcx.fillText("≈ " + br, 3, h - 2);
  }
  // Far behind but the buffer is too thin to catch up — same signal as the
  // badge's "⚠"; without it a stuck-high latency looks like sync not working.
  if (g.bufLimited) {
    bcx.font = "600 10px -apple-system, sans-serif";
    bcx.textAlign = "right"; bcx.textBaseline = "alphabetic";
    bcx.fillStyle = "#ff9f0a";
    bcx.fillText("⚠ " + (msg("bufferLowWarn") || "Low buffer — catch-up limited"), w - 3, h - 2);
  }
}
