// Shared range slider — our own, no Radix/motion. Keeps the same DOM the CSS keys
// off (.slider-track + .slider-thumb, with the tick marks painted on the track).
// The committed `value` comes from the parent; the thumb position is owned by
// internal `display` state so a parent that doesn't store the live value (the speed
// card) isn't re-rendered while the preset-apply glide runs. `onChange` is the
// live, every-frame preview; `onCommit` fires on release. With `animate`, a value
// change from outside glides the thumb (rAF tween) instead of snapping — collapsed
// to a snap under prefers-reduced-motion.
//
// a11y: the thumb is the focusable role="slider" (arrow keys ±step, PageUp/Down
// ±2·step, Home/End); the track is a pointer target with pointer capture.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { prefersReducedMotion, tweenValue, type TweenControls } from "./anim.js";

interface Props {
  id?: string;
  className?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  animate?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  // Human-readable value for screen readers (e.g. "150%", "7 s") — aria-valuenow is
  // just the bare number, so without this the unit/meaning is lost.
  ariaValueText?: string;
  // Spacing of the track tick marks, in value units (e.g. 50 → a tick every 50%).
  // Computed against the live min/max so the marks stay correct when the range is
  // configurable (the speed slider's max is user-tunable). The CSS paints them.
  tickStep?: number;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const THUMB = 18; // px — keep in sync with .slider-thumb width

export function Slider({
  id,
  className,
  min,
  max,
  step,
  value,
  animate: glide = false,
  disabled,
  ariaLabel,
  ariaValueText,
  tickStep,
  onChange,
  onCommit,
}: Props) {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);
  const dragging = useRef(false);
  const tween = useRef<TweenControls | null>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);

  // While the thumb is moving — dragged by the pointer, gliding to a new value, or
  // stepped by the keyboard — it turns to clear glass (the .is-moving rule in
  // controls.css), then back to solid once it settles.
  const [moving, setMoving] = useState(false);
  const movingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const armClearMoving = () => {
    clearTimeout(movingTimer.current);
    movingTimer.current = setTimeout(() => setMoving(false), 80);
  };
  useEffect(() => () => clearTimeout(movingTimer.current), []);

  const set = (v: number) => {
    displayRef.current = v;
    setDisplay(v);
  };
  const stop = () => {
    tween.current?.stop();
    tween.current = null;
  };

  const snap = (v: number) => clamp(Math.round(v / step) * step, min, max);

  const valueFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return displayRef.current;
    const rect = el.getBoundingClientRect();
    const r = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
    return snap(min + r * (max - min));
  };

  // Sync the thumb to the committed value when it changes from outside — but never
  // while the user is dragging (that would fight the finger). Glide when `animate`,
  // else snap.
  useLayoutEffect(() => {
    if (dragging.current) return;
    stop();
    const from = displayRef.current;
    if (!glide || prefersReducedMotion() || from === value) {
      set(value);
      return;
    }
    setMoving(true);
    tween.current = tweenValue(from, value, 350, set, () => {
      tween.current = null;
      setMoving(false);
    });
    return stop;
    // displayRef is read intentionally without being a dep (it tracks the latest).
  }, [value, glide]);

  const live = (v: number) => {
    if (v !== displayRef.current) {
      set(v);
      onChange?.(v);
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (disabled) return;
    dragging.current = true;
    setMoving(true);
    clearTimeout(movingTimer.current); // held → stay glass until release
    stop();
    if (e.pointerId != null) e.currentTarget.setPointerCapture?.(e.pointerId);
    live(valueFromClientX(e.clientX));
    thumbRef.current?.focus();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (dragging.current) live(valueFromClientX(e.clientX));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    setMoving(false);
    if (e.pointerId != null) e.currentTarget.releasePointerCapture?.(e.pointerId);
    onCommit?.(displayRef.current);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    let v = displayRef.current;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        v += step;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        v -= step;
        break;
      case "PageUp":
        v += step * 2;
        break;
      case "PageDown":
        v -= step * 2;
        break;
      case "Home":
        v = min;
        break;
      case "End":
        v = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    v = snap(v);
    if (v !== displayRef.current) {
      set(v);
      onChange?.(v);
      onCommit?.(v);
      setMoving(true);
      armClearMoving();
    }
  };

  const ratio = max > min ? (clamp(display, min, max) - min) / (max - min) : 0;

  // Tick marks as track CSS vars (the gradient lives in CSS): a tick every tickStep
  // value units, the first at the next multiple above min, both as a fraction of the
  // thumb's travel so they stay aligned at any (configurable) max.
  let tickStyle: CSSProperties | undefined;
  if (tickStep && max > min) {
    const range = max - min;
    let first = Math.ceil(min / tickStep) * tickStep;
    if (first <= min) first += tickStep;
    const gap = tickStep / range;
    let off = (first - min) / range;
    while (off >= gap) off -= gap;
    tickStyle = {
      ["--tick-off" as string]: `${off * 100}%`,
      ["--tick-gap" as string]: `${gap * 100}%`,
    };
  }

  return (
    <span
      id={id}
      className={className}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <span
        ref={trackRef}
        className={"slider-track" + (tickStep ? " slider-ticked" : "")}
        style={tickStyle}
      >
        {/* Filled portion up to the thumb centre — invisible unless styled (only
            the capsule sliders paint it; the plain thin sliders leave it off). */}
        <span
          className="slider-range"
          style={{ width: `calc(${ratio * 100}% + ${(0.5 - ratio) * THUMB}px)` }}
        />
      </span>
      <span
        ref={thumbRef}
        className={"slider-thumb" + (moving ? " is-moving" : "")}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-orientation="horizontal"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(display)}
        aria-valuetext={ariaValueText}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        style={{
          position: "absolute",
          top: "50%",
          // Full-width value scale; shift the thumb to stay in bounds (Radix-style)
          // so its centre lands on the track ticks at each value.
          left: `calc(${ratio * 100}% + ${(0.5 - ratio) * THUMB}px)`,
          // --thumb-s grows the thumb while it's moving (set via .is-moving); the
          // centring translate stays put.
          transform: "translate(-50%, -50%) scale(var(--thumb-s, 1))",
        }}
      />
    </span>
  );
}
