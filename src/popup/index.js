// Video Tuner Pro — popup entry (Chrome + Firefox).
// Each imported module registers its own DOM listeners on load; this file just
// kicks off localization, the initial loads, and the live graphs.
import { STORE } from "./env.js";
import { localize } from "./i18n.js";
import "./sections.js";                                  // section toggle / scroll / tooltips
import { init } from "./speed.js";                       // + speed controls and the readout poll
import { loadSyncSettings } from "./live-sync.js";       // + live-sync settings listeners
import { loadAudioSettings } from "./audio-settings.js"; // + compressor settings listeners
import { setupGraphs } from "./graphs.js";

localize();
init();
loadSyncSettings();
loadAudioSettings();

// Show speed + remaining time on the video (default on).
STORE.get(["showRemaining"], (r) => {
  document.getElementById("onVideoToggle").checked = r.showRemaining !== false;
});
document.getElementById("onVideoToggle").addEventListener("change", (e) => {
  STORE.set({ showRemaining: e.target.checked });
});

setupGraphs();
