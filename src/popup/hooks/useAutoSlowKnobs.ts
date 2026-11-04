// The global auto-slow response knobs surfaced in the popup's auto-slow card
// (Slowest speed + Soft knee; Reaction / Hold / Ease-back stay options-only).
// They're not per-site: each writes its global key (the content sampler picks it up
// via storage.onChanged). A drag only previews; the write lands on release, since
// these keys sync and a per-step write would trip storage.sync's write quota.
// Mirrors options/sections/AutoSlow.tsx.
import { useState } from "react";
import { STORE } from "../platform/storage.js";
import { useStored } from "./useStored.js";

const clampN = (v: unknown, lo: number, hi: number, def: number): number => {
  const n = Number(v);
  if (Number.isNaN(n)) return def;
  return Math.min(hi, Math.max(lo, n));
};

export interface AutoSlowKnobs {
  floor: number; // percent (50–200)
  knee: number; // soft-knee half-width in syll/s (0–2)
  previewFloor: (v: number) => void;
  previewKnee: (v: number) => void;
  setFloor: (v: number) => void;
  setKnee: (v: number) => void;
}

export function useAutoSlowKnobs(): AutoSlowKnobs {
  const [floor, setFloorState] = useState(100);
  const [knee, setKneeState] = useState(0.5);

  useStored(["autoSlowFloor", "autoSlowKnee"], (r) => {
    const f = Number(r.autoSlowFloor);
    setFloorState(Number.isNaN(f) ? 100 : clampN(Math.round(f * 100), 50, 200, 100));
    setKneeState(clampN(r.autoSlowKnee, 0, 2, 0.5));
  });

  return {
    floor,
    knee,
    previewFloor: (v) => setFloorState(clampN(v, 50, 200, 100)),
    previewKnee: (v) => setKneeState(clampN(v, 0, 2, 0.5)),
    setFloor: (v) => {
      const n = clampN(v, 50, 200, 100);
      setFloorState(n);
      STORE.set({ autoSlowFloor: n / 100 }); // stored as a fraction
    },
    setKnee: (v) => {
      const n = clampN(v, 0, 2, 0.5);
      setKneeState(n);
      STORE.set({ autoSlowKnee: n });
    },
  };
}
