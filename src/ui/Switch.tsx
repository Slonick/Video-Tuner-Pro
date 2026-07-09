// The popup/options on/off switch — a plain accessible button, no Radix/motion.
// role="switch" + aria-checked give the semantics; a button handles Space/Enter
// natively. data-state stays "checked"/"unchecked" because CSS keys off it (the
// track colour, and the keyboard-hint badges via #kbdToggle[data-state]).
//
// The knob is a real draggable slider, not just a click target. Press it and it
// grows + turns to clear glass; drag it across and it tracks the pointer 1:1,
// with a soft rubber-band past either rail; release and it springs to whichever
// side it's closer to. A plain click (no drag) is the same gesture compressed to
// zero distance — one code path for both.
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./anim.js";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  // Accessible name for the switch — role=switch needs one when the visible label
  // sits in an adjacent element rather than wrapping the control.
  ariaLabel?: string;
}

const TRAVEL = 18; // px — 54 (track) − 32 (knob) − 2×2 (insets); keep in sync with the CSS
const DRAG_THRESHOLD = 4; // px of movement before a press counts as a drag, not a click
const OVERFLOW_DAMPING = 4; // rubber-band resistance for dragging past either rail
const SETTLE_MS = 260; // >= the knob's transform transition, so `active` outlasts the spring

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function Switch({ checked, onChange, disabled, id, ariaLabel }: Props) {
  const [ratio, setRatioState] = useState(checked ? 1 : 0); // knob position, 0..1 (past-rail while dragging)
  const [active, setActive] = useState(false);
  const ratioRef = useRef(ratio);
  const trackRef = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const startX = useRef(0);
  const startRatio = useRef(0);
  const suppressClick = useRef(false); // a drag-release already toggled; swallow the synthesized click
  const prevChecked = useRef(checked);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const suppressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const setRatio = (v: number) => {
    ratioRef.current = v;
    setRatioState(v);
  };

  // Follow `checked` when it changes from outside (keyboard activation fires a
  // native click — same as a mouse click, handled below — but a parent could also
  // flip it directly) and we're not mid-drag: spring to the new rail and give the
  // knob the same brief "active" pulse a press would, so it never just snaps.
  useEffect(() => {
    if (dragging.current || prevChecked.current === checked) return;
    prevChecked.current = checked;
    setRatio(checked ? 1 : 0);
    clearTimeout(settleTimer.current);
    if (prefersReducedMotion()) return;
    setActive(true);
    settleTimer.current = setTimeout(() => setActive(false), SETTLE_MS);
  }, [checked]);

  useEffect(
    () => () => {
      clearTimeout(settleTimer.current);
      clearTimeout(suppressTimer.current);
    },
    [],
  );

  const ratioFromClientX = (clientX: number): number => {
    const raw = startRatio.current + (clientX - startX.current) / TRAVEL;
    const overflow = raw < 0 ? raw : raw > 1 ? raw - 1 : 0;
    return clamp01(raw) + overflow / OVERFLOW_DAMPING;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    clearTimeout(settleTimer.current);
    dragging.current = true;
    moved.current = false;
    startX.current = e.clientX;
    startRatio.current = checked ? 1 : 0;
    if (e.pointerId != null) trackRef.current?.setPointerCapture?.(e.pointerId);
    // Disables the transform transition (controls.css) so the knob tracks the
    // pointer 1:1 instead of lagging behind it during a real drag.
    setActive(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging.current) return;
    if (Math.abs(e.clientX - startX.current) > DRAG_THRESHOLD) moved.current = true;
    setRatio(ratioFromClientX(e.clientX));
  };

  const endDrag = (e: React.PointerEvent<HTMLButtonElement>, commit = true) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (e.pointerId != null && trackRef.current?.hasPointerCapture?.(e.pointerId)) {
      trackRef.current.releasePointerCapture(e.pointerId);
    }
    setActive(false);
    if (commit && moved.current) {
      const shouldBeChecked = ratioRef.current > 0.5;
      suppressClick.current = true; // the browser still synthesizes a click after pointerup
      clearTimeout(suppressTimer.current);
      suppressTimer.current = setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      prevChecked.current = shouldBeChecked;
      setRatio(shouldBeChecked ? 1 : 0);
      if (shouldBeChecked !== checked) onChange(shouldBeChecked);
    } else {
      setRatio(checked ? 1 : 0); // snap back — the click handler below does the actual toggle
    }
  };
  const cancelDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    suppressClick.current = false;
    clearTimeout(suppressTimer.current);
    endDrag(e, false);
  };
  const onLostPointerCapture = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging.current) return;
    endDrag(e, false);
  };

  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      clearTimeout(suppressTimer.current);
      return;
    }
    onChange(!checked);
  };

  return (
    <button
      ref={trackRef}
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      data-state={checked ? "checked" : "unchecked"}
      className="switch switch-track"
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={cancelDrag}
      onLostPointerCapture={onLostPointerCapture}
      onClick={onClick}
    >
      <span
        className={"switch-knob" + (active ? " is-active" : "")}
        aria-hidden="true"
        style={{ "--knob-x": `${ratio * TRAVEL}px` } as CSSProperties}
      />
    </button>
  );
}
