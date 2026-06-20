// Compressor preset editor: a variable-length list (1…COMP_MAX_PRESETS) of
// one-tap profiles. Each can be renamed, tuned with the same sliders as the
// popup, given an optional make-up-gain override, pinned (pinned ones — up to
// COMP_QUICK_COUNT — are the popup's buttons), removed, and new ones added.
// Persisted under "compPresets" as a list; the global make-up gain lives under
// "audioCompBaseGain" (the live value the content script applies is "audioCompGain").
// The popup reads both to label, show, and apply the buttons.
import { useEffect, useState } from "react";
import { STORE } from "../../shared/store.js";
import { msg } from "../../popup/i18n.js";
import { Switch } from "../../ui/Switch.js";
import { Slider } from "../../ui/Slider.js";
import {
  COMP_MIN_PRESETS,
  COMP_MAX_PRESETS,
  COMP_QUICK_COUNT,
  GAIN_MIN,
  GAIN_MAX,
  GAIN_STEP,
  GAIN_DEFAULT,
  coerceGain,
  normalizeCompPresets,
  type CompParams,
  type CompPreset,
} from "../../shared/comp-presets.js";

const PARAMS: {
  key: keyof CompParams;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt: (n: number) => string;
}[] = [
  { key: "threshold", label: "audioThreshold", min: -100, max: 0, step: 1, fmt: (n) => n + " dB" },
  { key: "knee", label: "audioKnee", min: 0, max: 40, step: 1, fmt: (n) => n + " dB" },
  { key: "ratio", label: "audioRatio", min: 1, max: 20, step: 0.5, fmt: (n) => n + ":1" },
  {
    key: "attack",
    label: "audioAttack",
    min: 0,
    max: 1,
    step: 0.001,
    fmt: (n) => Math.round(n * 1000) + " ms",
  },
  {
    key: "release",
    label: "audioRelease",
    min: 0,
    max: 1,
    step: 0.001,
    fmt: (n) => Math.round(n * 1000) + " ms",
  },
];

// Params a freshly-added preset starts from (the balanced "voice" defaults).
const NEW_PRESET: CompParams = { threshold: -60, knee: 30, ratio: 10, attack: 0, release: 1 };

// The label a preset falls back to when it has no custom name: its localized
// default (the shipped three) or a generic "Preset N".
const fallbackLabel = (p: CompPreset, i: number) =>
  p.nameKey ? msg(p.nameKey) || "" : msg("optCompPresetName", String(i + 1)) || `Preset ${i + 1}`;

// Pushpin glyph (monochrome, inherits color) for the pin toggle.
const PinIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
    <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
  </svg>
);

