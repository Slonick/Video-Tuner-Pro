// Popup root: resolve the active tab, wire the per-card hooks, drive the canvas
// meters, and render the three cards.
import { useState } from "react";
import { useActiveTab, useTabMessaging } from "../hooks/tab.js";
import { useSpeed } from "../hooks/useSpeed.js";
import { useLiveSync } from "../hooks/useLiveSync.js";
import { useAutoSlow } from "../hooks/useAutoSlow.js";
import { useAudioCompressor } from "../hooks/useAudioCompressor.js";
import { useGraphs } from "../hooks/useGraphs.js";
import { msg } from "../i18n.js";
import { Header } from "./Header.js";
import { SpeedCard } from "./SpeedCard.js";
import { LiveSyncCard } from "./LiveSyncCard.js";
import { AutoSlowCard } from "./AutoSlowCard.js";
import { AudioCard } from "./AudioCard.js";

export function App() {
  const tab = useActiveTab();
  const send = useTabMessaging(tab?.tabId ?? null);
  const speed = useSpeed(tab, send);
  const sync = useLiveSync(tab, send);
  const autoSlow = useAutoSlow(tab, send);
  const audio = useAudioCompressor();
  const [translating, setTranslating] = useState(false);
  useGraphs(tab?.tabId ?? null, setTranslating);

  return (
    <>
      <Header />
      <div className="popup-grid">
        <div className="group-label">
          <span>{msg("groupVideo") || "Video"}</span>
        </div>
        <SpeedCard speed={speed} domain={tab?.domain ?? ""} />
        <LiveSyncCard sync={sync} live={speed.live} />

        <div className="group-label">
          <span>{msg("groupAudio") || "Audio"}</span>
        </div>
        <AutoSlowCard autoSlow={autoSlow} live={speed.live} />
        <AudioCard audio={audio} translating={translating} />
      </div>
    </>
  );
}
