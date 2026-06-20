// Expand a card into a full-popup overlay and back, with a FLIP transform so the
// growth/shrink is GPU-smooth. The card's grid slot is frozen to its collapsed
// height while expanded, so the rest of the grid doesn't reflow underneath the
// overlay. Shared by all four cards (only one can be open — the overlay covers
// the others). setOpen is for the cards that auto-expand on first enable.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { animate } from "motion/react";
import type { AnimationPlaybackControls } from "motion/react";

const DUR = 0.3; // seconds (motion)

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
  const flip = useRef<AnimationPlaybackControls | null>(null);

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

    // FLIP: invert from the new rect back to the old one, then play to identity —
    // driven by motion.dev. onComplete (not the finished promise) so a stop() from
    // a rapid re-toggle / unmount doesn't run stale cleanup.
    const last = sec.getBoundingClientRect();
    const dx = first.left - last.left,
      dy = first.top - last.top;
    const sx = last.width ? first.width / last.width : 1,
      sy = last.height ? first.height / last.height : 1;
    flip.current?.stop();
    sec.style.transformOrigin = "top left";
    flip.current = animate(
      sec,
      { x: [dx, 0], y: [dy, 0], scaleX: [sx, 1], scaleY: [sy, 1] },
      {
        duration: DUR,
        ease: [0.4, 0, 0.2, 1],
        onComplete: () => {
          // Clear EVERY transform property motion may have written (it uses the
          // individual translate/scale props, not just `transform`). A leftover
          // transform on the open card makes it a containing block, which throws
          // off Radix Tooltip's positioning for any tooltip triggered inside it.
          for (const p of ["transform", "translate", "scale", "rotate", "transformOrigin"]) {
            sec.style.removeProperty(p);
          }
          if (!open && slot) slot.style.height = ""; // release the slot once collapsed
        },
      },
    );

    return () => flip.current?.stop();
  }, [open, sectionRef, slotRef]);

  // Flag the grid while this card is open so the in-page overlay can fade the
  // other cards out (see html.vtp-embedded .popup-grid.has-overlay in base.css).
  // Ref-counted on the grid: during a tour's card-to-card handoff two cards are
  // briefly open at once, so the class must stay until the last one closes.
  useEffect(() => {
    if (!open) return;
    const grid = slotRef.current?.closest<HTMLElement>(".popup-grid");
    if (!grid) return;
    grid.dataset.overlayCount = String((Number(grid.dataset.overlayCount) || 0) + 1);
    grid.classList.add("has-overlay");
    return () => {
      const left = (Number(grid.dataset.overlayCount) || 1) - 1;
      grid.dataset.overlayCount = String(left);
      if (left <= 0) grid.classList.remove("has-overlay");
    };
  }, [open, slotRef]);

  return { open, toggle, setOpen };
}
