// Global tuning for the dense-speech auto-slow. The on/off and the target rate are
// set per site/channel from the popup; this card holds the global knobs, read live
// by the content sampler (via storage.onChanged) — no reload needed.
//   - Slowest speed — the floor it may ease down to, as a fraction of the set speed.
//   - Hold — how long it stays slowed after the dense passage ends.
//   - Reaction — how fast it slows down; Ease-back — how fast it returns.
import { useEffect, useState } from "react";
import { STORE } from "../../shared/store.js";
import { msg } from "../../popup/i18n.js";
import { Slider } from "../../ui/Slider.js";

const clampNum = (v: unknown, lo: number, hi: number, def: number) => {
  const n = Number(v);
  if (Number.isNaN(n)) return def;
  return Math.min(hi, Math.max(lo, n));
};

interface KnobProps {
  label: string;
  hint: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  tickStep?: number;
  id: string;
  onChange: (v: number) => void;
}
function Knob({ label, hint, value, display, min, max, step, tickStep, id, onChange }: KnobProps) {
  return (
    <div className="opt-param">
      <div className="opt-param-row">
        <span>{label}</span>
        <b className="opt-param-val">{display}</b>
      </div>
      <Slider
        className="opt-slider"
        id={id}
        min={min}
        max={max}
        step={step}
        tickStep={tickStep}
        value={value}
        ariaLabel={label}
        onChange={onChange}
      />
      <p className="opt-param-hint">{hint}</p>
    </div>
  );
}

export function AutoSlow() {
  const [floorPct, setFloorPct] = useState(100);
  const [knee, setKnee] = useState(0.5);
  const [hold, setHold] = useState(1.2);
  const [reaction, setReaction] = useState(50);
  const [easeBack, setEaseBack] = useState(25);

  useEffect(() => {
    STORE.get(
      ["autoSlowFloor", "autoSlowKnee", "autoSlowHold", "autoSlowReaction", "autoSlowEaseBack"],
      (r) => {
        const f = Number(r.autoSlowFloor);
        setFloorPct(Number.isNaN(f) ? 100 : clampNum(f * 100, 50, 200, 100));
        setKnee(clampNum(r.autoSlowKnee, 0, 2, 0.5));
        setHold(clampNum(r.autoSlowHold, 0, 4, 1.2));
        setReaction(clampNum(r.autoSlowReaction, 0, 100, 50));
        setEaseBack(clampNum(r.autoSlowEaseBack, 0, 100, 25));
      },
    );
  }, []);

  const write = (key: string, set: (v: number) => void, lo: number, hi: number) => (v: number) => {
    const n = clampNum(v, lo, hi, v);
    set(n);
    STORE.set({ [key]: n });
  };

  return (
    <section className="card">
      <h2>
        {msg("optAutoSlowTitle") || "Auto-slow dense speech"}{" "}
        <span className="beta-pill">beta</span>
      </h2>
      <p className="card-desc">
        {msg("optAutoSlowDesc") ||
          "Enable it and set the target rate per site/channel from the popup. These global knobs tune the response."}
      </p>

      <div className="opt-params-grid">
        <Knob
          id="autoSlowFloor"
          label={msg("optAutoSlowFloor") || "Slowest speed"}
          hint={msg("optAutoSlowFloorHint") || "The lowest speed it may ease down to."}
          value={floorPct}
          display={`${floorPct}%`}
          min={50}
          max={200}
          step={5}
          onChange={(v) => {
            const n = clampNum(v, 50, 200, 100);
            setFloorPct(n);
            STORE.set({ autoSlowFloor: n / 100 });
          }}
        />
        <Knob
          id="autoSlowKnee"
          label={msg("optAutoSlowKnee") || "Soft knee"}
          hint={
            msg("optAutoSlowKneeHint") ||
            "Eases the slowdown in across a band around the target rate instead of switching on sharply. Wider = gentler, earlier."
          }
          value={knee}
          display={`±${knee.toFixed(1)} /s`}
          min={0}
          max={2}
          step={0.1}
          tickStep={0.5}
          onChange={write("autoSlowKnee", setKnee, 0, 2)}
        />
        <Knob
          id="autoSlowHold"
          label={msg("optAutoSlowHold") || "Hold"}
          hint={
            msg("optAutoSlowHoldHint") ||
            "How long it stays slowed after the fast passage ends, before speeding back up."
          }
          value={hold}
          display={`${hold.toFixed(1)} s`}
          min={0}
          max={4}
          step={0.1}
          onChange={write("autoSlowHold", setHold, 0, 4)}
        />
        <Knob
          id="autoSlowReaction"
          label={msg("optAutoSlowReaction") || "Reaction"}
          hint={msg("optAutoSlowReactionHint") || "How fast it slows down when speech gets dense."}
          value={reaction}
          display={`${reaction}%`}
          min={0}
          max={100}
          step={5}
          onChange={write("autoSlowReaction", setReaction, 0, 100)}
        />
        <Knob
          id="autoSlowEaseBack"
          label={msg("optAutoSlowEaseBack") || "Ease-back"}
          hint={msg("optAutoSlowEaseBackHint") || "How fast it returns to your speed afterwards."}
          value={easeBack}
          display={`${easeBack}%`}
          min={0}
          max={100}
          step={5}
          onChange={write("autoSlowEaseBack", setEaseBack, 0, 100)}
        />
      </div>
    </section>
  );
}
