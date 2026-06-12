// Audio compression settings (global, persisted in storage): the on/off toggle
// and the raw DynamicsCompressor params. These keys are exactly what the content
// script reads and applies.
import { STORE, clampNum } from "./env.js";
import { autoExpandOnFirstEnable } from "./sections.js";

// Default compressor settings, used for the initial state and the Reset button.
const AUDIO_DEFAULTS = {
  audioCompThreshold: -60,
  audioCompKnee: 30,
  audioCompRatio: 10,
  audioCompAttack: 0,
  audioCompRelease: 1,
  audioCompGain: 10,
};

// Format a compressor param for its slider readout.
function fmtParam(key, v) {
  v = Number(v);
  switch (key) {
    case "audioCompRatio": return v + ":1";
    case "audioCompAttack":
    case "audioCompRelease": return Math.round(v * 1000) + " ms";
    default: return v + " dB"; // threshold, knee, gain
  }
}

function setParam(id, key, value) {
  document.getElementById(id).value = value;
  const out = document.getElementById(id + "Val");
  if (out) out.textContent = fmtParam(key, value);
}

function reflectAudioUI(s) {
  document.getElementById("audioCompToggle").checked = s.enabled;
  setParam("acThreshold", "audioCompThreshold", s.threshold);
  setParam("acKnee", "audioCompKnee", s.knee);
  setParam("acRatio", "audioCompRatio", s.ratio);
  setParam("acAttack", "audioCompAttack", s.attack);
  setParam("acRelease", "audioCompRelease", s.release);
  setParam("acGain", "audioCompGain", s.gain);
}

export function loadAudioSettings() {
  STORE.get(
    ["audioComp", "audioCompGain", "audioCompThreshold", "audioCompKnee",
     "audioCompRatio", "audioCompAttack", "audioCompRelease"],
    (r) => {
      reflectAudioUI({
        enabled: r.audioComp !== false,
        gain: clampNum(r.audioCompGain, 0, 24, 10),
        threshold: clampNum(r.audioCompThreshold, -100, 0, -60),
        knee: clampNum(r.audioCompKnee, 0, 40, 30),
        ratio: clampNum(r.audioCompRatio, 1, 20, 10),
        attack: clampNum(r.audioCompAttack, 0, 1, 0),
        release: clampNum(r.audioCompRelease, 0, 1, 1),
      });
    }
  );
}

// Audio writes are partial (one key here, several there). Merge them into one
// pending object so a later write can't clobber an earlier different-key write.
let pendingAudio = {};
let audioSaveTimer = null;
function saveAudio(obj) {
  Object.assign(pendingAudio, obj);
  clearTimeout(audioSaveTimer);
  audioSaveTimer = setTimeout(() => {
    STORE.set(pendingAudio);
    pendingAudio = {};
  }, 350);
}

document.getElementById("audioCompToggle").addEventListener("change", (e) => {
  STORE.set({ audioComp: e.target.checked });
  autoExpandOnFirstEnable(e.target.checked, "audioBody", "audioSeen");
});

// Each compressor param input writes its own storage key directly.
const ADV = [
  ["acThreshold", "audioCompThreshold", -100, 0, -60],
  ["acKnee", "audioCompKnee", 0, 40, 30],
  ["acRatio", "audioCompRatio", 1, 20, 10],
  ["acAttack", "audioCompAttack", 0, 1, 0],
  ["acRelease", "audioCompRelease", 0, 1, 1],
  ["acGain", "audioCompGain", 0, 24, 0],
];
ADV.forEach(([id, key, lo, hi, def]) => {
  document.getElementById(id).addEventListener("input", (e) => {
    const v = clampNum(e.target.value, lo, hi, def);
    const out = document.getElementById(id + "Val");
    if (out) out.textContent = fmtParam(key, v);
    saveAudio({ [key]: v });
  });
});

// Reset all compressor parameters to the defaults.
document.getElementById("audioReset").addEventListener("click", () => {
  reflectAudioUI({
    enabled: document.getElementById("audioCompToggle").checked,
    threshold: AUDIO_DEFAULTS.audioCompThreshold,
    knee: AUDIO_DEFAULTS.audioCompKnee,
    ratio: AUDIO_DEFAULTS.audioCompRatio,
    attack: AUDIO_DEFAULTS.audioCompAttack,
    release: AUDIO_DEFAULTS.audioCompRelease,
    gain: AUDIO_DEFAULTS.audioCompGain,
  });
  saveAudio(Object.assign({}, AUDIO_DEFAULTS));
});
