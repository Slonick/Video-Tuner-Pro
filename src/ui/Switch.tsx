// The popup/options on/off switch — a plain accessible button, no Radix/motion.
// role="switch" + aria-checked give the semantics; a button handles Space/Enter
// natively. data-state stays "checked"/"unchecked" because CSS keys off it (the
// track colour, and the keyboard-hint badges via #kbdToggle[data-state]).
//
// The knob toggles in a choreographed sequence rather than a single slide:
//   glass → grow → move → shrink → solid colour.
// Driven here by timed phases — `glass` (clear-glass look), `grown` (scale up) and
// `pos` (which side the knob sits, via inline --knob-x, so the move waits for its
// phase instead of following the state instantly). See .switch-knob in
// sections.css / controls.css. Reduced-motion just snaps.
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./anim.js";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  // Marks an experimental feature: the track turns warm orange (instead of accent)
  // when on, so "beta" lives on the toggle itself — no locale-fragile text tag in
  // the title row.
  beta?: boolean;
}

export function Switch({ checked, onChange, disabled, id, beta }: Props) {
  const [pos, setPos] = useState(checked); // knob side — lags `checked` during the move phase
  const [glass, setGlass] = useState(false);
  const [grown, setGrown] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const prev = useRef(checked);
  const firstRender = useRef(true);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  useEffect(() => {
    if (prev.current === checked) return;
    prev.current = checked;
    if (firstRender.current) {
      firstRender.current = false;
      setPos(checked);
      return;
    }
    clearTimers();
    if (prefersReducedMotion()) {
      setPos(checked);
      return;
    }
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    setGlass(true); // 1. clear glass
    at(70, () => setGrown(true)); // 2. grow
    at(230, () => setPos(checked)); // 3. move across
    at(400, () => setGrown(false)); // 4. shrink
    at(560, () => setGlass(false)); // 5. settle to solid colour
  }, [checked]);

  useEffect(() => () => clearTimers(), []);

  // `beta` only tints the track orange (.switch-beta); the "BETA" badge itself lives
  // on the card's description line (see the card), so it survives long, wrapping
  // localized titles.
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-state={checked ? "checked" : "unchecked"}
      className={"switch switch-track" + (beta ? " switch-beta" : "")}
      onClick={() => onChange(!checked)}
    >
      <span
        className={"switch-knob" + (glass ? " is-moving" : "") + (grown ? " is-grown" : "")}
        aria-hidden="true"
        style={{ "--knob-x": pos ? "18px" : "0px" } as CSSProperties}
      />
    </button>
  );
}
