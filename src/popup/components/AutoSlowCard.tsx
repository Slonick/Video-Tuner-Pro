// Auto-slow card (audio group). Mirrors the live-sync card: an enable toggle, the
// live speech graph, and an always-visible target-rate row (steppers + slider).
// The target previews live; Save commits the {enable, target} bundle to the chosen
// scope (channel > site > global), Reset clears it. Dynamics live in options.
import { useEffect, useRef, useState } from "react";
import { msg } from "../i18n.js";
import { Switch } from "../../ui/Switch.js";
import { InfoTip } from "./InfoTip.js";
import { ScopeSegment } from "./ScopeSegment.js";
import { MinusIcon, PlusIcon, ResetIcon } from "../icons.js";
import { useCardOverlay } from "../hooks/useCardOverlay.js";
import type { UseAutoSlow } from "../hooks/useAutoSlow.js";

interface Props {
  autoSlow: UseAutoSlow;
  // On a live stream auto-slow yields to live-sync and never touches the rate
  // (see content/audio/autoslow.ts), so the card locks like the manual-speed one.
  live: boolean;
  // The walkthrough drives the card open/closed (undefined = the user controls it).
  forceOpen?: boolean;
}

export function AutoSlowCard({ autoSlow: a, live, forceOpen }: Props) {
  const slotRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const { open, toggle, setOpen } = useCardOverlay(sectionRef, slotRef, a.enabled && !live);
  useEffect(() => {
    if (forceOpen !== undefined) setOpen(forceOpen);
  }, [forceOpen, setOpen]);
  const [flash, setFlash] = useState(false);

  const onSave = () => {
    a.save();
    setFlash(true);
    setTimeout(() => setFlash(false), 1500);
  };

  return (
    <div ref={slotRef} className="card-slot">
      <div
        ref={sectionRef}
        className={
          "sync-section autoslow-section overlay-card" +
          (open ? " is-overlay" : "") +
          (live ? " locked" : "")
        }
      >
        <span className="beta-badge">beta</span>
        <div className="sec-head">
          <button type="button" className="sec-main" aria-expanded={open} onClick={toggle}>
            <span className="sec-text">
              <span className="sec-title-row">
                <strong>{msg("autoSlowLabel") || "Auto-slow dense speech"}</strong>
                <InfoTip tip={msg("autoSlowHint")} />
              </span>
              <span className="switch-sub">
                {msg("autoSlowSubtitle") || "Ease off when speech gets too fast"}
              </span>
            </span>
          </button>
          {live && (
            <InfoTip warn id="autoSlowLiveWarn" label="Live stream" tip={msg("autoSlowLiveNote")} />
          )}
          <Switch id="autoSlowToggle" checked={a.enabled} onChange={a.setEnabled} />
        </div>

        <div className="meter autoslow always">
          <div className="meter-legend">
            <span>
              <i className="dot dot-out"></i>
              <span>{msg("meterRate") || "speech rate"}</span>
            </span>
            <span>
              <i className="dot dot-in"></i>
              <span>{msg("meterSpeed") || "speed"}</span>
            </span>
            <span className="meter-thr">
              <i className="dot dot-target"></i>
              <span>{msg("meterTarget") || "target"}</span>
            </span>
          </div>
          <canvas id="autoSlowMeter"></canvas>
        </div>

        <div className="card-scroll">
          <div className="sync-delay-row">
            <span>{msg("autoSlowTargetLabel") || "Target rate"}</span>
            <div className="speed-quick">
              <button
                type="button"
                className="spin"
                id="autoSlowDown"
                aria-label="Lower target"
                onClick={() => a.nudge(-0.5)}
              >
                <MinusIcon />
              </button>
              <span className="sync-val">
                <b>{a.target.toFixed(1)}</b> <span>/s</span>
              </span>
              <button
                type="button"
                className="spin"
                id="autoSlowUp"
                aria-label="Raise target"
                onClick={() => a.nudge(0.5)}
              >
                <PlusIcon />
              </button>
              <span className="speed-quick-div" aria-hidden="true"></span>
              <button
                type="button"
                className="spin"
                id="autoSlowReset"
                aria-label="Reset"
                title={msg("tipResetTarget")}
                onClick={a.resetManual}
              >
                <ResetIcon />
              </button>
            </div>
          </div>
          <input
            type="range"
            className="speed-slider"
            id="autoSlowTarget"
            min="3"
            max="12"
            step="0.5"
            value={a.target}
            onInput={(e) => a.setTarget(Number((e.target as HTMLInputElement).value))}
            onChange={(e) => a.setTarget(Number(e.target.value))}
          />

          <div className={"sync-body" + (open ? " open" : "")} id="autoSlowBody">
            <div className="quick-actions">
              <fieldset className="scope-group">
                <legend>{msg("scopeLabel")}</legend>
                <ScopeSegment
                  name="autoScope"
                  ariaLabel="Auto-slow scope"
                  scope={a.scope}
                  saved={a.saved}
                  hasChannel={!!a.channel}
                  open={open}
                  onPick={a.pickScope}
                />
              </fieldset>
              <div className="action-row">
                <button
                  className="btn-action btn-reset"
                  id="autoSlowResetBtn"
                  onClick={a.resetScope}
                >
                  {msg("resetButton")}
                </button>
                <button
                  className="btn-action btn-default"
                  id="autoSlowSetBtn"
                  style={flash ? { background: "#4caf50" } : undefined}
                  onClick={onSave}
                >
                  {flash ? msg("savedFeedback") : msg("rememberButton")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
