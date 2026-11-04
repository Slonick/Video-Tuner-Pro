// The key-capture editors (Keys, SpeedPresets) take the next keydown anywhere on
// the document, and every pane stays mounted — so a capture left armed would
// swallow a keystroke typed later in another field, or two editors armed at once
// would both bind the same key. Disarm once the user has clearly moved on (the
// window lost focus, or a press landed outside the waiting key-cap), and let only
// one editor be armed at a time.
import { useEffect, useRef } from "react";

let disarmActive: (() => void) | null = null;

export function useCaptureGuard(armed: boolean, disarm: () => void): void {
  const disarmRef = useRef(disarm);
  disarmRef.current = disarm;

  useEffect(() => {
    if (!armed) return;
    const off = () => disarmRef.current();
    disarmActive?.();
    disarmActive = off;
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest(".key-cap.capturing"))) off();
    };
    window.addEventListener("blur", off);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      if (disarmActive === off) disarmActive = null;
      window.removeEventListener("blur", off);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [armed]);
}
