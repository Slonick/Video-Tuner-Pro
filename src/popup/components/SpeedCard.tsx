// Speed card. State/behaviour come from useSpeed; this renders the markup (same
// classes/ids the CSS keys off) and drives the readout/slider tween via refs
// (React can't animate a range thumb). The readout has no JSX text child so a
// re-render can't clobber the tweened value.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { tweenNumber } from "../core/tween-number.js";
import { tweenSlider } from "../core/tween-slider.js";
import { msg } from "../i18n.js";
import { StoredToggle } from "./StoredToggle.js";
import { InfoTip } from "./InfoTip.js";
import { ScopeSegment } from "./ScopeSegment.js";
import { PresetGrid } from "./PresetGrid.js";
import { MinusIcon, PlusIcon, ResetIcon, WarnIcon } from "../icons.js";
import { useCardOverlay } from "../hooks/useCardOverlay.js";
import { STORE } from "../platform/storage.js";
import { codeLabel, normalizeKeymap, DEFAULT_KEYMAP } from "../../shared/keymap.js";
import type { UseSpeed } from "../hooks/useSpeed.js";

interface Props {
  speed: UseSpeed;
  domain: string;
  // Stream state, passed in so the walkthrough can present the card unlocked
  // regardless of the actual page (it mirrors speed.live otherwise).
  live: boolean;
  // The walkthrough drives the card open/closed (undefined = the user controls it).
  forceOpen?: boolean;
}

export function SpeedCard({ speed: s, domain, live, forceOpen }: Props) {
  const slotRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  // Locked on a live stream (manual speed isn't applied), so it doesn't expand
  // there either — Super theater moves to the Live-sync card, which is active then.
  const { open, toggle, setOpen } = useCardOverlay(sectionRef, slotRef, !live);
  useEffect(() => {
    if (forceOpen !== undefined) setOpen(forceOpen);
  }, [forceOpen, setOpen]);

  const [flash, setFlash] = useState(false);
  // The shortcut hints read the live keymap so they reflect any remaps.
  const [keymap, setKeymap] = useState(DEFAULT_KEYMAP);
  useEffect(() => {
    STORE.get(["keymap"], (r) => setKeymap(normalizeKeymap(r.keymap)));
  }, []);

  // Glide the readout + thumb to the new speed (or snap it). No JSX text child on
  // the readout — this owns it.
  useLayoutEffect(() => {
    const slider = sliderRef.current;
    const readout = readoutRef.current;
    if (!slider || !readout) return;
    const percent = Math.round(s.speed.v * 100);
    const target = Math.min(s.speedMax, Math.max(25, percent));
    if (s.speed.animate) {
      const from = parseInt(readout.textContent || "", 10) || percent;
      tweenNumber(readout, from, percent, (v) => Math.round(v) + "%");
      tweenSlider(slider, target);
    } else {
      slider.value = String(target);
      readout.textContent = percent + "%";
    }
  }, [s.speed, s.speedMax]);

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
  const stepPct = Math.round(s.speedStep * 100);

  return (
    <div ref={slotRef} className="card-slot">
      <div
        ref={sectionRef}
        className={
          "sync-section speed-section overlay-card" +
          (open ? " is-overlay" : "") +
          (live ? " locked" : "") +
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
              style={{ display: live ? "inline-flex" : "none" }}
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
              onClick={() => s.nudge(-s.speedStep)}
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
              onClick={() => s.nudge(s.speedStep)}
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

        <div className="card-scroll">
          <input
            ref={sliderRef}
            type="range"
            className="speed-slider"
            id="speedSlider"
            min="25"
            max={s.speedMax}
            step="5"
            defaultValue="100"
          />

          <PresetGrid
            presets={s.presets}
            presetKeys={s.presetKeys}
            pinned={s.pinned}
            activePercent={percent}
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
                open={open}
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

          <div className={"sync-body speed-body" + (open ? " open" : "")} id="speedBody">
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
                <InfoTip below className="kbd-tip">
                  <span className="kbd-g">
                    <kbd>{codeLabel(keymap.slower)}</kbd>
                    <span>{msg("kbdSlower")}</span>
                    <span className="amt">−{stepPct}%</span>
                  </span>
                  <span className="kbd-g">
                    <kbd>⇧</kbd>
                    <kbd>{codeLabel(keymap.slower)}</kbd>
                    <span className="amt">−{stepPct * 2}%</span>
                  </span>
                  <span className="kbd-g">
                    <kbd>{codeLabel(keymap.faster)}</kbd>
                    <span>{msg("kbdFaster")}</span>
                    <span className="amt">+{stepPct}%</span>
                  </span>
                  <span className="kbd-g">
                    <kbd>⇧</kbd>
                    <kbd>{codeLabel(keymap.faster)}</kbd>
                    <span className="amt">+{stepPct * 2}%</span>
                  </span>
                  <span className="kbd-g">
                    <kbd>{codeLabel(keymap.reset)}</kbd>
                    <span>{msg("kbdReset")}</span>
                  </span>
                  <span className="kbd-g">
                    <kbd>{codeLabel(keymap.toggle)}</kbd>
                    <span>{msg("kbdToggle")}</span>
                  </span>
                  <span className="kbd-g">
                    <kbd>{codeLabel(keymap.hold)}</kbd>
                    <span>{msg("kbdHold")}</span>
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
          </div>
        </div>
      </div>
    </div>
  );
}
