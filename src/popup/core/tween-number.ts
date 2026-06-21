// Count a number in an element from one value to another — the readout animates
// on its own, independent of any slider thumb. `render` turns the live value into
// the shown text (e.g. rounding + a unit). Driven by our rAF tween; a new tween on
// the same element cancels the previous one. Honours reduced motion.
import { prefersReducedMotion, tweenValue, type TweenControls } from "../../ui/anim.js";

const running = new WeakMap<HTMLElement, TweenControls>();

export function tweenNumber(
  el: HTMLElement,
  from: number,
  to: number,
  render: (value: number) => string,
): void {
  running.get(el)?.stop();
  running.delete(el);

  if (from === to || prefersReducedMotion()) {
    el.textContent = render(to);
    return;
  }

  const controls = tweenValue(
    from,
    to,
    200,
    (v) => {
      el.textContent = render(v);
    },
    () => {
      el.textContent = render(to);
      running.delete(el);
    },
  );
  running.set(el, controls);
}
