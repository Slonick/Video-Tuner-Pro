// Tiny animation helpers — our own, no motion.dev. A requestAnimationFrame value
// tween (for number read-outs and the slider glide) and a reduced-motion probe.
// Element transforms use the native Web Animations API directly at the call site.

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export interface TweenControls {
  stop(): void;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

// Tween `from` → `to` over `durationMs`, calling onUpdate each frame (and exactly
// once with `to` at the end), then onComplete. Returns a handle to cancel it.
export function tweenValue(
  from: number,
  to: number,
  durationMs: number,
  onUpdate: (value: number) => void,
  onComplete?: () => void,
): TweenControls {
  let raf = 0;
  let start = 0;
  const step = (now: number) => {
    if (!start) start = now;
    const t = Math.min(1, (now - start) / durationMs);
    onUpdate(from + (to - from) * easeOut(t));
    if (t < 1) raf = requestAnimationFrame(step);
    else onComplete?.();
  };
  raf = requestAnimationFrame(step);
  return { stop: () => cancelAnimationFrame(raf) };
}
