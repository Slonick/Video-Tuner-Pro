// The global auto-slow response knobs surfaced in the popup's auto-slow card
// (Slowest speed + Soft knee + Reaction; Hold / Ease-back stay options-only).
// They're not per-site: each writes its global key live (the content sampler picks
// it up via storage.onChanged). Mirrors options/sections/AutoSlow.tsx.
import { useEffect, useState } from "react";
import { STORE } from "../platform/storage.js";

const clampN = (v: unknown, lo: number, hi: number, def: number): number => {
  const n = Number(v);
  if (Number.isNaN(n)) return def;
  return Math.min(hi, Math.max(lo, n));
};

export interface AutoSlowKnobs {
  floor: number; // percent (50–100)
  knee: number; // soft-knee half-width in syll/s (0–2)
  reaction: number; // percent (0–100)
  setFloor: (v: number) => void;
  setKnee: (v: number) => void;
  setReaction: (v: number) => void;
}

export function useAutoSlowKnobs(): AutoSlowKnobs {
  const [floor, setFloorState] = useState(100);
  const [knee, setKneeState] = useState(0.5);
  const [reaction, setReactionState] = useState(50);

  useEffect(() => {
    STORE.get(["autoSlowFloor", "autoSlowKnee", "autoSlowReaction"], (r) => {
      const f = Number(r.autoSlowFloor);
      setFloorState(Number.isNaN(f) ? 100 : clampN(f * 100, 50, 100, 100));
      setKneeState(clampN(r.autoSlowKnee, 0, 2, 0.5));
      setReactionState(clampN(r.autoSlowReaction, 0, 100, 50));
    });
  }, []);

  return {
    floor,
    knee,
    reaction,
    setFloor: (v) => {
      const n = clampN(v, 50, 100, 100);
      setFloorState(n);
      STORE.set({ autoSlowFloor: n / 100 }); // stored as a fraction
    },
    setKnee: (v) => {
      const n = clampN(v, 0, 2, 0.5);
      setKneeState(n);
      STORE.set({ autoSlowKnee: n });
    },
    setReaction: (v) => {
      const n = clampN(v, 0, 100, 50);
      setReactionState(n);
      STORE.set({ autoSlowReaction: n });
    },
  };
}
