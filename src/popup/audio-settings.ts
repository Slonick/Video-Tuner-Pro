// These storage keys are exactly what the content script reads and applies.
import { STORE } from "./platform/storage.js";
import { clampNum } from "./core/clamp.js";
import { byId } from "./dom.js";
import { autoExpandOnFirstEnable } from "./sections.js";
import { COMP_PRESETS, compToStorage, type CompParams, type PresetName } from "./audio-presets.js";

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

function setParam(id: string, key: string, value: number): void {
  byId<HTMLInputElement>(id).value = String(value);
  const out = document.getElementById(id + "Val");
  if (out) out.textContent = fmtParam(key, value);
}

function reflectAudioUI(s: AudioUI): void {
  byId<HTMLInputElement>("audioCompToggle").checked = s.enabled;
  setParam("acThreshold", "audioCompThreshold", s.threshold);
  setParam("acKnee", "audioCompKnee", s.knee);
  setParam("acRatio", "audioCompRatio", s.ratio);
  setParam("acAttack", "audioCompAttack", s.attack);
  setParam("acRelease", "audioCompRelease", s.release);
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
  });
});

function applyComp(p: CompParams): void {
  reflectAudioUI({ enabled: true, ...p });
  saveAudio({ ...compToStorage(p), audioComp: true });
}

document.querySelectorAll<HTMLElement>(".btn-preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    const p = COMP_PRESETS[btn.dataset.preset as PresetName];
    if (p) applyComp(p);
  });
});
