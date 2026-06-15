// Compressor preset editor: rename each one-tap profile and tune its values with
// the same sliders as the popup. Persisted under "compPresets"; the popup reads it
// to label + apply the buttons. Make-up gain is excluded — presets never set it.
import { STORE } from "../shared/store.js";
import { msg } from "../popup/i18n.js";
import {
  COMP_PRESET_DEFAULTS, PRESET_ORDER, resolvePresets,
  type CompParams, type PresetName, type StoredPresets,
} from "../shared/comp-presets.js";

const PARAMS: { key: keyof CompParams; label: string; min: number; max: number; step: number; fmt: (n: number) => string }[] = [
  { key: "threshold", label: "audioThreshold", min: -100, max: 0, step: 1, fmt: (n) => n + " dB" },
  { key: "knee", label: "audioKnee", min: 0, max: 40, step: 1, fmt: (n) => n + " dB" },
  { key: "ratio", label: "audioRatio", min: 1, max: 20, step: 0.5, fmt: (n) => n + ":1" },
  { key: "attack", label: "audioAttack", min: 0, max: 1, step: 0.001, fmt: (n) => Math.round(n * 1000) + " ms" },
  { key: "release", label: "audioRelease", min: 0, max: 1, step: 0.001, fmt: (n) => Math.round(n * 1000) + " ms" },
];

function defaultName(name: PresetName): string {
  return msg("preset" + name[0].toUpperCase() + name.slice(1)) || name;
}

export function initPresets(): void {
  const host = document.getElementById("presetEditors");
  const resetBtn = document.getElementById("presetResetBtn");
  if (!host || !resetBtn) return;

  STORE.get(["compPresets"], (r) => {
    const resolved = resolvePresets(r.compPresets as StoredPresets | undefined);
    const persist = (): void => { STORE.set({ compPresets: resolved }); };

    const render = (): void => {
      host.textContent = "";
      for (const name of PRESET_ORDER) {
        const cur = resolved[name];
        const editor = document.createElement("div");
        editor.className = "preset-editor";

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.className = "preset-name-input";
        nameInput.maxLength = 24;
        nameInput.value = cur.name ?? defaultName(name);
        nameInput.addEventListener("input", () => {
          cur.name = nameInput.value.trim() || undefined;   // cleared → fall back to the localized default
          persist();
        });
        editor.appendChild(nameInput);

        for (const p of PARAMS) {
          const row = document.createElement("div");
          row.className = "opt-param";

          const head = document.createElement("div");
          head.className = "opt-param-row";
          const lab = document.createElement("span");
          lab.textContent = msg(p.label);
          const val = document.createElement("b");
          val.className = "opt-param-val";
          val.textContent = p.fmt(cur[p.key]);
          head.append(lab, val);

          const slider = document.createElement("input");
          slider.type = "range";
          slider.className = "opt-slider";
          slider.min = String(p.min);
          slider.max = String(p.max);
          slider.step = String(p.step);
          slider.value = String(cur[p.key]);
          slider.addEventListener("input", () => {
            const v = Number(slider.value);
            cur[p.key] = v;
            val.textContent = p.fmt(v);
            persist();
          });

          row.append(head, slider);
          editor.appendChild(row);
        }
        host.appendChild(editor);
      }
    };

    render();

    resetBtn.addEventListener("click", () => {
      for (const name of PRESET_ORDER) {
        resolved[name] = { ...COMP_PRESET_DEFAULTS[name] };   // drop name + values back to defaults
      }
      STORE.remove(["compPresets"]);
      render();
    });
  });
}
