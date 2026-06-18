// Speed-preset editor: a variable-length list of preset values (add/remove,
// 1…MAX_PRESETS), each with an optional hotkey chord and a "pin" that puts it in
// the popup's collapsed quick row. Plus the configurable max-speed ceiling,
// per-press step, and the hold-key's temporary speed. Persisted under
// "speedPresets" / "presetKeys" / "presetPins" (lockstep arrays) and "speedMax" /
// "speedStep" / "holdSpeed"; the popup + content script read them.
import { useCallback, useEffect, useRef, useState } from "react";
import { STORE } from "../../shared/store.js";
import { msg } from "../../popup/i18n.js";
import {
  normalizePresetSet,
  normalizeSpeedMax,
  normalizeSpeedStep,
  normalizeHoldSpeed,
  DEFAULT_PRESETS,
  DEFAULT_PRESET_KEYS,
  DEFAULT_PINNED_VALUES,
  MIN_PRESETS,
  MAX_PRESETS,
  QUICK_COUNT,
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
import {
  normalizeKeymap,
  formatChord,
  eventChord,
  chordLabel,
  ACTIONS,
  type Keymap,
} from "../../shared/keymap.js";

interface Row {
  pct: number;
  key: string | null;
  pin: boolean;
}

const snap = (v: number) => Math.round(v / 5) * 5;

// Pushpin glyph (monochrome, inherits color) for the pin toggle.
const PinIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
    <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
  </svg>
);

