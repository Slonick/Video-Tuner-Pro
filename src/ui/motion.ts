// Shared motion.dev presets so animation stays consistent across popup + options.
import { useReducedMotion } from "motion/react";
import type { Transition } from "motion/react";

export const controlSpring: Transition = { type: "spring", stiffness: 700, damping: 34, mass: 0.7 };

export const instant: Transition = { duration: 0 };

// `t`, or `instant` under prefers-reduced-motion. A hook (reads useReducedMotion).
export function useTransitionFor(t: Transition): Transition {
  return useReducedMotion() ? instant : t;
}
