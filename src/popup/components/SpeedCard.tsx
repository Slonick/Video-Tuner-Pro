// Speed card. State/behaviour come from useSpeed; this renders the markup (same
// classes/ids the CSS keys off) and drives the readout/slider tween via refs
// (React can't animate a range thumb). The readout has no JSX text child so a
// re-render can't clobber the tweened value.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { tweenNumber } from "../core/tween-number.js";
import { SliderRow } from "./SliderRow.js";
import { msg } from "../i18n.js";
import { StoredToggle } from "./StoredToggle.js";
import { InfoTip } from "./InfoTip.js";
import { SaveScope } from "./SaveScope.js";
import { PresetGrid } from "./PresetGrid.js";
import { WarnIcon } from "../icons.js";
import { Button } from "../../ui/Button.js";
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
  // Locked on a live stream (manual speed isn't applied), so it doesn't expand
  // there either — Super theater moves to the Live-sync card, which is active then.
  const { open, toggle, setOpen } = useCardOverlay(sectionRef, slotRef, !live);
  useEffect(() => {
    if (forceOpen !== undefined) setOpen(forceOpen);
  }, [forceOpen, setOpen]);

  // The shortcut hints read the live keymap so they reflect any remaps.
  const [keymap, setKeymap] = useState(DEFAULT_KEYMAP);
  useEffect(() => {
    STORE.get(["keymap"], (r) => setKeymap(normalizeKeymap(r.keymap)));
  }, []);

  // Glide the readout to the new speed (or snap it). No JSX text child on the
  // readout — this owns it. The thumb glide lives in the Slider wrapper.
  useLayoutEffect(() => {
    const readout = readoutRef.current;
    if (!readout) return;
    const percent = Math.round(s.speed.v * 100);
    if (s.speed.animate) {
      const from = parseInt(readout.textContent || "", 10) || percent;
      tweenNumber(readout, from, percent, (v) => Math.round(v) + "%");
    } else {
      readout.textContent = percent + "%";
    }
  }, [s.speed]);

  const percent = Math.round(s.speed.v * 100);
  const target = Math.min(s.speedMax, Math.max(25, percent));
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
          <Button className="sec-main" aria-expanded={open} onClick={toggle}>
            <span className="sec-text">
              <strong className="current-domain" id="currentDomain">
                {domain || "—"}
              </strong>
              <span className="switch-sub" id="speedScope">
                {s.channel && s.channelName ? s.channelName : msg("speedScopeSite")}
              </span>
            </span>
          </Button>
          {/* Pinned to the right edge (like the other cards' warnings), outside the
              expand button so it toggles the live note, not the card. */}
          <span
            className="info warn"
            id="liveWarn"
            aria-label="Live"
            tabIndex={0}
            style={{ display: live ? "inline-flex" : "none" }}
          >
            <WarnIcon />
          </span>
          <span className="tip live-note">{msg("liveNote")}</span>
        </div>

        <div className="card-scroll">
          <SliderRow
            sliderId="speedSlider"
            min={25}
            max={s.speedMax}
            step={5}
            tickStep={50}
            value={target}
            animate={s.speed.animate}
            ariaLabel={msg("meterSpeed") || "Speed"}
            ariaValueText={Math.round(target * 100) + "%"}
            onChange={s.sliderInput}
            onCommit={s.sliderCommit}
            onDown={() => s.nudge(-s.speedStep)}
            downId="speedDown"
            downLabel="Slower"
            downTitle={msg("tipSlower")}
            onUp={() => s.nudge(s.speedStep)}
            upId="speedUp"
            upLabel="Faster"
            upTitle={msg("tipFaster")}
            onReset={s.resetManual}
            resetId="speedReset"
            resetTitle={msg("tipResetSpeed")}
            readoutRef={readoutRef}
            readoutId="currentSpeedPct"
          />

          <PresetGrid
            presets={s.presets}
            presetKeys={s.presetKeys}
            pinned={s.pinned}
            activePercent={percent}
            onPick={s.setSpeed}
          />

          <div className="quick-actions">
            <SaveScope
              scope={s.scope}
              saved={s.saved}
              savedValues={s.savedValues}
              currentValue={s.speed.v}
              fmtValue={(v) => Math.round((v as number) * 100) + "%"}
              hasChannel={!!s.channel}
              saveLabel={msg("rememberButton")}
              savedLabel={msg("savedFeedback")}
              onSave={s.save}
              onReset={s.resetScope}
              onPick={s.pickScope}
              saveId="setDefaultBtn"
              resetId="resetBtn"
            />
          </div>

          <div className={"sync-body speed-body" + (open ? " open" : "")} id="speedBody">
            <div className="list-group">
              <div className="extra-row">
                <span>{msg("onVideoLabel")}</span>
                <StoredToggle id="onVideoToggle" storageKey="showRemaining" defaultOn />
              </div>

              <div className="extra-row" id="superTheaterRow">
                <span className="extra-text">
                  <span>{msg("superTheaterLabel")}</span>
                  <span className="extra-sub">{msg("superTheaterHint")}</span>
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
                    <span className="kbd-g">
                      <kbd>{codeLabel(keymap.overlay)}</kbd>
                      <span>{msg("kbdOverlay")}</span>
                    </span>
                  </InfoTip>
                </span>
                <StoredToggle id="kbdToggle" storageKey="keyboard" defaultOn />
              </div>

              <div className="extra-row">
                <span className="extra-text">
                  <span>{msg("audioSpeedLabel")}</span>
                  <span className="extra-sub">{msg("audioSpeedHint")}</span>
                </span>
                <StoredToggle id="audioSpeedToggle" storageKey="audioSpeed" defaultOn={false} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
