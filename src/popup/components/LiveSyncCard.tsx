// Live-sync card. State/behaviour from useLiveSync; the allowed-delay slider +
// readout are plain controlled state (no tween). The buffer canvas (#bufferMeter)
// is driven by useGraphs at the app level.
import { useEffect, useRef } from "react";
import { STORE } from "../platform/storage.js";
import { msg } from "../i18n.js";
import { Switch } from "../../ui/Switch.js";
import { SliderRow } from "./SliderRow.js";
import { InfoTip } from "./InfoTip.js";
import { SaveScope } from "./SaveScope.js";
import { Button } from "../../ui/Button.js";
import { useCardOverlay } from "../hooks/useCardOverlay.js";
import { StoredToggle } from "./StoredToggle.js";
import type { UseLiveSync } from "../hooks/useLiveSync.js";

interface Props {
  sync: UseLiveSync;
  // Live-sync only does anything on a live stream; off a stream the card has
  // nothing to do, so it locks (like Auto-slow locks on a stream — the mirror case).
  live: boolean;
  // The walkthrough drives the card open/closed (undefined = the user controls it).
  forceOpen?: boolean;
}

export function LiveSyncCard({ sync: ls, live, forceOpen }: Props) {
  const slotRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const { open, toggle, setOpen } = useCardOverlay(sectionRef, slotRef, ls.enabled && live);
  useEffect(() => {
    if (forceOpen !== undefined) setOpen(forceOpen);
  }, [forceOpen, setOpen]);

  // Auto-expand the first time live-sync is switched on, once ever.
  const onToggle = (on: boolean) => {
    ls.setEnabled(on);
    if (!on) return;
    STORE.get(["liveSyncSeen"], (r) => {
      if (r.liveSyncSeen) return;
      setOpen(true);
      STORE.set({ liveSyncSeen: true });
    });
  };

  return (
    <div ref={slotRef} className="card-slot">
      <div
        ref={sectionRef}
        className={
          "sync-section live-sync-section overlay-card" +
          (open ? " is-overlay" : "") +
          (live ? "" : " locked")
        }
      >
        <div className="sec-head">
          <Button className="sec-main" aria-expanded={open} onClick={toggle}>
            <span className="sec-text">
              <span className="sec-title-row">
                <strong>{msg("syncTitle")}</strong>
                <InfoTip tip={msg("syncHint")} />
              </span>
              <span className="switch-sub">{msg("syncSubtitle")}</span>
            </span>
          </Button>
          <Switch id="liveSyncToggle" checked={ls.enabled} onChange={onToggle} />
        </div>

        <div className="meter buffer always">
          <div className="meter-legend">
            <span>
              <i className="dot dot-buf"></i>
              <span>{msg("meterLatency")}</span>
            </span>
            <span>
              <i className="dot dot-ahead"></i>
              <span>{msg("meterBuffer")}</span>
            </span>
            <span className="meter-thr">
              <i className="dot dot-thr"></i>
              <span>{msg("meterTargetMark")}</span>
            </span>
          </div>
          <canvas
            id="bufferMeter"
            role="img"
            aria-label={msg("a11yBufferMeter") || "Live latency and buffer graph"}
          ></canvas>
        </div>

        <div className="card-scroll">
          <div className="sync-delay-row">
            <span>{msg("allowedDelay")}</span>
          </div>
          <SliderRow
            sliderId="syncTarget"
            min={1}
            max={30}
            step={1}
            value={ls.target}
            ariaLabel={msg("allowedDelay") || "Allowed delay"}
            ariaValueText={`${ls.target} ${msg("secondsShort")}`}
            onChange={(v) => ls.previewTarget(v)}
            onDown={() => ls.nudge(-1)}
            downId="syncDown"
            downLabel="Shorter"
            downTitle="−1 s"
            onUp={() => ls.nudge(1)}
            upId="syncUp"
            upLabel="Longer"
            upTitle="+1 s"
            onReset={ls.resetManual}
            resetId="syncReset"
            resetTitle={msg("tipResetTarget")}
            valueText={
              <>
                <b id="syncTargetVal">{ls.target}</b> {msg("secondsShort")}
              </>
            }
          />

          <div className={"sync-body" + (open ? " open" : "")} id="syncBody">
            <div className="quick-actions">
              <SaveScope
                scope={ls.scope}
                saved={ls.saved}
                savedValues={ls.savedValues}
                currentValue={ls.target}
                fmtValue={(v) => `${v as number} ${msg("secondsShort")}`}
                hasChannel={!!ls.channel}
                saveLabel={msg("rememberButton")}
                savedLabel={msg("savedFeedback")}
                onSave={ls.save}
                onReset={ls.resetScope}
                onPick={ls.pickScope}
                saveId="syncSetBtn"
                resetId="syncResetBtn"
              />
            </div>

            <div className="list-group">
              <div className="extra-row">
                <span>{msg("onStreamLabel")}</span>
                <StoredToggle id="onStreamToggle" storageKey="streamBadge" defaultOn />
              </div>

              {/* Super theater for streams — its own setting (superTheaterStream),
                independent of the Speed card's video one, so theater can be on for
                videos but off on streams (where you may want the chat visible). */}
              <div className="extra-row">
                <span className="extra-text">
                  <span>{msg("superTheaterLabel")}</span>
                  <span className="extra-sub">{msg("superTheaterHint")}</span>
                </span>
                <StoredToggle
                  id="superTheaterToggleStream"
                  storageKey="superTheaterStream"
                  defaultOn={false}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
