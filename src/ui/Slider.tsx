// Shared range slider on Radix Slider. The committed `value` comes from the
// parent; the thumb position is owned by internal `display` state so a parent
// that doesn't store the live value (the speed card) isn't re-rendered while the
// preset-apply glide runs. `onChange` is the live, every-frame preview (native
// "input"); `onCommit` fires on release (native "change"). With `animate`, a value
// change from outside glides the thumb (driven by motion.dev's `animate`) instead
// of snapping — collapsed to a snap under prefers-reduced-motion.
import * as RadixSlider from "@radix-ui/react-slider";
import { useLayoutEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import type { AnimationPlaybackControls } from "motion/react";

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
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
}

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
  onChange,
  onCommit,
}: Props) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);
  const dragging = useRef(false);
  const tween = useRef<AnimationPlaybackControls | null>(null);

  const set = (v: number) => {
    displayRef.current = v;
    setDisplay(v);
  };
  const stop = () => {
    tween.current?.stop();
    tween.current = null;
  };

  // Sync the thumb to the committed value when it changes from outside — but never
  // while the user is dragging (that would fight the finger). Glide via motion.dev
  // when `animate`, else snap.
  useLayoutEffect(() => {
    if (dragging.current) return;
    stop();
    const from = displayRef.current;
    if (!glide || reduce || from === value) {
      set(value);
      return;
    }
    tween.current = animate(from, value, { duration: 0.2, ease: "easeOut", onUpdate: set });
    return stop;
    // displayRef is read intentionally without being a dep (it tracks the latest).
  }, [value, glide, reduce]);

  return (
    <RadixSlider.Root
      id={id}
      className={className}
      min={min}
      max={max}
      step={step}
      value={[display]}
      disabled={disabled}
      onValueChange={([v]) => {
        dragging.current = true;
        stop();
        set(v);
        onChange?.(v);
      }}
      onValueCommit={([v]) => {
        dragging.current = false;
        set(v);
        onCommit?.(v);
      }}
    >
      <RadixSlider.Track className="slider-track">
        <RadixSlider.Range className="slider-range" />
      </RadixSlider.Track>
      <RadixSlider.Thumb className="slider-thumb" aria-label={ariaLabel} />
    </RadixSlider.Root>
  );
}
