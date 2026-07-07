// A flat inline control row: −  slider  +  reset  value. No capsule/glass — just
// the slider sized to fill between flat stepper buttons, with the read-out at the
// end. Reused by the Speed, Live-sync and Auto-slow cards. Keeps the original
// element ids (tests + the tick CSS key off them). The value is either a tweened
// ref (the speed read-out owns its animation) or a static node.
import type { ReactNode, Ref } from "react";
import { Slider } from "../../ui/Slider.js";
import { IconButton } from "../../ui/IconButton.js";
import { MinusIcon, PlusIcon, ResetIcon } from "../icons.js";

interface Props {
  sliderId: string;
  min: number;
  max: number;
  step: number;
  value: number;
  tickStep?: number;
  animate?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  ariaValueText?: string;
  onChange?: (v: number) => void;
  onCommit?: (v: number) => void;
  onDown: () => void;
  downId: string;
  downLabel: string;
  downTitle?: string;
  onUp: () => void;
  upId: string;
  upLabel: string;
  upTitle?: string;
  onReset: () => void;
  resetId: string;
  resetTitle?: string;
  readoutRef?: Ref<HTMLSpanElement>;
  readoutId?: string;
  valueText?: ReactNode;
}

export function SliderRow(p: Props) {
  return (
    <div className="slider-row">
      <IconButton
        className="spin"
        id={p.downId}
        aria-label={p.downLabel}
        title={p.downTitle}
        disabled={p.disabled}
        onClick={p.onDown}
      >
        <MinusIcon />
      </IconButton>
      <Slider
        className="speed-slider"
        id={p.sliderId}
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        tickStep={p.tickStep}
        animate={p.animate}
        disabled={p.disabled}
        ariaLabel={p.ariaLabel}
        ariaValueText={p.ariaValueText}
        onChange={p.onChange}
        onCommit={p.onCommit}
      />
      <IconButton
        className="spin"
        id={p.upId}
        aria-label={p.upLabel}
        title={p.upTitle}
        disabled={p.disabled}
        onClick={p.onUp}
      >
        <PlusIcon />
      </IconButton>
      <IconButton
        className="spin"
        id={p.resetId}
        aria-label="Reset"
        title={p.resetTitle}
        disabled={p.disabled}
        onClick={p.onReset}
      >
        <ResetIcon />
      </IconButton>
      {p.readoutRef ? (
        <span ref={p.readoutRef} id={p.readoutId} className="slider-row-val" />
      ) : (
        <span className="slider-row-val">{p.valueText}</span>
      )}
    </div>
  );
}
