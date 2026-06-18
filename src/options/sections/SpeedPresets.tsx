// Speed-preset editor: the eight values behind the popup grid + Shift+1…8
// hotkeys, the configurable max-speed ceiling the slider exposes, the per-press
// step size, and the hold-key's temporary speed. Persisted under "speedPresets"
// (integer percents), "speedMax", "speedStep" and "holdSpeed"; the popup +
// content script read them. Mirrors the compressor preset editor.
import { useEffect, useState } from "react";
import { STORE } from "../../shared/store.js";
import { msg } from "../../popup/i18n.js";
import {
  normalizePresets,
  normalizeSpeedMax,
  normalizeSpeedStep,
  normalizeHoldSpeed,
  DEFAULT_PRESETS,
  PRESET_MIN,
  PRESET_MAX,
  SPEED_MAX_DEFAULT,
  SPEED_MAX_MIN,
  SPEED_MAX_STEP,
  STEP_DEFAULT,
  STEP_MIN,
  STEP_MAX,
  HOLD_SPEED_DEFAULT,
} from "../../shared/presets.js";

const snap = (v: number) => Math.round(v / 5) * 5;

export function SpeedPresets() {
  const [presets, setPresets] = useState<number[] | null>(null);
  const [speedMax, setSpeedMax] = useState<number>(SPEED_MAX_DEFAULT);
  const [speedStep, setSpeedStep] = useState<number>(STEP_DEFAULT);
  const [holdSpeed, setHoldSpeed] = useState<number>(HOLD_SPEED_DEFAULT);
  // Raw text per field so a value can be typed freely; the committed (clamped)
  // value lands on blur. Mirrors the compressor editor's name-input handling.
  const [fields, setFields] = useState<string[]>([]);

  useEffect(() => {
    STORE.get(["speedPresets", "speedMax", "speedStep", "holdSpeed"], (r) => {
      const p = normalizePresets(r.speedPresets);
      setPresets(p);
      setFields(p.map(String));
      setSpeedMax(normalizeSpeedMax(r.speedMax));
      setSpeedStep(normalizeSpeedStep(r.speedStep));
      setHoldSpeed(normalizeHoldSpeed(r.holdSpeed));
    });
  }, []);

  if (!presets) return null;

  const setMax = (raw: number) => {
    const next = normalizeSpeedMax(raw);
    setSpeedMax(next);
    // Pull any preset / hold speed above the new ceiling back into range so the
    // grid + slider stay consistent.
    const clamped = presets.map((p) => Math.min(next, p));
    const hold = Math.min(holdSpeed, next);
    setPresets(clamped);
    setFields(clamped.map(String));
    setHoldSpeed(hold);
    STORE.set({ speedMax: next, speedPresets: clamped, holdSpeed: hold });
  };

  const setStep = (raw: number) => {
    const v = normalizeSpeedStep(raw);
    setSpeedStep(v);
    STORE.set({ speedStep: v });
  };

  const setHold = (raw: number) => {
    const v = Math.min(speedMax, normalizeHoldSpeed(raw));
    setHoldSpeed(v);
    STORE.set({ holdSpeed: v });
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
    setSpeedStep(STEP_DEFAULT);
    setHoldSpeed(HOLD_SPEED_DEFAULT);
    STORE.remove(["speedPresets", "speedMax", "speedStep", "holdSpeed"]);
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

      <div className="opt-param">
        <div className="opt-param-row">
          <span>{msg("optStepLabel") || "Speed step"}</span>
          <b className="opt-param-val">{speedStep}%</b>
        </div>
        <input
          type="range"
          className="opt-slider"
          min={STEP_MIN}
          max={STEP_MAX}
          step={1}
          value={speedStep}
          onChange={(e) => setStep(Number(e.target.value))}
        />
      </div>

      <div className="opt-param">
        <div className="opt-param-row">
          <span>{msg("optHoldSpeed") || "Hold speed"}</span>
          <b className="opt-param-val">{holdSpeed}%</b>
        </div>
        <input
          type="range"
          className="opt-slider"
          min={PRESET_MIN}
          max={speedMax}
          step={5}
          value={holdSpeed}
          onChange={(e) => setHold(Number(e.target.value))}
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
