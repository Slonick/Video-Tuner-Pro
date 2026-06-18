// Compressor preset editor: rename each one-tap profile and tune its values with
// the same sliders as the popup. Persisted under "compPresets"; the popup reads
// it to label + apply the buttons. Make-up gain is excluded. Mirrors presets.ts.
import { useEffect, useState } from "react";
import { STORE } from "../../shared/store.js";
import { msg } from "../../popup/i18n.js";
import {
  COMP_PRESET_DEFAULTS,
  PRESET_ORDER,
  resolvePresets,
  type CompParams,
  type PresetName,
  type ResolvedPreset,
  type StoredPresets,
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

const defaultName = (name: PresetName) =>
  msg("preset" + name[0].toUpperCase() + name.slice(1)) || name;

export function Presets() {
  const [resolved, setResolved] = useState<Record<PresetName, ResolvedPreset> | null>(null);
  // Raw, untrimmed text in each name field — so spaces can be typed freely; the
  // persisted name is trim()|undefined (empty falls back to the localized default).
  const [names, setNames] = useState<Record<PresetName, string>>({} as Record<PresetName, string>);

  useEffect(() => {
    STORE.get(["compPresets"], (r) => {
      const res = resolvePresets(r.compPresets as StoredPresets | undefined);
      setResolved(res);
      const n = {} as Record<PresetName, string>;
      for (const k of PRESET_ORDER) n[k] = res[k].name ?? defaultName(k);
      setNames(n);
    });
  }, []);

  if (!resolved) return null;

  const persist = (next: Record<PresetName, ResolvedPreset>) => {
    setResolved(next);
    STORE.set({ compPresets: next });
  };

  const setName = (name: PresetName, raw: string) => {
    setNames({ ...names, [name]: raw });
    persist({ ...resolved, [name]: { ...resolved[name], name: raw.trim() || undefined } });
  };
  const setParam = (name: PresetName, key: keyof CompParams, v: number) => {
    persist({ ...resolved, [name]: { ...resolved[name], [key]: v } });
  };
  const resetDefaults = () => {
    const next = {} as Record<PresetName, ResolvedPreset>;
    const n = {} as Record<PresetName, string>;
    for (const name of PRESET_ORDER) {
      next[name] = { ...COMP_PRESET_DEFAULTS[name] };
      n[name] = defaultName(name);
    }
    setResolved(next);
    setNames(n);
    STORE.remove(["compPresets"]);
  };

  return (
    <section className="card">
      <h2>{msg("optCompPresetsTitle") || "Compressor presets"}</h2>
      <p className="card-desc">{msg("optCompPresetsDesc")}</p>
      <div id="presetEditors">
        {PRESET_ORDER.map((name) => {
          const cur = resolved[name];
          return (
            <div className="preset-editor" key={name}>
              <input
                type="text"
                className="preset-name-input"
                maxLength={24}
                value={names[name] ?? ""}
                onChange={(e) => setName(name, e.target.value)}
              />
              {PARAMS.map((p) => (
                <div className="opt-param" key={p.key}>
                  <div className="opt-param-row">
                    <span>{msg(p.label)}</span>
                    <b className="opt-param-val">{p.fmt(cur[p.key])}</b>
                  </div>
                  <input
                    type="range"
                    className="opt-slider"
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={cur[p.key]}
                    onChange={(e) => setParam(name, p.key, Number(e.target.value))}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="card-actions">
        <button type="button" className="btn-action btn-reset" onClick={resetDefaults}>
          {msg("optResetDefaults") || "Reset to defaults"}
        </button>
      </div>
    </section>
  );
}
