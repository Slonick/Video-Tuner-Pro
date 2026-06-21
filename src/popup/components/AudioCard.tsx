// Audio compressor card. State/behaviour from useAudioCompressor; each parameter
// row is a self-contained ParamSlider (owns its thumb tween). The audio canvas
// (#audioMeter) is driven by useGraphs at the app level; `translating` (VOT active)
// locks the card.
import { useEffect, useRef } from "react";
import { STORE } from "../platform/storage.js";
import { msg } from "../i18n.js";
import { Switch } from "../../ui/Switch.js";
import { InfoTip } from "./InfoTip.js";
import { ParamSlider } from "./ParamSlider.js";
import { Button } from "../../ui/Button.js";
import { useCardOverlay } from "../hooks/useCardOverlay.js";
import type { UseAudioCompressor } from "../hooks/useAudioCompressor.js";
import { type CompParams, type CompPreset } from "../../shared/comp-presets.js";

const presetLabel = (p: CompPreset, i: number) =>
  p.name || (p.nameKey ? msg(p.nameKey) : msg("optCompPresetName", String(i + 1)));
const dB = (n: number) => n + " dB";

interface Row {
  key: keyof CompParams;
  label: string;
  valId: string;
  sliderId: string;
  min: number;
  max: number;
  step: number;
  tickStep: number;
  desc: string;
  fmt: (n: number) => string;
}

// Knee / attack / release live only on the options page now — the popup keeps the
// everyday controls (threshold, ratio, and the make-up gain slider below).
const ROWS: Row[] = [
  {
    key: "threshold",
    label: "audioThreshold",
    valId: "acThresholdVal",
    sliderId: "acThreshold",
    min: -100,
    max: 0,
    step: 1,
    tickStep: 20,
    desc: "audioThresholdDesc",
    fmt: dB,
  },
  {
    key: "ratio",
    label: "audioRatio",
    valId: "acRatioVal",
    sliderId: "acRatio",
    min: 1,
    max: 20,
    step: 0.5,
    tickStep: 5,
    desc: "audioRatioDesc",
    fmt: (n) => n + ":1",
  },
];

interface Props {
  audio: UseAudioCompressor;
  translating: boolean;
  // No audio capture (a conflicting extension owns it) → compression can't run, so the
  // card locks. The reason is shown once on the Audio group label.
  blocked: boolean;
  // The walkthrough drives the card open/closed (undefined = the user controls it).
  forceOpen?: boolean;
}

export function AudioCard({ audio: a, translating, blocked, forceOpen }: Props) {
  const slotRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  // Openable even when off — there are presets to view/edit; only a locked card
  // (VOT translation / no audio access) can't be configured.
  const { open, toggle, setOpen } = useCardOverlay(sectionRef, slotRef, !translating && !blocked);
  useEffect(() => {
    if (forceOpen !== undefined) setOpen(forceOpen);
  }, [forceOpen, setOpen]);

  // Same model as the speed presets: pinned presets (filled to 4 with the lowest
  // unpinned) form the collapsed quick row; the rest are "extra", revealed when
  // the card expands.
  // The pinned presets (up to COMP_QUICK_COUNT) form the collapsed quick row; the
  // rest are "extra", revealed when the card expands.
  const quick = new Set(a.presets.map((p, i) => (p.pin ? i : -1)).filter((i) => i >= 0));

  const onToggle = (on: boolean) => {
    a.setEnabled(on);
    if (!on) return;
    STORE.get(["audioSeen"], (r) => {
      if (r.audioSeen) return;
      setOpen(true);
      STORE.set({ audioSeen: true });
    });
  };

  return (
    <div ref={slotRef} className="card-slot">
      <div
        ref={sectionRef}
        className={
          "sync-section audio-section overlay-card" +
          (open ? " is-overlay" : "") +
          (translating ? " audio-locked" : "") +
          (blocked ? " is-disabled" : "")
        }
      >
        <div className="sec-head">
          <Button className="sec-main" aria-expanded={open} onClick={toggle}>
            <span className="sec-text">
              <span className="sec-title-row">
                <strong>{msg("audioTitle")}</strong>
                <InfoTip tip={msg("audioHint")} />
              </span>
              <span className="switch-sub">{msg("audioSubtitle")}</span>
            </span>
          </Button>
          {translating && (
            <InfoTip warn id="audioVotWarn" label="Translation active" tip={msg("audioVotNote")} />
          )}
          <Switch id="audioCompToggle" checked={a.enabled} onChange={onToggle} />
        </div>

        <div className="meter audio always">
          <div className="meter-legend">
            <span>
              <i className="dot dot-in"></i>
              <span>{msg("meterIn")}</span>
            </span>
            <span>
              <i className="dot dot-out"></i>
              <span>{msg("meterOut")}</span>
            </span>
            <span className="meter-thr">
              <i className="dot dot-thr"></i>
              <span>{msg("meterThr")}</span>
            </span>
          </div>
          <canvas
            id="audioMeter"
            role="img"
            aria-label={msg("a11yAudioMeter") || "Live audio compression meter"}
          ></canvas>
        </div>

        <div className="card-scroll">
          <div className="preset-block">
            {/* Columns track the pinned count so the quick row fills the width with no
            empty trailing cell; expanded, the extras wrap into these same columns. */}
            <div
              className="preset-grid"
              style={{ gridTemplateColumns: `repeat(${Math.max(1, quick.size)}, 1fr)` }}
            >
              {a.presets.map((p, i) => (
                <Button
                  key={i}
                  className={
                    "btn-preset" +
                    (quick.has(i) ? "" : " extra") +
                    (a.activePreset === i ? " active" : "")
                  }
                  data-preset={i}
                  onClick={() => a.applyPreset(i)}
                >
                  {presetLabel(p, i)}
                </Button>
              ))}
            </div>
          </div>

          <div className={"sync-body" + (open ? " open" : "")} id="audioBody">
            {/* One grouped card, rows split by hairline dividers (Apple-list style) —
                not three separate boxes. */}
            <div className="list-group">
              {ROWS.map((row) => (
                <ParamSlider
                  key={row.key}
                  id={row.sliderId}
                  valId={row.valId}
                  label={msg(row.label)}
                  desc={msg(row.desc)}
                  min={row.min}
                  max={row.max}
                  step={row.step}
                  tickStep={row.tickStep}
                  value={a.comp.values[row.key]}
                  animate={a.comp.animate}
                  fmt={row.fmt}
                  onChange={(v) => a.setParam(row.key, v)}
                />
              ))}
              <ParamSlider
                id="acGain"
                valId="acGainVal"
                label={msg("audioGain")}
                desc={msg("audioGainDesc")}
                min={0}
                max={24}
                step={1}
                tickStep={6}
                value={a.gain}
                animate={false}
                fmt={dB}
                onChange={a.setGain}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
