// Section expand/collapse state + the imperative bits the CSS animation needs:
// scroll the growing section into view, drop the body's overflow clip once open
// (so in-body tooltips can overflow), and — for the speed card — FLIP-animate the
// preset grid as its extra buttons appear/disappear.
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  revealOnExpand,
  captureGridRects,
  animateGridFrom,
  type GridRects,
} from "../lib/section-anim.js";

interface Expand {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  bodyRef: RefObject<HTMLDivElement>;
  onBodyTransitionEnd: (e: React.TransitionEvent) => void;
}

export function useExpand(
  sectionRef: RefObject<HTMLElement>,
  gridRef?: RefObject<HTMLElement>,
): Expand {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const firstRects = useRef<GridRects | null>(null);

  const toggle = useCallback(() => {
    if (gridRef?.current) firstRects.current = captureGridRects(gridRef.current);
    setOpen((prev) => {
      const next = !prev;
      // Clip again while collapsing (CSS hides overflow during the max-height run).
      if (!next && bodyRef.current) bodyRef.current.style.overflow = "";
      return next;
    });
  }, [gridRef]);

  useLayoutEffect(() => {
    if (gridRef?.current && firstRects.current) {
      animateGridFrom(gridRef.current, firstRects.current);
      firstRects.current = null;
    }
    if (open && sectionRef.current) revealOnExpand(sectionRef.current);
  }, [open, gridRef, sectionRef]);

  const onBodyTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      if (e.propertyName === "max-height" && open && bodyRef.current) {
        bodyRef.current.style.overflow = "visible";
      }
    },
    [open],
  );

  return { open, toggle, setOpen, bodyRef, onBodyTransitionEnd };
}
