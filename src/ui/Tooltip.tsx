// Shared tooltip — our own, no Radix. The bubble is portaled onto document.body
// so it escapes the cards' overflow/scroll clipping, and positioned with fixed
// coords next to the trigger (flips top/bottom when cramped, clamps horizontally
// to the viewport). Opens on hover + focus, closes on leave/blur/Escape. Handlers
// are cloned onto the trigger itself, so no extra wrapper box disturbs the layout.
// Content IS the .tip bubble; the fade-in is the CSS animation keyed off data-state.
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface Props {
  trigger: ReactNode; // the element that opens the tooltip
  content: ReactNode;
  side?: "top" | "bottom";
  bubbleClassName?: string; // extra classes on the .tip bubble (e.g. "warn kbd-tip")
}

const PAD = 8; // viewport collision padding
const OFFSET = 8; // gap between trigger and bubble

export function Tooltip({ trigger, content, side = "top", bubbleClassName }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const tipId = useId();

  const place = useCallback(() => {
    const trig = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trig || !bubble) return;
    const t = trig.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    let top = side === "bottom" ? t.bottom + OFFSET : t.top - b.height - OFFSET;
    if (side !== "bottom" && top < PAD) top = t.bottom + OFFSET; // flip down
    if (side === "bottom" && top + b.height > window.innerHeight - PAD) {
      top = t.top - b.height - OFFSET; // flip up
    }
    const left = Math.max(
      PAD,
      Math.min(t.left + t.width / 2 - b.width / 2, window.innerWidth - b.width - PAD),
    );
    setPos({ top, left });
  }, [side]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, place, content]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => place();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, place]);

  const triggerEl = isValidElement(trigger)
    ? cloneElement(trigger as ReactElement<Record<string, unknown>>, {
        ref: triggerRef,
        // Associate the bubble so screen readers announce its content on focus —
        // without this the tooltip text is visual-only (the trigger's own label
        // doesn't carry it).
        "aria-describedby": open ? tipId : undefined,
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
        onFocus: () => setOpen(true),
        onBlur: () => setOpen(false),
      })
    : trigger;

  return (
    <>
      {triggerEl}
      {open &&
        createPortal(
          <div
            ref={bubbleRef}
            id={tipId}
            role="tooltip"
            className={["tip", bubbleClassName].filter(Boolean).join(" ")}
            data-state="instant-open"
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              opacity: pos ? undefined : 0,
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
