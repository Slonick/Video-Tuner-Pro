// Mount the audio + buffer canvas meters once and tear them down on unmount. The
// canvases are queried by id inside setupGraphs (they're rendered by the audio /
// live-sync cards), so this just bridges the live tab id, VOT callback and the
// cards' guide-line values in.
import { useEffect, useRef } from "react";
import { setupGraphs } from "../graphs/index.js";
import type { GraphGuides } from "../graphs/state.js";

export function useGraphs(
  tabId: number | null,
  onTranslating: (on: boolean) => void,
  onBlocked: (reason: string | null) => void,
  guides: GraphGuides,
): void {
  const tabRef = useRef(tabId);
  tabRef.current = tabId;
  const transRef = useRef(onTranslating);
  transRef.current = onTranslating;
  const blockedRef = useRef(onBlocked);
  blockedRef.current = onBlocked;
  const guidesRef = useRef(guides);
  guidesRef.current = guides;

  useEffect(() => {
    return setupGraphs(
      () => tabRef.current,
      (on) => transRef.current(on),
      (on) => blockedRef.current(on),
      () => guidesRef.current,
    );
  }, []);
}
