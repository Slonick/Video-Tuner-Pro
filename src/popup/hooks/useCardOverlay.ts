// Expand a card into a full-popup overlay and back, with a FLIP transform so the
// growth/shrink is GPU-smooth. The card's grid slot is frozen to its collapsed
// height while expanded, so the rest of the grid doesn't reflow underneath the
// overlay. Shared by all four cards (only one can be open — the overlay covers
// the others). setOpen is for the cards that auto-expand on first enable.
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

const DUR = 300;

export function useCardOverlay(
  sectionRef: RefObject<HTMLElement>,
  slotRef: RefObject<HTMLElement>,
  // When false, the card won't expand on a header click (a disabled card has
  // nothing to configure). Closing an already-open card is always allowed.
  canOpen = true,
): { open: boolean; toggle: () => void; setOpen: (open: boolean) => void } {
  const [open, setOpenState] = useState(false);
  const firstRect = useRef<DOMRect | null>(null);
  const compactH = useRef(0);

  // Capture the card's current rect (and, when opening, its collapsed height) so
  // the layout effect can FLIP from here to the post-render rect.
  const setOpen = useCallback(
    (next: boolean) => {
      const sec = sectionRef.current;
      if (sec) {
        firstRect.current = sec.getBoundingClientRect();
        if (next) compactH.current = firstRect.current.height;
      }
      setOpenState(next);
    },
    [sectionRef],
  );

  const toggle = useCallback(() => {
    if (open) setOpen(false);
    else if (canOpen) setOpen(true);
  }, [open, canOpen, setOpen]);

  useLayoutEffect(() => {
    const sec = sectionRef.current as HTMLElement | null;
    const slot = slotRef.current as HTMLElement | null;
    const first = firstRect.current;
    firstRect.current = null;
    if (!sec || !first) return;

    // Hold the slot's space so the grid stays put while the card is lifted out
    // (must be set before we measure the overlay's full rect below).
    if (open && slot) slot.style.height = `${Math.round(compactH.current)}px`;

    // FLIP: invert from the new rect back to the old one, then play to identity.
    const last = sec.getBoundingClientRect();
    const dx = first.left - last.left,
      dy = first.top - last.top;
    const sx = last.width ? first.width / last.width : 1,
      sy = last.height ? first.height / last.height : 1;
    sec.style.transition = "none";
    sec.style.transformOrigin = "top left";
    sec.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    void sec.offsetWidth; // commit the inverted state
    sec.style.transition = `transform ${DUR}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    sec.style.transform = "";

    const done = (e: TransitionEvent) => {
      if (e.target !== sec || e.propertyName !== "transform") return;
      sec.removeEventListener("transitionend", done);
      sec.style.transition = "";
      sec.style.transformOrigin = "";
      if (!open && slot) slot.style.height = ""; // release the slot once collapsed
    };
    sec.addEventListener("transitionend", done);
  }, [open, sectionRef, slotRef]);

  return { open, toggle, setOpen };
}
