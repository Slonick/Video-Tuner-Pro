import { MIN_SPEED, MAX_SPEED } from "./constants.js";

export function clamp(speed: number): number {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 100) / 100));
}

export function clampNum(v: unknown, lo: number, hi: number, def: number): number {
  const n = Number(v);
  if (Number.isNaN(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}
