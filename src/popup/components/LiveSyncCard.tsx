// Live-sync card. State/behaviour from useLiveSync; the allowed-delay slider +
// readout are plain controlled state (no tween). The buffer canvas (#bufferMeter)
// is driven by useGraphs at the app level.
import { useEffect, useRef, useState } from "react";
import { STORE } from "../platform/storage.js";
import { msg } from "../i18n.js";
import { Switch } from "../../ui/Switch.js";
import { InfoTip } from "./InfoTip.js";
import { ScopeSegment } from "./ScopeSegment.js";
import { MinusIcon, PlusIcon, ResetIcon } from "../icons.js";
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
  const [flash, setFlash] = useState(false);

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

  const onSave = () => {
    ls.save();
    setFlash(true);
    setTimeout(() => setFlash(false), 1500);
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
          <button type="button" className="sec-main" aria-expanded={open} onClick={toggle}>
            <span className="sec-text">
              <span className="sec-title-row">
                <strong>{msg("syncTitle")}</strong>
                <InfoTip tip={msg("syncHint")} />
              </span>
              <span className="switch-sub">{msg("syncSubtitle")}</span>
            </span>
          </button>
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
          <canvas id="bufferMeter"></canvas>
        </div>

        <div className="card-scroll">
          <div className="sync-delay-row">
            <span>{msg("allowedDelay")}</span>
            <div className="speed-quick">
              <button
                type="button"
                className="spin"
                id="syncDown"
                aria-label="Shorter"
                title="−1 s"
                onClick={() => ls.nudge(-1)}
              >
                <MinusIcon />
              </button>
              <span className="sync-val">
                <b id="syncTargetVal">{ls.target}</b> <span>{msg("secondsShort")}</span>
              </span>
              <button
                type="button"
                className="spin"
                id="syncUp"
                aria-label="Longer"
                title="+1 s"
                onClick={() => ls.nudge(1)}
              >
                <PlusIcon />
              </button>
              <span className="speed-quick-div" aria-hidden="true"></span>
              <button
                type="button"
                className="spin"
                id="syncReset"
                aria-label="Reset"
                title={msg("tipResetTarget")}
                onClick={ls.resetManual}
              >
                <ResetIcon />
              </button>
            </div>
          </div>
          <input
            type="range"
            className="speed-slider"
            id="syncTarget"
            min="1"
            max="30"
            step="1"
            value={ls.target}
            onInput={(e) => ls.previewTarget(Number((e.target as HTMLInputElement).value))}
            onChange={(e) => ls.previewTarget(Number(e.target.value))}
          />

          <div className={"sync-body" + (open ? " open" : "")} id="syncBody">
            <div className="quick-actions">
              <fieldset className="scope-group">
                <legend>{msg("scopeLabel")}</legend>
                <ScopeSegment
                  name="syncScope"
                  ariaLabel="Save allowed delay"
                  scope={ls.scope}
                  saved={ls.saved}
                  hasChannel={!!ls.channel}
                  open={open}
                  onPick={ls.pickScope}
                />
              </fieldset>
              <div className="action-row">
                <button className="btn-action btn-reset" id="syncResetBtn" onClick={ls.resetScope}>
                  {msg("resetButton")}
                </button>
                <button
                  className="btn-action btn-default"
                  id="syncSetBtn"
                  style={flash ? { background: "#4caf50" } : undefined}
                  onClick={onSave}
                >
                  {flash ? msg("savedFeedback") : msg("rememberButton")}
                </button>
              </div>
            </div>

            <div className="extra-row">
              <span>{msg("onStreamLabel")}</span>
              <StoredToggle id="onStreamToggle" storageKey="streamBadge" defaultOn />
            </div>

            {/* Super theater for streams — its own setting (superTheaterStream),
                independent of the Speed card's video one, so theater can be on for
                videos but off on streams (where you may want the chat visible). */}
            <div className="extra-row">
              <span className="extra-label">
                <span>{msg("superTheaterLabel")}</span>
                <InfoTip below tip={msg("superTheaterHint")} />
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
  );
}
