// Count a number in an element from one value to another — the readout animates
// on its own, independent of any slider thumb. `render` turns the live value into
// the shown text (e.g. rounding + a unit). Driven by motion.dev's `animate`; a new
// tween on the same element cancels the previous one. Honours reduced motion.
import { animate } from "motion/react";
import type { AnimationPlaybackControls } from "motion/react";

const running = new WeakMap<HTMLElement, AnimationPlaybackControls>();

export function tweenNumber(
  el: HTMLElement,
  from: number,
  to: number,
  render: (value: number) => string,
): void {
  running.get(el)?.stop();
  running.delete(el);

  if (from === to || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = render(to);
    return;
  }

  const controls = animate(from, to, {
    duration: 0.2,
    ease: "easeOut",
    onUpdate: (v) => {
      el.textContent = render(v);
    },
    onComplete: () => {
      el.textContent = render(to);
      running.delete(el);
    },
  });
  running.set(el, controls);
}
