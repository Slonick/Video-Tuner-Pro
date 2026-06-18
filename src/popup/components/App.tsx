// Popup root: resolve the active tab, wire the per-card hooks, drive the canvas
// meters, and render the three cards.
import { useState } from "react";
import { useActiveTab, useTabMessaging } from "../hooks/tab.js";
import { useSpeed } from "../hooks/useSpeed.js";
import { useLiveSync } from "../hooks/useLiveSync.js";
import { useAudioCompressor } from "../hooks/useAudioCompressor.js";
import { useGraphs } from "../hooks/useGraphs.js";
import { Header } from "./Header.js";
import { SpeedCard } from "./SpeedCard.js";
import { LiveSyncCard } from "./LiveSyncCard.js";
import { AudioCard } from "./AudioCard.js";

export function App() {
  const tab = useActiveTab();
  const send = useTabMessaging(tab?.tabId ?? null);
  const speed = useSpeed(tab, send);
  const sync = useLiveSync(tab, send);
  const audio = useAudioCompressor();
  const [translating, setTranslating] = useState(false);
  useGraphs(tab?.tabId ?? null, setTranslating);

  return (
    <>
      <Header />
      <SpeedCard speed={speed} domain={tab?.domain ?? ""} />
      <LiveSyncCard sync={sync} />
      <AudioCard audio={audio} translating={translating} />
    </>
  );
}
