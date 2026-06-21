// Popup root: resolve the active tab, wire the per-card hooks, drive the canvas
// meters, and render the cards (with the first-open walkthrough on top).
import { useCallback, useEffect, useState } from "react";
import { useActiveTab, useTabMessaging } from "../hooks/tab.js";
import { useSpeed } from "../hooks/useSpeed.js";
import { useLiveSync } from "../hooks/useLiveSync.js";
import { useAutoSlow } from "../hooks/useAutoSlow.js";
import { useAudioCompressor } from "../hooks/useAudioCompressor.js";
import { useGraphs } from "../hooks/useGraphs.js";
import { STORE } from "../platform/storage.js";
import { msg } from "../i18n.js";
import { GlassBackdrop } from "../../ui/GlassBackdrop.js";
import { Tooltip } from "../../ui/Tooltip.js";
import {
  ensureGlassFilter,
  applyGlassOpacity,
  clampGlassOpacity,
  GLASS_OPACITY_KEY,
} from "../../shared/glass.js";
import { Header } from "./Header.js";
import { SpeedCard } from "./SpeedCard.js";
import { LiveSyncCard } from "./LiveSyncCard.js";
import { AutoSlowCard } from "./AutoSlowCard.js";
import { AudioCard } from "./AudioCard.js";
import { GuideTour } from "./GuideTour.js";

export function App() {
  const tab = useActiveTab();
  const send = useTabMessaging(tab?.tabId ?? null);
  const speed = useSpeed(tab, send);
  const sync = useLiveSync(tab, send);
  const autoSlow = useAutoSlow(tab, send);
  const audio = useAudioCompressor();
  const [translating, setTranslating] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState<string | null>(null);
  useGraphs(tab?.tabId ?? null, setTranslating, setAudioBlocked);
  useEffect(() => ensureGlassFilter(document), []);
  useEffect(() => {
    STORE.get([GLASS_OPACITY_KEY], (r) =>
      applyGlassOpacity(document.documentElement, clampGlassOpacity(r[GLASS_OPACITY_KEY])),
    );
  }, []);

  // First-open walkthrough: show it once, the first time the popup opens, then
  // remember it's been seen.
  const [showTour, setShowTour] = useState(false);
  useEffect(() => {
    STORE.get(["popupGuideSeen"], (r) => setShowTour(r.popupGuideSeen !== true));
  }, []);
  const closeTour = useCallback(() => {
    setShowTour(false);
    STORE.set({ popupGuideSeen: true });
  }, []);
  const [tourCard, setTourCard] = useState<number | null>(null);
  const onExpand = useCallback((card: number | null) => setTourCard(card), []);
  // Drive each card open/closed from the tour; undefined hands control back to the
  // user once the tour is gone. Slot order is Speed, Live-sync, Auto-slow, Audio.
  const forceOpen = (n: number): boolean | undefined => (showTour ? tourCard === n : undefined);

  // While the tour is up, present every card unlocked regardless of the page —
  // each card gets the stream/translation value that keeps it active. (Speed and
  // Auto-slow lock ON a stream; Live-sync locks OFF one; Audio locks on a VO.)
  const speedLive = showTour ? false : speed.live;
  const syncLive = showTour ? true : speed.live;
  const audioTranslating = showTour ? false : translating;
  // No-audio (capture failed) locks BOTH audio cards — but not while the tour wants
  // them open. The reason picks a specific, plain-language tooltip.
  const audioBlk = showTour ? null : audioBlocked;
  const blockTip =
    audioBlk === "cors"
      ? msg("audioBlockCors")
      : audioBlk === "noctx"
        ? msg("audioBlockNoctx")
        : msg("audioBlockInuse");

  return (
    <>
      <GlassBackdrop />
      <Header />
      <div className="popup-grid">
        <div className="group-label">
          <span>{msg("groupVideo") || "Video"}</span>
        </div>
        <SpeedCard
          speed={speed}
          domain={tab?.domain ?? ""}
          live={speedLive}
          forceOpen={forceOpen(0)}
        />
        <LiveSyncCard sync={sync} live={syncLive} forceOpen={forceOpen(1)} />

        <div className={"group-label" + (audioBlk ? " has-warn" : "")}>
          <span>{msg("groupAudio") || "Audio"}</span>
          {audioBlk && (
            <Tooltip
              side="bottom"
              content={
                <>
                  <b>{msg("audioNoAccess") || "No audio access"}</b>
                  <br />
                  {blockTip}
                </>
              }
              trigger={
                <span
                  className="group-warn"
                  role="status"
                  tabIndex={0}
                  aria-label={msg("audioNoAccess") || "No audio access"}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 1.6 15 14H1z" fill="currentColor" />
                    <path
                      d="M8 6v3.4M8 11.4v.1"
                      stroke="var(--surface)"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              }
            />
          )}
        </div>
        <AutoSlowCard
          autoSlow={autoSlow}
          live={speedLive}
          blocked={!!audioBlk}
          forceOpen={forceOpen(2)}
        />
        <AudioCard
          audio={audio}
          translating={audioTranslating}
          blocked={!!audioBlk}
          forceOpen={forceOpen(3)}
        />
      </div>
      {showTour && <GuideTour onClose={closeTour} onExpand={onExpand} />}
    </>
  );
}
