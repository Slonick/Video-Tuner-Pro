// A transient "Saved ✓" pulse on a button. Returns [on, pulse]: pulse() flips it
// on for `ms`, then off. The timer is cleared on unmount so it never calls
// setState after the component is gone.
import { useEffect, useRef, useState } from "react";

export function useFlash(ms = 1500): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const pulse = () => {
    setOn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), ms);
  };
  return [on, pulse];
}
