import type { XY } from "./state.js";

// Resolve a CSS custom property (theme colour), with a fallback.
export function col(name: string, fb: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
}

export function now(): number {
  return performance.now();
}

// A labelled scale level: a faint gridline across the plot (0…plotW), a short
// tick into the right gutter that ties the line to its value, and the value
// (with unit) right-aligned in the gutter. Drawn behind the data so the series
// sit on top. Saves/restores so it doesn't disturb the caller's ctx state.
export function levelMark(
  cx: CanvasRenderingContext2D,
  y: number,
  label: string,
  plotW: number,
  fullW: number,
  h: number,
  o: { color?: string; line?: string; dash?: number[]; alpha?: number } = {},
): void {
  const yy = Math.round(y) + 0.5;
  const muted = col("--muted", "#888");
  cx.save();
  cx.lineWidth = 1;
  cx.strokeStyle = o.line || "rgba(127,127,127,0.16)";
  if (o.dash) cx.setLineDash(o.dash);
  cx.beginPath();
  cx.moveTo(0, yy);
  cx.lineTo(plotW, yy);
  cx.stroke();
  cx.setLineDash([]);
  cx.globalAlpha = o.alpha ?? 1;
  cx.strokeStyle = o.color || muted;
  cx.beginPath();
  cx.moveTo(plotW, yy);
  cx.lineTo(plotW + 7, yy);
  cx.stroke(); // tick into the gutter
  const ly = Math.max(7, Math.min(h - 4, y)); // keep the value on-canvas at the edges
  cx.font = "9px -apple-system, sans-serif";
  cx.textAlign = "left";
  cx.textBaseline = "middle";
  cx.fillStyle = o.color || muted;
  cx.fillText(label, plotW + 10, ly); // left-aligned right after the tick
  cx.restore();
}

// Size the canvas backing store to its CSS box × devicePixelRatio (once per size
// change) and return the CSS-pixel dimensions to draw in.
export function fitCanvas(
  canvas: HTMLCanvasElement,
  cx: CanvasRenderingContext2D,
): { w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 290,
    h = canvas.clientHeight || 50;
  if (canvas._w !== w || canvas._h !== h) {
    canvas._w = w;
    canvas._h = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return { w, h };
}

// Smooth polyline through points using midpoint quadratic curves (rounds corners).
export function smoothLine(cx: CanvasRenderingContext2D, pts: XY[]): void {
  if (!pts.length) return;
  cx.moveTo(pts[0].x, pts[0].y);
  if (pts.length < 3) {
    for (let i = 1; i < pts.length; i++) cx.lineTo(pts[i].x, pts[i].y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2,
      my = (pts[i].y + pts[i + 1].y) / 2;
    cx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const n = pts.length - 1;
  cx.quadraticCurveTo(pts[n].x, pts[n].y, pts[n].x, pts[n].y);
}
