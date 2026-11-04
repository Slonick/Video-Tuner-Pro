// One compressor parameter row: label + readout + range slider. The thumb glide
// (on a preset apply) and the input wiring live in the shared Slider; the readout
// is declarative — it shows the final value while the thumb catches up.
import { Slider } from "../../ui/Slider.js";

interface Props {
  id: string; // slider id (the graph code reads its live value by id)
  valId: string;
  label: string;
  desc: string;
  min: number;
  max: number;
  step: number;
  value: number;
  tickStep?: number; // track tick spacing (value units), for uniformity with the other sliders
  animate: boolean; // glide the thumb to `value` instead of snapping
  disabled?: boolean;
  fmt: (n: number) => string;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
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
  tickStep,
  animate,
  disabled,
  fmt,
  onChange,
  onCommit,
}: Props) {
  return (
    <div className="param">
      <div className="param-row">
        <label>{label}</label>
        <b className="param-val" id={valId}>
          {fmt(value)}
        </b>
      </div>
      <Slider
        className="speed-slider"
        id={id}
        min={min}
        max={max}
        step={step}
        value={value}
        tickStep={tickStep}
        animate={animate}
        disabled={disabled}
        ariaLabel={label}
        ariaValueText={fmt(value)}
        onChange={onChange}
        onCommit={onCommit}
      />
      <div className="param-desc">{desc}</div>
    </div>
  );
}
