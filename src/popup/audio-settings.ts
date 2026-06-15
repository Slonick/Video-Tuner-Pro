// These storage keys are exactly what the content script reads and applies.
import { STORE } from "./platform/storage.js";
import { clampNum } from "./core/clamp.js";
import { byId } from "./dom.js";
import { tweenSlider } from "./core/tween-slider.js";
import { movePill } from "./core/seg-pill.js";
import { autoExpandOnFirstEnable } from "./sections.js";
import { resolvePresets, compToStorage, type CompParams, type PresetName, type StoredPresets } from "../shared/comp-presets.js";

// Resolved presets (defaults until storage loads). The popup buttons keep their
// localized labels unless the user renamed a preset on the options page.
let PRESETS = resolvePresets(undefined);

function relabelPresets(): void {
  document.querySelectorAll<HTMLElement>(".btn-preset").forEach((btn) => {
    const custom = PRESETS[btn.dataset.preset as PresetName]?.name;
    if (custom) btn.textContent = custom;   // else the localized default (data-i18n) stays
  });
}

// Load the user's edited presets (values + names). Call after localize() so a
// custom name overrides the localized default rather than the reverse.
export function loadCompPresets(): void {
  STORE.get(["compPresets"], (r) => {
    PRESETS = resolvePresets(r.compPresets as StoredPresets | undefined);
    relabelPresets();
    syncPresetHighlight();
  });
}

interface AudioUI {
  enabled: boolean;
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;
  release: number;
}

function fmtParam(key: string, v: unknown): string {
  const n = Number(v);
  switch (key) {
    case "audioCompRatio": return n + ":1";
    case "audioCompAttack":
    case "audioCompRelease": return Math.round(n * 1000) + " ms";
    default: return n + " dB"; // threshold, knee, gain
  }
}

function setParam(id: string, key: string, value: number, animate = false): void {
  const slider = byId<HTMLInputElement>(id);
  if (animate) tweenSlider(slider, value);
  else slider.value = String(value);
  const out = document.getElementById(id + "Val");
  if (out) out.textContent = fmtParam(key, value);
}

// Light up a preset button when every compressor value matches its profile, so
// it reads as the active selection (gain is excluded — presets never set it).
function syncPresetHighlight(): void {
  const cur: CompParams = {
    threshold: Number(byId<HTMLInputElement>("acThreshold").value),
    knee: Number(byId<HTMLInputElement>("acKnee").value),
    ratio: Number(byId<HTMLInputElement>("acRatio").value),
    attack: Number(byId<HTMLInputElement>("acAttack").value),
    release: Number(byId<HTMLInputElement>("acRelease").value),
  };
  const eq = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
  document.querySelectorAll<HTMLElement>(".btn-preset").forEach((btn) => {
    const p = PRESETS[btn.dataset.preset as PresetName];
    const on = !!p && eq(cur.threshold, p.threshold) && eq(cur.knee, p.knee) &&
      eq(cur.ratio, p.ratio) && eq(cur.attack, p.attack) && eq(cur.release, p.release);
    btn.classList.toggle("active", on);
  });
  movePill(document.querySelector<HTMLElement>(".preset-row"));
}

function reflectAudioUI(s: AudioUI, animate = false): void {
  byId<HTMLInputElement>("audioCompToggle").checked = s.enabled;
  setParam("acThreshold", "audioCompThreshold", s.threshold, animate);
  setParam("acKnee", "audioCompKnee", s.knee, animate);
  setParam("acRatio", "audioCompRatio", s.ratio, animate);
  setParam("acAttack", "audioCompAttack", s.attack, animate);
  setParam("acRelease", "audioCompRelease", s.release, animate);
  // Mid-glide the live values don't match yet, so applyComp lights the preset
  // itself; on load (no animate) the values are settled — recompute here.
  if (!animate) syncPresetHighlight();
}

export function loadAudioSettings(): void {
  STORE.get(
    ["audioComp", "audioCompGain", "audioCompThreshold", "audioCompKnee",
     "audioCompRatio", "audioCompAttack", "audioCompRelease"],
    (r) => {
      reflectAudioUI({
        enabled: r.audioComp !== false,
        threshold: clampNum(r.audioCompThreshold, -100, 0, -60),
        knee: clampNum(r.audioCompKnee, 0, 40, 30),
        ratio: clampNum(r.audioCompRatio, 1, 20, 10),
        attack: clampNum(r.audioCompAttack, 0, 1, 0),
        release: clampNum(r.audioCompRelease, 0, 1, 1),
      });
      // Gain is reflected on its own — presets never touch it, so it isn't part
      // of the shared comp-params shape.
      setParam("acGain", "audioCompGain", clampNum(r.audioCompGain, 0, 24, 0));
    }
  );
}

// Audio writes are partial (one key here, several there). Merge them into one
// pending object so a later write can't clobber an earlier different-key write.
let pendingAudio: Record<string, unknown> = {};
let audioSaveTimer: ReturnType<typeof setTimeout> | undefined;
function saveAudio(obj: Record<string, unknown>): void {
  Object.assign(pendingAudio, obj);
  clearTimeout(audioSaveTimer);
  audioSaveTimer = setTimeout(() => {
    STORE.set(pendingAudio);
    pendingAudio = {};
  }, 350);
}

byId<HTMLInputElement>("audioCompToggle").addEventListener("change", (e) => {
  const checked = (e.target as HTMLInputElement).checked;
  STORE.set({ audioComp: checked });
  autoExpandOnFirstEnable(checked, "audioBody", "audioSeen");
});

const ADV: [string, string, number, number, number][] = [
  ["acThreshold", "audioCompThreshold", -100, 0, -60],
  ["acKnee", "audioCompKnee", 0, 40, 30],
  ["acRatio", "audioCompRatio", 1, 20, 10],
  ["acAttack", "audioCompAttack", 0, 1, 0],
  ["acRelease", "audioCompRelease", 0, 1, 1],
  ["acGain", "audioCompGain", 0, 24, 0],
];
ADV.forEach(([id, key, lo, hi, def]) => {
  byId<HTMLInputElement>(id).addEventListener("input", (e) => {
    const v = clampNum((e.target as HTMLInputElement).value, lo, hi, def);
    const out = document.getElementById(id + "Val");
    if (out) out.textContent = fmtParam(key, v);
    saveAudio({ [key]: v });
    syncPresetHighlight();
  });
});

function applyComp(name: PresetName): void {
  const p = PRESETS[name];
  reflectAudioUI({
    enabled: true,
    threshold: p.threshold, knee: p.knee, ratio: p.ratio, attack: p.attack, release: p.release,
  }, true);
  saveAudio({ ...compToStorage(p), audioComp: true });
  // Values settle on the profile after the glide; light it now. A later manual
  // drag re-runs syncPresetHighlight and clears it.
  document.querySelectorAll<HTMLElement>(".btn-preset").forEach((b) =>
    b.classList.toggle("active", b.dataset.preset === name));
  movePill(document.querySelector<HTMLElement>(".preset-row"));
}

document.querySelectorAll<HTMLElement>(".btn-preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    const name = btn.dataset.preset as PresetName;
    if (PRESETS[name]) applyComp(name);
  });
});