export function SpeedPresets() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [speedMax, setSpeedMax] = useState<number>(SPEED_MAX_DEFAULT);
  const [speedStep, setSpeedStep] = useState<number>(STEP_DEFAULT);
  const [holdSpeed, setHoldSpeed] = useState<number>(HOLD_SPEED_DEFAULT);
  // Raw text per field so a value can be typed freely; the committed (clamped,
  // re-sorted) value lands on blur.
  const [fields, setFields] = useState<string[]>([]);
  // Which preset row is awaiting a key press, and a transient "rejected" flash.
  const [capturing, setCapturing] = useState<number | null>(null);
  const [dupe, setDupe] = useState<number | null>(null);

  // Live refs so the global keydown handler (bound once) sees current state.
  const capRef = useRef<number | null>(null);
  const rowsRef = useRef<Row[]>([]);
  const keymapRef = useRef<Keymap | null>(null);
  const dupeTimer = useRef<ReturnType<typeof setTimeout>>();
  capRef.current = capturing;
  rowsRef.current = rows ?? [];

  // Sort the rows by value (keys + pins travel), mirror into the text fields, and
  // persist all three lockstep arrays. The single write path for every edit.
  const commitRows = useCallback((next: Row[]) => {
    const sorted = [...next].sort((a, b) => a.pct - b.pct);
    setRows(sorted);
    setFields(sorted.map((r) => String(r.pct)));
    STORE.set({
      speedPresets: sorted.map((r) => r.pct),
      presetKeys: sorted.map((r) => r.key),
      presetPins: sorted.map((r) => r.pin),
    });
  }, []);

  useEffect(() => {
    STORE.get(
      ["speedPresets", "presetKeys", "presetPins", "speedMax", "speedStep", "holdSpeed", "keymap"],
      (r) => {
        const set = normalizePresetSet(r.speedPresets, r.presetKeys, r.presetPins);
        const loaded = set.presets.map((pct, i) => ({ pct, key: set.keys[i], pin: set.pinned[i] }));
        setRows(loaded);
        setFields(loaded.map((row) => String(row.pct)));
        setSpeedMax(normalizeSpeedMax(r.speedMax));
        setSpeedStep(normalizeSpeedStep(r.speedStep));
        setHoldSpeed(normalizeHoldSpeed(r.holdSpeed));
        keymapRef.current = normalizeKeymap(r.keymap);
      },
    );
  }, []);

  // Capture a key for the active preset row. Esc cancels; Backspace/Delete clears
  // the binding; a chord that duplicates another preset or shadows an action key
  // (same position, no Ctrl/Alt) is rejected with a flash.
  useEffect(() => {
    const reject = (i: number) => {
      setDupe(i);
      clearTimeout(dupeTimer.current);
      dupeTimer.current = setTimeout(() => setDupe(null), 600);
    };
    const onKey = (e: KeyboardEvent) => {
      const i = capRef.current;
      if (i == null) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") return setCapturing(null);
      const setKey = (spec: string | null) => {
        commitRows(rowsRef.current.map((r, j) => (j === i ? { ...r, key: spec } : r)));
        setCapturing(null);
      };
      if (e.code === "Backspace" || e.code === "Delete") return setKey(null);
      const chord = eventChord(e);
      if (!chord) return reject(i);
      const spec = formatChord(chord);
      const dupePreset = rowsRef.current.some((r, j) => j !== i && r.key === spec);
      const km = keymapRef.current;
      const shadowsAction =
        !chord.mod && !chord.alt && !!km && ACTIONS.some((a) => km[a] === chord.code);
      if (dupePreset || shadowsAction) return reject(i);
      setKey(spec);
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      clearTimeout(dupeTimer.current);
    };
  }, [commitRows]);

  if (!rows) return null;

  const pinnedCount = rows.filter((r) => r.pin).length;

  const setMax = (raw: number) => {
    const next = normalizeSpeedMax(raw);
    setSpeedMax(next);
    // Max speed governs the popup slider's range + the hold speed, not the presets
    // (those are explicit jump values, free to exceed it up to the 16× cap).
    const hold = Math.min(holdSpeed, next);
    setHoldSpeed(hold);
    STORE.set({ speedMax: next, holdSpeed: hold });
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
      ? Math.min(PRESET_MAX, Math.max(PRESET_MIN, snap(raw)))
      : rows[i].pct;
    commitRows(rows.map((r, j) => (j === i ? { ...r, pct: v } : r)));
  };

  const togglePin = (i: number) => {
    if (!rows[i].pin && pinnedCount >= QUICK_COUNT) return; // only QUICK_COUNT fit the quick row
    commitRows(rows.map((r, j) => (j === i ? { ...r, pin: !r.pin } : r)));
  };

  const addPreset = () => {
    if (rows.length >= MAX_PRESETS) return;
    const last = rows.length ? rows[rows.length - 1].pct : 100;
    const pct = Math.min(PRESET_MAX, Math.max(PRESET_MIN, last + 25));
    commitRows([...rows, { pct, key: null, pin: false }]);
  };

  const removePreset = (i: number) => {
    if (rows.length <= MIN_PRESETS) return;
    if (capturing === i) setCapturing(null);
    commitRows(rows.filter((_, j) => j !== i));
  };

  const resetDefaults = () => {
    setSpeedMax(SPEED_MAX_DEFAULT);
    setSpeedStep(STEP_DEFAULT);
    setHoldSpeed(HOLD_SPEED_DEFAULT);
    setCapturing(null);
    commitRows(
      DEFAULT_PRESETS.map((pct, i) => ({
        pct,
        key: DEFAULT_PRESET_KEYS[i],
        pin: DEFAULT_PINNED_VALUES.includes(pct),
      })),
    );
    STORE.remove(["speedMax", "speedStep", "holdSpeed"]);
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

      <div className="preset-rows">
        {fields.map((val, i) => (
          <div className="preset-row" key={i}>
            <button
              type="button"
              className={"preset-pin" + (rows[i].pin ? " is-pinned" : "")}
              title={msg("optPresetPinHint") || "Pin to the collapsed quick row"}
              aria-pressed={rows[i].pin}
              disabled={!rows[i].pin && pinnedCount >= QUICK_COUNT}
              onClick={() => togglePin(i)}
            >
              <PinIcon />
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={PRESET_MIN}
              max={PRESET_MAX}
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
            <span className="preset-pct">%</span>
            <button
              type="button"
              className={
                "key-cap preset-key" +
                (capturing === i ? " capturing" : "") +
                (dupe === i ? " dupe" : "")
              }
              title={msg("optPresetKeyHint") || "Assign a hotkey"}
              onClick={() => setCapturing(capturing === i ? null : i)}
            >
              {capturing === i
                ? msg("optKeyPress") || "Press a key…"
                : rows[i].key
                  ? chordLabel(rows[i].key)
                  : "—"}
            </button>
            <button
              type="button"
              className="preset-remove"
              title={msg("optPresetRemove") || "Remove preset"}
              disabled={rows.length <= MIN_PRESETS}
              onClick={() => removePreset(i)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="card-actions">
        <button
          type="button"
          className="btn-action btn-default"
          disabled={rows.length >= MAX_PRESETS}
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
