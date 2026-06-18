// Audio compressor card. State/behaviour from useAudioCompressor; each parameter
// row is a self-contained ParamSlider (owns its thumb tween). The audio canvas
// (#audioMeter) is driven by useGraphs at the app level; `translating` (VOT active)
// locks the card.
import { useLayoutEffect, useRef } from "react";
import { STORE } from "../platform/storage.js";
import { movePill } from "../core/seg-pill.js";
import { msg } from "../i18n.js";
import { Switch } from "../../ui/Switch.js";
import { InfoTip } from "./InfoTip.js";
import { ParamSlider } from "./ParamSlider.js";
import { WarnIcon, ChevronIcon } from "../icons.js";
import { useExpand } from "../hooks/useExpand.js";
import type { UseAudioCompressor } from "../hooks/useAudioCompressor.js";
import { PRESET_ORDER, type CompParams, type PresetName } from "../../shared/comp-presets.js";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const dB = (n: number) => n + " dB";
const ms = (n: number) => Math.round(n * 1000) + " ms";

interface Row {
  key: keyof CompParams;
  label: string;
  valId: string;
  sliderId: string;
  min: number;
  max: number;
  step: number;
  desc: string;
  fmt: (n: number) => string;
}

const ROWS: Row[] = [
  {
    key: "threshold",
    label: "audioThreshold",
    valId: "acThresholdVal",
    sliderId: "acThreshold",
    min: -100,
    max: 0,
    step: 1,
    desc: "audioThresholdDesc",
    fmt: dB,
  },
  {
    key: "knee",
    label: "audioKnee",
    valId: "acKneeVal",
    sliderId: "acKnee",
    min: 0,
    max: 40,
    step: 1,
    desc: "audioKneeDesc",
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
    desc: "audioRatioDesc",
    fmt: (n) => n + ":1",
  },
  {
    key: "attack",
    label: "audioAttack",
    valId: "acAttackVal",
    sliderId: "acAttack",
    min: 0,
    max: 1,
    step: 0.001,
    desc: "audioAttackDesc",
    fmt: ms,
  },
  {
    key: "release",
    label: "audioRelease",
    valId: "acReleaseVal",
    sliderId: "acRelease",
    min: 0,
    max: 1,
    step: 0.001,
    desc: "audioReleaseDesc",
    fmt: ms,
  },
];

interface Props {
  audio: UseAudioCompressor;
  translating: boolean;
}

export function AudioCard({ audio: a, translating }: Props) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const presetRowRef = useRef<HTMLDivElement>(null);
  const { open, toggle, setOpen, bodyRef, onBodyTransitionEnd } = useExpand(sectionRef);

  useLayoutEffect(() => {
    movePill(presetRowRef.current);
  }, [a.activePreset]);

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
    <div ref={sectionRef} className={"sync-section" + (translating ? " audio-locked" : "")}>
      <div className="sec-head">
        <button type="button" className="sec-main" aria-expanded={open} onClick={toggle}>
          <span className="sec-text">
            <span className="sec-title-row">
              <strong>{msg("audioTitle")}</strong>
              <InfoTip tip={msg("audioHint")} />
            </span>
            <span className="switch-sub">{msg("audioSubtitle")}</span>
          </span>
        </button>
        <span
          className="info warn"
          id="audioVotWarn"
          tabIndex={0}
          role="button"
          aria-label="Translation active"
          style={{ display: translating ? "inline-flex" : "none" }}
        >
          <WarnIcon />
          <span className="tip">{msg("audioVotNote")}</span>
        </span>
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
        <canvas id="audioMeter"></canvas>
      </div>

      <div className="preset-block">
        <div className="preset-row" ref={presetRowRef}>
          <span className="seg-pill" aria-hidden="true"></span>
          {PRESET_ORDER.map((name: PresetName) => (
            <button
              key={name}
              type="button"
              className={"btn-preset" + (a.activePreset === name ? " active" : "")}
              data-preset={name}
              onClick={() => a.applyPreset(name)}
            >
              {a.presets[name].name || msg("preset" + cap(name))}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={bodyRef}
        className={"sync-body" + (open ? " open" : "")}
        id="audioBody"
        onTransitionEnd={onBodyTransitionEnd}
      >
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
          value={a.gain}
          animate={false}
          fmt={dB}
          onChange={a.setGain}
        />
      </div>

      <div className="expand-hint" aria-hidden="true" onClick={toggle}>
        <ChevronIcon />
      </div>
    </div>
  );
}
