// Count a number in an element from one value to another — the readout animates
// on its own, independent of any slider thumb. `render` turns the live value into
// the shown text (e.g. rounding + a unit). A new tween on the same element
// cancels the previous one. Honours reduced motion.
const running = new WeakMap<HTMLElement, number>();

const DUR = 200;
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

export function tweenNumber(
  el: HTMLElement,
  from: number,
  to: number,
  render: (value: number) => string,
): void {
  const prev = running.get(el);
  if (prev) cancelAnimationFrame(prev);

  if (from === to || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = render(to);
    running.delete(el);
    return;
  }

  let start: number | null = null;
  function frame(now: number): void {
    if (start === null) start = now;
    const t = Math.min(1, (now - start) / DUR);
    el.textContent = render(from + (to - from) * easeOut(t));
    if (t < 1) {
      running.set(el, requestAnimationFrame(frame));
    } else {
      el.textContent = render(to);
      running.delete(el);
    }
  }
  running.set(el, requestAnimationFrame(frame));
}
