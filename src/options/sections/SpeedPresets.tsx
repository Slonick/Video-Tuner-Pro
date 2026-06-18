// Speed-preset editor: set the eight values behind the popup grid + Shift+1…8
// hotkeys, and the configurable max-speed ceiling the slider exposes. Persisted
// under "speedPresets" (integer percents) and "speedMax"; the popup + content
// script read both. Mirrors the compressor preset editor's load/persist/reset.
import { useEffect, useState } from "react";
import { STORE } from "../../shared/store.js";
import { msg } from "../../popup/i18n.js";
import {
  normalizePresets,
  normalizeSpeedMax,
  DEFAULT_PRESETS,
  PRESET_MIN,
  PRESET_MAX,
  SPEED_MAX_DEFAULT,
  SPEED_MAX_MIN,
  SPEED_MAX_STEP,
} from "../../shared/presets.js";

const snap = (v: number) => Math.round(v / 5) * 5;

export function SpeedPresets() {
  const [presets, setPresets] = useState<number[] | null>(null);
  const [speedMax, setSpeedMax] = useState<number>(SPEED_MAX_DEFAULT);
  // Raw text per field so a value can be typed freely; the committed (clamped)
  // value lands on blur. Mirrors the compressor editor's name-input handling.
  const [fields, setFields] = useState<string[]>([]);

  useEffect(() => {
    STORE.get(["speedPresets", "speedMax"], (r) => {
      const p = normalizePresets(r.speedPresets);
      setPresets(p);
      setFields(p.map(String));
      setSpeedMax(normalizeSpeedMax(r.speedMax));
    });
  }, []);

  if (!presets) return null;

  const setMax = (raw: number) => {
    const next = normalizeSpeedMax(raw);
    setSpeedMax(next);
    // Pull any preset above the new ceiling back into range so the grid + slider
    // stay consistent.
    const clamped = presets.map((p) => Math.min(next, p));
    setPresets(clamped);
    setFields(clamped.map(String));
    STORE.set({ speedMax: next, speedPresets: clamped });
  };

  const commitField = (i: number) => {
    const raw = Number(fields[i]);
    const v = Number.isFinite(raw)
      ? Math.min(speedMax, Math.max(PRESET_MIN, snap(raw)))
      : presets[i];
    const next = presets.slice();
    next[i] = v;
    const f = fields.slice();
    f[i] = String(v);
    setPresets(next);
    setFields(f);
    STORE.set({ speedPresets: next });
  };

  const resetDefaults = () => {
    setPresets([...DEFAULT_PRESETS]);
    setFields(DEFAULT_PRESETS.map(String));
    setSpeedMax(SPEED_MAX_DEFAULT);
    STORE.remove(["speedPresets", "speedMax"]);
  };

  return (
    <section className="card">
      <h2>{msg("optPresetsTitle") || "Speed presets"}</h2>
      <p className="card-desc">{msg("optPresetsDesc")}</p>

      <div className="opt-param">
        <div className="opt-param-row">
          <span>{msg("optMaxSpeed") || "Maximum speed"}</span>
          <b className="opt-param-val">{speedMax}%</b>
        </div>
        <input
          type="range"
          className="opt-slider"
          min={SPEED_MAX_MIN}
          max={PRESET_MAX}
          step={SPEED_MAX_STEP}
          value={speedMax}
          onChange={(e) => setMax(Number(e.target.value))}
        />
      </div>

      <div className="speed-preset-grid">
        {fields.map((val, i) => (
          <label className="speed-preset-field" key={i}>
            <span>{i + 1}</span>
            <input
              type="number"
              inputMode="numeric"
              min={PRESET_MIN}
              max={speedMax}
              step={5}
              value={val}
              onChange={(e) => {
                const f = fields.slice();
                f[i] = e.target.value;
                setFields(f);
              }}
              onBlur={() => commitField(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="speed-preset-pct">%</span>
          </label>
        ))}
      </div>

      <div className="card-actions">
        <button type="button" className="btn-action btn-reset" onClick={resetDefaults}>
          {msg("optResetDefaults") || "Reset to defaults"}
        </button>
      </div>
    </section>
  );
}
