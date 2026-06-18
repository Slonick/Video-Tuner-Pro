// Glide a native <input type=range> to a value — the only way to "animate" the
// thumb, whose position can't be CSS-transitioned. Purely cosmetic: callers set
// the real value / readout / storage up front; this just slides the thumb to
// catch up. `step="any"` during the run lets it move between steps (the native
// step would snap every frame); the original step is restored at the end. A new
// tween on the same slider cancels the previous one. Honours reduced motion.
interface Tween {
  raf: number;
  step: string;
}
const running = new WeakMap<HTMLInputElement, Tween>();

const DUR = 200;
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

export function tweenSlider(slider: HTMLInputElement, target: number): void {
  const prev = running.get(slider);
  // The true original step — captured on the first tween, kept across restarts.
  const step = prev ? prev.step : slider.step;
  if (prev) cancelAnimationFrame(prev.raf);

  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    slider.value = String(target);
    slider.step = step;
    running.delete(slider);
    return;
  }

  const from = Number(slider.value);
  if (from === target) {
    slider.step = step;
    running.delete(slider);
    return;
  }
  slider.step = "any";

  let start: number | null = null;
  function frame(now: number): void {
    if (start === null) start = now;
    const t = Math.min(1, (now - start) / DUR);
    slider.value = String(from + (target - from) * easeOut(t));
    if (t < 1) {
      running.set(slider, { raf: requestAnimationFrame(frame), step });
    } else {
      slider.value = String(target);
      slider.step = step;
      running.delete(slider);
    }
  }
  running.set(slider, { raf: requestAnimationFrame(frame), step });
}
