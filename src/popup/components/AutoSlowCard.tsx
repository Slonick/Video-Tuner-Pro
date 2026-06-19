// Auto-slow card (audio group). Mirrors the live-sync card: an enable toggle plus
// two scoped settings (sensitivity + slowest speed) saved per scope
// (channel > site > global). Toggle/sliders preview live; Save commits the bundle
// to the chosen scope, Reset clears it. Global response dynamics live in options.
import { useRef, useState } from "react";
import { msg } from "../i18n.js";
import { Switch } from "../../ui/Switch.js";
import { InfoTip } from "./InfoTip.js";
import { ScopeSegment } from "./ScopeSegment.js";
import { ChevronIcon } from "../icons.js";
import { useExpand } from "../hooks/useExpand.js";
import type { UseAutoSlow } from "../hooks/useAutoSlow.js";

interface Props {
  autoSlow: UseAutoSlow;
}

export function AutoSlowCard({ autoSlow: a }: Props) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { open, toggle, bodyRef, onBodyTransitionEnd } = useExpand(sectionRef);
  const [flash, setFlash] = useState(false);

  const onSave = () => {
    a.save();
    setFlash(true);
    setTimeout(() => setFlash(false), 1500);
  };

  return (
    <div ref={sectionRef} className="sync-section">
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

      <div
        ref={bodyRef}
        className={"sync-body" + (open ? " open" : "")}
        id="autoSlowBody"
        onTransitionEnd={onBodyTransitionEnd}
      >
        <div className="sync-delay-row">
          <span>{msg("autoSlowTargetLabel") || "Target rate"}</span>
          <span className="sync-val">
            <b>{a.target.toFixed(1)}</b> <span>/s</span>
          </span>
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

        <div className="quick-actions">
          <fieldset className="scope-group">
            <legend>{msg("scopeLabel")}</legend>
            <ScopeSegment
              name="autoScope"
              ariaLabel="Auto-slow scope"
              scope={a.scope}
              saved={a.saved}
              hasChannel={!!a.channel}
              onPick={a.pickScope}
            />
          </fieldset>
          <div className="action-row">
            <button className="btn-action btn-reset" id="autoSlowResetBtn" onClick={a.resetScope}>
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

      <div className="expand-hint" aria-hidden="true" onClick={toggle}>
        <ChevronIcon />
      </div>
    </div>
  );
}
