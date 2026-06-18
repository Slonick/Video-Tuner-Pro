// React binding over the routed STORE (selective-sync layer). The popup is
// short-lived, so this reads once on mount and writes through on change.
import { useCallback, useEffect, useState } from "react";
import { STORE } from "../platform/storage.js";

// A boolean flag with the project's "default on/off" semantics: when `defaultOn`,
// only an explicit stored `false` turns it off; otherwise only an explicit `true`
// turns it on. Mirrors the old `r.key !== false` / `r.key === true` reads.
export function useStoredFlag(key: string, defaultOn: boolean): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(defaultOn);
  useEffect(() => {
    STORE.get([key], (r) => {
      setOn(defaultOn ? r[key] !== false : r[key] === true);
    });
  }, [key, defaultOn]);
  const set = useCallback(
    (next: boolean) => {
      setOn(next);
      STORE.set({ [key]: next });
    },
    [key],
  );
  return [on, set];
}
