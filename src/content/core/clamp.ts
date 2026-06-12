import { MIN_SPEED, MAX_SPEED, LIVE_MAX_FLOOR } from "./constants.js";

export function clamp(speed: number): number {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 100) / 100));
}

export function clampTarget(n: unknown): number {
  const v = Number(n);
  if (Number.isNaN(v)) return 5;
  return Math.min(15, Math.max(0, Math.round(v)));
}

export function clampMax(n: unknown): number {
  const v = Number(n);
  if (Number.isNaN(v)) return 1.5;
  return Math.min(3, Math.max(LIVE_MAX_FLOOR, Math.round(v * 100) / 100));
}

export function clampNum(v: unknown, lo: number, hi: number, def: number): number {
  const n = Number(v);
  if (Number.isNaN(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}
