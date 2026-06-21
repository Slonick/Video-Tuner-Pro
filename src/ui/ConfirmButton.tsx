// A two-step confirmation button for destructive actions (reset / remove). The
// first click "arms" it; a second confirms. It disarms on blur or after a short
// timeout, so a stray first click is harmless. No modal/overlay.
//
// Two armed presentations:
//   • confirmChildren — swaps the label in place (e.g. "Reset to defaults" →
//     "Confirm?"). The idle label stays in flow (hidden) so the width is stable.
//   • split — the icon button (e.g. ✕) becomes a ✓ confirm in place; a "Confirm? ✕"
//     bubble floats above carrying the hint + cancel (a side ✕ vanished behind dense
//     rows/cells).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button.js";

interface Props {
  onConfirm: () => void;
  children: ReactNode; // idle label / icon
  confirmChildren?: ReactNode; // armed label, overlaid on the reserved idle width
  split?: boolean; // armed → ✓ confirm + ✕ cancel (for icon buttons)
  confirmHint?: ReactNode; // split: the "Confirm?" popover above the button
  className?: string;
  id?: string;
  title?: string;
  confirmTitle?: string;
  cancelTitle?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

const DISARM_MS = 3000;

export function ConfirmButton({
  onConfirm,
  children,
  confirmChildren,
  split,
  confirmHint,
  className = "",
  id,
  title,
  confirmTitle,
  cancelTitle,
  ariaLabel,
  disabled,
}: Props) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const disarm = () => {
    clearTimeout(timer.current);
    setArmed(false);
  };
  const arm = () => {
    setArmed(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(false), DISARM_MS);
  };
  const confirm = () => {
    disarm();
    onConfirm();
  };

  // Icon button: arm → ✓ confirm (in the icon's place) + a floating "Confirm? ✕" bubble.
  if (split) {
    if (!armed) {
      return (
        <Button
          id={id}
          disabled={disabled}
          className={"confirm-btn " + className}
          title={title}
          aria-label={ariaLabel}
          onClick={arm}
        >
          {children}
        </Button>
      );
    }
    // ✓ stays in flow (same footprint as the idle ✕ → no layout shift); the hint +
    // cancel float above in the bubble, so dense rows/cells never have to make room.
    return (
      <span
        className="confirm-wrap confirm-split"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) disarm();
        }}
      >
        <Button
          autoFocus
          className={"confirm-btn " + className + " is-armed"}
          title={confirmTitle}
          aria-label={confirmTitle || "Confirm"}
          onClick={confirm}
        >
          ✓
        </Button>
        {/* The hint + cancel float above the button so a dense row/cell never has to
            make room for a side ✕ (which got hidden behind neighbours). */}
        <span className="confirm-pop">
          {confirmHint}
          <button
            type="button"
            className="confirm-cancel"
            title={cancelTitle}
            aria-label={cancelTitle || "Cancel"}
            onClick={disarm}
          >
            ✕
          </button>
        </span>
      </span>
    );
  }

  // Text button: swap the label, keeping the width via the hidden idle copy.
  return (
    <Button
      id={id}
      disabled={disabled}
      className={"confirm-btn " + className + (armed ? " is-armed" : "")}
      title={armed ? confirmTitle : title}
      aria-label={ariaLabel}
      onClick={armed ? confirm : arm}
      onBlur={disarm}
    >
      <span
        className="cb-face"
        style={armed && confirmChildren ? { visibility: "hidden" } : undefined}
      >
        {children}
      </span>
      {armed && confirmChildren && <span className="cb-confirm">{confirmChildren}</span>}
    </Button>
  );
}
