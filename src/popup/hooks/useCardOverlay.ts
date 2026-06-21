// Expand a card into a full-popup overlay and back, with a FLIP transform so the
// growth/shrink is GPU-smooth. The card's grid slot is frozen to its collapsed
// height while expanded, so the rest of the grid doesn't reflow underneath the
// overlay. Shared by all four cards (only one can be open — the overlay covers
// the others). setOpen is for the cards that auto-expand on first enable.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { prefersReducedMotion } from "../../ui/anim.js";

const DUR = 300; // ms

export function useCardOverlay(
  sectionRef: RefObject<HTMLElement | null>,
  slotRef: RefObject<HTMLElement | null>,
  // When false, the card won't expand on a header click (a disabled card has
  // nothing to configure). Closing an already-open card is always allowed.
  canOpen = true,
): { open: boolean; toggle: () => void; setOpen: (open: boolean) => void } {
  const [open, setOpenState] = useState(false);
  const firstRect = useRef<DOMRect | null>(null);
  const compactH = useRef(0);
  const flip = useRef<Animation | null>(null);

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
    // via the Web Animations API. It animates `transform` with fill:none, so it
    // leaves no inline transform behind once finished (a leftover transform on the
    // open card would make it a containing block and throw off tooltip positioning).
    const last = sec.getBoundingClientRect();
    const dx = first.left - last.left,
      dy = first.top - last.top;
    const sx = last.width ? first.width / last.width : 1,
      sy = last.height ? first.height / last.height : 1;
    flip.current?.cancel();

    // onfinish (not the finished promise) so a cancel() from a rapid re-toggle /
    // unmount doesn't run stale cleanup.
    const cleanup = () => {
      sec.style.removeProperty("transform-origin");
      if (!open && slot) slot.style.height = ""; // release the slot once collapsed
    };

    if (prefersReducedMotion()) {
      cleanup();
    } else {
      sec.style.transformOrigin = "top left";
      const anim = sec.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: "none" }],
        { duration: DUR, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
      );
      flip.current = anim;
      anim.onfinish = cleanup;
    }

    return () => flip.current?.cancel();
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
