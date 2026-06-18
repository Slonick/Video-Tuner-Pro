// Mount the audio + buffer canvas meters once and tear them down on unmount. The
// canvases are queried by id inside setupGraphs (they're rendered by the audio /
// live-sync cards), so this just bridges the live tab id + VOT callback in.
import { useEffect, useRef } from "react";
import { setupGraphs } from "../graphs/index.js";

export function useGraphs(tabId: number | null, onTranslating: (on: boolean) => void): void {
  const tabRef = useRef(tabId);
  tabRef.current = tabId;
  const transRef = useRef(onTranslating);
  transRef.current = onTranslating;

  useEffect(() => {
    return setupGraphs(
      () => tabRef.current,
      (on) => transRef.current(on),
    );
  }, []);
}
