// The auto-slow speech graph (variant A): the measured syllable rate as a bright
// line, the trigger target as a dashed line with the "too dense" zone above it
// tinted, and the resulting playback speed as a faint ghost line underneath. Rate
// is on the main axis (0…AS_RATE_MAX syll/s); speed rides a faint secondary scale.
import { col, fitCanvas } from "./draw-util.js";
import { msg } from "../i18n.js";
import { AS_WINDOW, AS_RATE_MAX } from "./state.js";
import type { GraphState } from "./state.js";

const SPEED_LO = 0.5,
  SPEED_HI = 3; // secondary scale for the ghost speed line

export function drawAutoSlow(g: GraphState, t: number): void {
  const cx = g.ascx;
  const canvas = g.asCanvas;
  if (!cx || !canvas) return;
  const { w, h } = fitCanvas(canvas, cx);
  if (!w) return;
  cx.clearRect(0, 0, w, h);

  const accent = col("--accent", "#0a84ff");
  const muted = col("--muted", "#888");
  const padR = 26,
    pw = w - padR; // right gutter for the rate scale
  const pad = 7,
    plotH = h - 2 * pad;

  const yRate = (r: number) => pad + (1 - Math.min(1, Math.max(0, r / AS_RATE_MAX))) * plotH;
  const ySpeed = (s: number) =>
    pad + (1 - Math.min(1, Math.max(0, (s - SPEED_LO) / (SPEED_HI - SPEED_LO)))) * plotH;
  const xFor = (ts: number) => pw * (1 - (t - ts) / AS_WINDOW);

  const yTarget = yRate(g.asTargetLine);

  // "Too dense" zone above the target line.
  cx.fillStyle = accent;
  cx.globalAlpha = 0.07;
  cx.fillRect(0, pad, pw, yTarget - pad);
  cx.globalAlpha = 1;

  // Target (trigger) line — dashed.
  cx.strokeStyle = accent;
  cx.lineWidth = 1;
  cx.globalAlpha = 0.7;
  cx.setLineDash([4, 3]);
  cx.beginPath();
  cx.moveTo(0, yTarget + 0.5);
  cx.lineTo(pw, yTarget + 0.5);
  cx.stroke();
  cx.setLineDash([]);
  cx.globalAlpha = 1;

  const hist = g.asHist;
  if (hist.length > 1) {
    // Resulting speed — faint ghost line.
    cx.strokeStyle = muted;
    cx.globalAlpha = 0.5;
    cx.lineWidth = 1.4;
    cx.beginPath();
    hist.forEach((p, i) => {
      const x = xFor(p.t),
        y = ySpeed(p.speed);
      if (i) cx.lineTo(x, y);
      else cx.moveTo(x, y);
    });
    cx.stroke();
    cx.globalAlpha = 1;

    // Speech rate — bright line on top.
    cx.strokeStyle = accent;
    cx.lineWidth = 1.8;
    cx.beginPath();
    hist.forEach((p, i) => {
      const x = xFor(p.t),
        y = yRate(p.rate);
      if (i) cx.lineTo(x, y);
      else cx.moveTo(x, y);
    });
    cx.stroke();
  } else {
    // No samples yet → the bare target line reads as "broken". A centred hint makes
    // the idle graph read as "ready, listening" instead. The target line + zone
    // stay for context.
    cx.font = "11px -apple-system, sans-serif";
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.fillStyle = muted;
    cx.globalAlpha = 0.7;
    cx.fillText(msg("autoSlowIdle") || "Waiting for speech…", pw / 2, yTarget);
    cx.globalAlpha = 1;
  }

  // Rate scale in the right gutter: max, the target value, and 0.
  cx.font = "9px -apple-system, sans-serif";
  cx.textAlign = "left";
  cx.textBaseline = "middle";
  cx.fillStyle = muted;
  cx.fillText(String(AS_RATE_MAX), pw + 5, yRate(AS_RATE_MAX) + 1);
  cx.fillText("0", pw + 5, yRate(0) - 1);
  cx.fillStyle = accent;
  cx.fillText(String(Math.round(g.asTargetLine)), pw + 5, yTarget);
}
