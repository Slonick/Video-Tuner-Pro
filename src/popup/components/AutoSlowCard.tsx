// Auto-slow card (audio group). Mirrors the live-sync card: an enable toggle, the
// live speech graph, and an always-visible target-rate row (steppers + slider).
// The target previews live; Save commits the {enable, target} bundle to the chosen
// scope (channel > site > global), Reset clears it. The expanded body also holds the
// global response knobs (Slowest speed + Soft knee + Reaction; Hold / Ease-back stay
// options-only).
import { useEffect, useRef } from "react";
import { msg } from "../i18n.js";
import { Switch } from "../../ui/Switch.js";
import { SliderRow } from "./SliderRow.js";
import { ParamSlider } from "./ParamSlider.js";
import { InfoTip } from "./InfoTip.js";
import { SaveScope } from "./SaveScope.js";
import { Button } from "../../ui/Button.js";
import { useCardOverlay } from "../hooks/useCardOverlay.js";
import { useAutoSlowKnobs } from "../hooks/useAutoSlowKnobs.js";
import type { UseAutoSlow } from "../hooks/useAutoSlow.js";

interface Props {
  autoSlow: UseAutoSlow;
  // On a live stream auto-slow yields to live-sync and never touches the rate
  // (see content/audio/autoslow.ts), so the card locks like the manual-speed one.
  live: boolean;
  // No audio capture (a conflicting extension owns it) → the feature can't run, so the
  // card locks like the live case. The "why" is shown once on the Audio group label.
  blocked: boolean;
  // The walkthrough drives the card open/closed (undefined = the user controls it).
  forceOpen?: boolean;
}

export function AutoSlowCard({ autoSlow: a, live, blocked, forceOpen }: Props) {
  const slotRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const k = useAutoSlowKnobs();
  // Openable even when off — the target rate + knobs are still worth configuring;
  // only a locked card (live stream / no audio access) can't be.
  const { open, toggle, setOpen } = useCardOverlay(sectionRef, slotRef, !live && !blocked);
  useEffect(() => {
    if (forceOpen !== undefined) setOpen(forceOpen);
  }, [forceOpen, setOpen]);

  return (
    <div ref={slotRef} className="card-slot">
      <div
        ref={sectionRef}
        className={
          "sync-section autoslow-section overlay-card" +
          (open ? " is-overlay" : "") +
          (live ? " locked" : "") +
          (blocked ? " is-disabled" : "")
        }
      >
        <div className="sec-head">
          <Button className="sec-main" aria-expanded={open} onClick={toggle}>
            <span className="sec-text">
              <span className="sec-title-row">
                <strong>{msg("autoSlowLabel") || "Auto-slow dense speech"}</strong>
                <InfoTip beta tip={msg("betaNote")} />
                <InfoTip tip={msg("autoSlowHint")} />
              </span>
              <span className="switch-sub">
                {msg("autoSlowSubtitle") || "Ease off when speech gets too fast"}
              </span>
            </span>
          </Button>
          {live && (
            <InfoTip warn id="autoSlowLiveWarn" label="Live stream" tip={msg("autoSlowLiveNote")} />
          )}
          <Switch id="autoSlowToggle" beta checked={a.enabled} onChange={a.setEnabled} />
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
          <canvas
            id="autoSlowMeter"
            role="img"
            aria-label={msg("a11yAutoSlowMeter") || "Live playback speed graph"}
          ></canvas>
        </div>

        <div className="card-scroll">
          <div className="sync-delay-row">
            <span>{msg("autoSlowTargetLabel") || "Target rate"}</span>
          </div>
          <SliderRow
            sliderId="autoSlowTarget"
            min={3}
            max={12}
            step={0.5}
            value={a.target}
            ariaLabel={msg("meterTarget") || "Target rate"}
            ariaValueText={`${a.target.toFixed(1)} /s`}
            onChange={(v) => a.setTarget(v)}
            onDown={() => a.nudge(-0.5)}
            downId="autoSlowDown"
            downLabel="Lower target"
            onUp={() => a.nudge(0.5)}
            upId="autoSlowUp"
            upLabel="Raise target"
            onReset={a.resetManual}
            resetId="autoSlowReset"
            resetTitle={msg("tipResetTarget")}
            valueText={
              <>
                <b>{a.target.toFixed(1)}</b> /s
              </>
            }
          />

          <div className={"sync-body" + (open ? " open" : "")} id="autoSlowBody">
            <div className="quick-actions">
              <SaveScope
                scope={a.scope}
                saved={a.saved}
                savedValues={a.savedValues}
                currentValue={{ target: a.target }}
                fmtValue={(v) => `${(v as { target: number }).target.toFixed(1)} /s`}
                hasChannel={!!a.channel}
                saveLabel={msg("rememberButton")}
                savedLabel={msg("savedFeedback")}
                onSave={a.save}
                onReset={a.resetScope}
                onPick={a.pickScope}
                saveId="autoSlowSetBtn"
                resetId="autoSlowResetBtn"
              />
            </div>
            {/* Global response knobs (apply everywhere) — the target above is per-site. */}
            <div className="list-group">
              <ParamSlider
                id="asFloor"
                valId="asFloorVal"
                label={msg("optAutoSlowFloor") || "Slowest speed"}
                desc={msg("optAutoSlowFloorHint") || ""}
                min={50}
                max={100}
                step={5}
                value={k.floor}
                animate={false}
                fmt={(v) => Math.round(v) + "%"}
                onChange={k.setFloor}
              />
              <ParamSlider
                id="asKnee"
                valId="asKneeVal"
                label={msg("optAutoSlowKnee") || "Soft knee"}
                desc={msg("optAutoSlowKneeHint") || ""}
                min={0}
                max={2}
                step={0.1}
                tickStep={0.5}
                value={k.knee}
                animate={false}
                fmt={(v) => "±" + v.toFixed(1) + " /s"}
                onChange={k.setKnee}
              />
              <ParamSlider
                id="asReaction"
                valId="asReactionVal"
                label={msg("optAutoSlowReaction") || "Reaction"}
                desc={msg("optAutoSlowReactionHint") || ""}
                min={0}
                max={100}
                step={5}
                value={k.reaction}
                animate={false}
                fmt={(v) => Math.round(v) + "%"}
                onChange={k.setReaction}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
