// The little "i" info bubble (and the amber "warn" variant) with a tooltip.
// Floating UI positions the bubble and renders it in a portal on document.body,
// so it escapes the cards' overflow/scroll/transform clipping and flips/shifts to
// stay in view on its own.
import { useState, type ReactNode } from "react";
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
} from "@floating-ui/react";
import { InfoIcon, WarnIcon } from "../icons.js";

interface Props {
  tip?: string; // simple text tooltip
  children?: ReactNode; // structured content (e.g. the keyboard hints)
  below?: boolean; // prefer opening downward (flip still kicks in if cramped)
  warn?: boolean; // amber warning variant (uses WarnIcon)
  className?: string; // extra class on the bubble (e.g. "kbd-tip")
  id?: string;
  label?: string; // trigger aria-label
}

export function InfoTip({ tip, children, below, warn, className, id, label }: Props) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: below || warn ? "bottom" : "top",
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { move: false }),
    useFocus(context),
    useDismiss(context),
    useRole(context, { role: "tooltip" }),
  ]);

  return (
    <>
      <span
        ref={refs.setReference}
        className={"info" + (warn ? " warn" : "")}
        id={id}
        tabIndex={0}
        aria-label={label ?? (warn ? "Warning" : "Info")}
        {...getReferenceProps()}
      >
        {warn ? <WarnIcon /> : <InfoIcon />}
      </span>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className={"tip" + (warn ? " warn" : "") + (className ? " " + className : "")}
            style={floatingStyles}
            {...getFloatingProps()}
          >
            {children ?? tip}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