export function Presets() {
  const [presets, setPresets] = useState<CompPreset[] | null>(null);
  // Raw, untrimmed name text per row — so spaces type freely; the persisted name
  // is trim()|undefined (empty falls back to the localized/generic default).
  const [names, setNames] = useState<string[]>([]);
  const [globalGain, setGlobalGain] = useState(GAIN_DEFAULT);

  useEffect(() => {
    STORE.get(["compPresets", "audioCompGain", "audioCompBaseGain"], (r) => {
      const list = normalizeCompPresets(r.compPresets);
      setPresets(list);
      setNames(list.map((p) => p.name ?? ""));
      // Pre-split installs have no base gain yet — inherit the stored live gain.
      setGlobalGain(coerceGain(r.audioCompBaseGain) ?? coerceGain(r.audioCompGain) ?? GAIN_DEFAULT);
    });
  }, []);

  if (!presets) return null;

  const pinnedCount = presets.filter((p) => p.pin).length;

  const persist = (next: CompPreset[]) => {
    setPresets(next);
    STORE.set({ compPresets: next });
  };

  const setName = (i: number, raw: string) => {
    setNames(names.map((n, j) => (j === i ? raw : n)));
    persist(presets.map((p, j) => (j === i ? { ...p, name: raw.trim() || undefined } : p)));
  };

  const setParam = (i: number, key: keyof CompParams, v: number) => {
    persist(presets.map((p, j) => (j === i ? { ...p, [key]: v } : p)));
  };

  const setGlobal = (v: number) => {
    setGlobalGain(v);
    // Set the global base and apply it live (audioCompGain is what the content
    // script reads); a no-gain preset later falls back to this base.
    STORE.set({ audioCompBaseGain: v, audioCompGain: v });
  };

  // Toggle a preset's gain override on (seeded from the global gain) or off.
  const togglePresetGain = (i: number, on: boolean) => {
    persist(presets.map((p, j) => (j === i ? { ...p, gain: on ? globalGain : undefined } : p)));
  };
  const setPresetGain = (i: number, v: number) => {
    persist(presets.map((p, j) => (j === i ? { ...p, gain: v } : p)));
  };

  const togglePin = (i: number) => {
    if (!presets[i].pin && pinnedCount >= COMP_QUICK_COUNT) return; // only this many fit the popup
    persist(presets.map((p, j) => (j === i ? { ...p, pin: !p.pin } : p)));
  };

  const addPreset = () => {
    if (presets.length >= COMP_MAX_PRESETS) return;
    setNames([...names, ""]);
    persist([...presets, { ...NEW_PRESET, pin: false }]);
  };

  const removePreset = (i: number) => {
    if (presets.length <= COMP_MIN_PRESETS) return;
    setNames(names.filter((_, j) => j !== i));
    persist(presets.filter((_, j) => j !== i));
  };

  const resetDefaults = () => {
    const list = normalizeCompPresets(undefined);
    setPresets(list);
    setNames(list.map((p) => p.name ?? ""));
    STORE.remove(["compPresets"]);
  };

  return (
    <section className="card">
      <h2>{msg("optCompPresetsTitle") || "Compressor presets"}</h2>
      <p className="card-desc">{msg("optCompPresetsDesc")}</p>

      <div className="opt-param">
        <div className="opt-param-row">
          <span>{msg("optGlobalGain") || "Global gain"}</span>
          <b className="opt-param-val">{globalGain} dB</b>
        </div>
        <Slider
          className="opt-slider"
          min={GAIN_MIN}
          max={GAIN_MAX}
          step={GAIN_STEP}
          value={globalGain}
          ariaLabel={msg("optGlobalGain") || "Global gain"}
          onChange={setGlobal}
        />
      </div>

      <div className="comp-preset-grid" id="presetEditors">
        {presets.map((cur, i) => (
          <div className="preset-editor" key={i}>
            <div className="preset-editor-head">
              <button
                type="button"
                className={"preset-pin" + (cur.pin ? " is-pinned" : "")}
                title={msg("optCompPresetPin") || "Show in the popup"}
                aria-pressed={cur.pin}
                disabled={!cur.pin && pinnedCount >= COMP_QUICK_COUNT}
                onClick={() => togglePin(i)}
              >
                <PinIcon />
              </button>
              <input
                type="text"
                className="preset-name-input"
                maxLength={24}
                placeholder={fallbackLabel(cur, i)}
                value={names[i] ?? ""}
                onChange={(e) => setName(i, e.target.value)}
              />
              <button
                type="button"
                className="preset-remove"
                title={msg("optPresetRemove") || "Remove preset"}
                disabled={presets.length <= COMP_MIN_PRESETS}
                onClick={() => removePreset(i)}
              >
                ✕
              </button>
            </div>
            {PARAMS.map((p) => (
              <div className="opt-param" key={p.key}>
                <div className="opt-param-row">
                  <span>{msg(p.label)}</span>
                  <b className="opt-param-val">{p.fmt(cur[p.key])}</b>
                </div>
                <Slider
                  className="opt-slider"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={cur[p.key]}
                  ariaLabel={msg(p.label)}
                  onChange={(v) => setParam(i, p.key, v)}
                />
              </div>
            ))}
            <div className="opt-param">
              <div className="opt-param-row">
                <span>{msg("audioGain") || "Make-up gain"}</span>
                <span className="preset-gain-ctrl">
                  {cur.gain != null && <b className="opt-param-val">{cur.gain} dB</b>}
                  <Switch checked={cur.gain != null} onChange={(on) => togglePresetGain(i, on)} />
                </span>
              </div>
              {cur.gain != null && (
                <Slider
                  className="opt-slider"
                  min={GAIN_MIN}
                  max={GAIN_MAX}
                  step={GAIN_STEP}
                  value={cur.gain}
                  ariaLabel={msg("audioGain") || "Make-up gain"}
                  onChange={(v) => setPresetGain(i, v)}
                />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="card-actions">
        <button
          type="button"
          className="btn-action btn-default"
          disabled={presets.length >= COMP_MAX_PRESETS}
          onClick={addPreset}
        >
          {msg("optPresetAdd") || "Add preset"}
        </button>
        <button type="button" className="btn-action btn-reset" onClick={resetDefaults}>
          {msg("optResetDefaults") || "Reset to defaults"}
        </button>
      </div>
    </section>
  );
}
