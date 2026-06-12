import type { XY } from "./state.js";

// Resolve a CSS custom property (theme colour), with a fallback.
export function col(name: string, fb: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
}

export function now(): number { return performance.now(); }

// Size the canvas backing store to its CSS box × devicePixelRatio (once per size
// change) and return the CSS-pixel dimensions to draw in.
export function fitCanvas(canvas: HTMLCanvasElement, cx: CanvasRenderingContext2D): { w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 290, h = canvas.clientHeight || 50;
  if (canvas._w !== w || canvas._h !== h) {
    canvas._w = w; canvas._h = h;
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
  if (pts.length < 3) { for (let i = 1; i < pts.length; i++) cx.lineTo(pts[i].x, pts[i].y); return; }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    cx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const n = pts.length - 1;
  cx.quadraticCurveTo(pts[n].x, pts[n].y, pts[n].x, pts[n].y);
}
