// Speed card. State/behaviour come from useSpeed; this renders the markup (same
// classes/ids the CSS keys off) and drives the two imperative bits via refs: the
// readout/slider tween (React can't animate a range thumb) and the preset-grid
// FLIP on expand. The readout has no JSX text child so a re-render can't clobber
// the tweened value.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { tweenNumber } from "../core/tween-number.js";
import { tweenSlider } from "../core/tween-slider.js";
import { msg } from "../i18n.js";
import { StoredToggle } from "./StoredToggle.js";
import { InfoTip } from "./InfoTip.js";
import { ScopeSegment } from "./ScopeSegment.js";
import { PresetGrid } from "./PresetGrid.js";
import { MinusIcon, PlusIcon, ResetIcon, WarnIcon, ChevronIcon } from "../icons.js";
import { useExpand } from "../hooks/useExpand.js";
import type { UseSpeed } from "../hooks/useSpeed.js";

interface Props {
  speed: UseSpeed;
  domain: string;
}

export function SpeedCard({ speed: s, domain }: Props) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const { open, toggle, bodyRef, onBodyTransitionEnd } = useExpand(sectionRef, gridRef);

  const [flash, setFlash] = useState(false);

  // Glide the readout + thumb to the new speed (or snap it). No JSX text child on
  // the readout — this owns it.
  useLayoutEffect(() => {
    const slider = sliderRef.current;
    const readout = readoutRef.current;
    if (!slider || !readout) return;
    const percent = Math.round(s.speed.v * 100);
    const target = Math.min(300, Math.max(25, percent));
    if (s.speed.animate) {
      const from = parseInt(readout.textContent || "", 10) || percent;
      tweenNumber(readout, from, percent, (v) => Math.round(v) + "%");
      tweenSlider(slider, target);
    } else {
      slider.value = String(target);
      readout.textContent = percent + "%";
    }
  }, [s.speed]);

  // Slider input previews continuously (debounced send); release applies at once.
  // Native listeners (not React's conflated onChange) keep input vs change distinct.
  const { sliderInput, sliderCommit } = s;
  useEffect(() => {
    const el = sliderRef.current;
    if (!el) return;
    const onInput = () => sliderInput(parseFloat(el.value));
    const onChange = () => sliderCommit(parseFloat(el.value));
    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("change", onChange);
    };
  }, [sliderInput, sliderCommit]);

  const onSave = () => {
    s.save();
    setFlash(true);
    setTimeout(() => setFlash(false), 1500);
  };

  const percent = Math.round(s.speed.v * 100);

  return (
    <div
      ref={sectionRef}
      className={
        "sync-section speed-section" +
        (s.live ? " locked" : "") +
        (s.isYouTube ? " is-youtube" : "")
      }
    >
      <div className="sec-head">
        <button type="button" className="sec-main" aria-expanded={open} onClick={toggle}>
          <span className="sec-text">
            <strong className="current-domain" id="currentDomain">
              {domain || "—"}
            </strong>
            <span className="switch-sub" id="speedScope">
              {s.channel && s.channelName ? s.channelName : msg("speedScopeSite")}
            </span>
          </span>
          <span
            className="info warn"
            id="liveWarn"
            aria-label="Live"
            style={{ display: s.live ? "inline-flex" : "none" }}
          >
            <WarnIcon />
          </span>
        </button>
        <div className="speed-quick">
          <button
            type="button"
            className="spin"
            id="speedDown"
            aria-label="Slower"
            title={msg("tipSlower")}
            onClick={() => s.nudge(-0.05)}
          >
            <MinusIcon />
          </button>
          <span ref={readoutRef} className="speed-pct" id="currentSpeedPct" />
          <button
            type="button"
            className="spin"
            id="speedUp"
            aria-label="Faster"
            title={msg("tipFaster")}
            onClick={() => s.nudge(0.05)}
          >
            <PlusIcon />
          </button>
          <span className="speed-quick-div" aria-hidden="true"></span>
          <button
            type="button"
            className="spin"
            id="speedReset"
            aria-label="Reset"
            title={msg("tipResetSpeed")}
            onClick={s.resetManual}
          >
            <ResetIcon />
          </button>
        </div>
        <span className="tip live-note">{msg("liveNote")}</span>
      </div>

      <input
        ref={sliderRef}
        type="range"
        className="speed-slider"
        id="speedSlider"
        min="25"
        max="300"
        step="5"
        defaultValue="100"
      />

      <PresetGrid
        presets={s.presets}
        activePercent={percent}
        gridRef={gridRef}
        onPick={s.setSpeed}
      />

      <div className="quick-actions">
        <fieldset className="scope-group">
          <legend>{msg("scopeLabel")}</legend>
          <ScopeSegment
            name="scope"
            ariaLabel="Save scope"
            scope={s.scope}
            saved={s.saved}
            hasChannel={!!s.channel}
            onPick={s.pickScope}
          />
        </fieldset>
        <div className="action-row">
          <button className="btn-action btn-reset" id="resetBtn" onClick={s.resetScope}>
            {msg("resetButton")}
          </button>
          <button
            className="btn-action btn-default"
            id="setDefaultBtn"
            style={flash ? { background: "#4caf50" } : undefined}
            onClick={onSave}
          >
            {flash ? msg("savedFeedback") : msg("rememberButton")}
          </button>
        </div>
      </div>

      <div
        ref={bodyRef}
        className={"sync-body speed-body" + (open ? " open" : "")}
        id="speedBody"
        onTransitionEnd={onBodyTransitionEnd}
      >
        <div className="extra-row">
          <span>{msg("onVideoLabel")}</span>
          <StoredToggle id="onVideoToggle" storageKey="showRemaining" defaultOn />
        </div>

        <div className="extra-row" id="superTheaterRow">
          <span className="extra-label">
            <span>{msg("superTheaterLabel")}</span>
            <InfoTip below tip={msg("superTheaterHint")} />
          </span>
          <StoredToggle id="superTheaterToggle" storageKey="superTheater" defaultOn={false} />
        </div>

        <div className="extra-row">
          <span className="extra-label">
            <span>{msg("kbdLabel")}</span>
            <InfoTip below>
              <span className="tip kbd-tip">
                <span className="kbd-g">
                  <kbd>A</kbd>
                  <span>{msg("kbdSlower")}</span>
                  <span className="amt">−5%</span>
                </span>
                <span className="kbd-g">
                  <kbd>⇧</kbd>
                  <kbd>A</kbd>
                  <span className="amt">−10%</span>
                </span>
                <span className="kbd-g">
                  <kbd>D</kbd>
                  <span>{msg("kbdFaster")}</span>
                  <span className="amt">+5%</span>
                </span>
                <span className="kbd-g">
                  <kbd>⇧</kbd>
                  <kbd>D</kbd>
                  <span className="amt">+10%</span>
                </span>
                <span className="kbd-g">
                  <kbd>R</kbd>
                  <span>{msg("kbdReset")}</span>
                </span>
              </span>
            </InfoTip>
          </span>
          <StoredToggle id="kbdToggle" storageKey="keyboard" defaultOn />
        </div>

        <div className="extra-row">
          <span className="extra-label">
            <span>{msg("audioSpeedLabel")}</span>
            <InfoTip below tip={msg("audioSpeedHint")} />
          </span>
          <StoredToggle id="audioSpeedToggle" storageKey="audioSpeed" defaultOn={false} />
        </div>

        <div className="extra-row">
          <span className="extra-label">
            <span>{msg("forceRateLabel")}</span>
            <InfoTip below tip={msg("forceRateHint")} />
          </span>
          <StoredToggle id="forceRateToggle" storageKey="forceRate" defaultOn={false} />
        </div>
      </div>

      <div className="expand-hint" aria-hidden="true" onClick={toggle}>
        <ChevronIcon />
      </div>
    </div>
  );
}
