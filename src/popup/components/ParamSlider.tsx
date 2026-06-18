// One compressor parameter row: label + readout + range slider. Owns its own
// thumb tween (glide on a preset apply, snap on drag/load) via a ref, so the
// audio card doesn't manage a ref-map. The readout is declarative.
import { useLayoutEffect, useRef } from "react";
import { tweenSlider } from "../core/tween-slider.js";

interface Props {
  id: string; // slider id (the graph code reads its live value by id)
  valId: string;
  label: string;
  desc: string;
  min: number;
  max: number;
  step: number;
  value: number;
  animate: boolean; // glide the thumb to `value` instead of snapping
  fmt: (n: number) => string;
  onChange: (value: number) => void;
}

export function ParamSlider({
  id,
  valId,
  label,
  desc,
  min,
  max,
  step,
  value,
  animate,
  fmt,
  onChange,
}: Props) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (animate) tweenSlider(el, value);
    else el.value = String(value);
  }, [value, animate]);

  const handle = (e: React.SyntheticEvent<HTMLInputElement>) =>
    onChange(Number(e.currentTarget.value));

  return (
    <div className="param">
      <div className="param-row">
        <label>{label}</label>
        <b className="param-val" id={valId}>
          {fmt(value)}
        </b>
      </div>
      <input
        ref={ref}
        type="range"
        className="speed-slider"
        id={id}
        min={min}
        max={max}
        step={step}
        onInput={handle}
        onChange={handle}
      />
      <div className="param-desc">{desc}</div>
    </div>
  );
}
