// Each imported module registers its own DOM listeners as a load-time side effect.
import { api } from "./platform/browser.js";
import { STORE } from "./platform/storage.js";
import { byId } from "./dom.js";
import { localize } from "./i18n.js";
import "./sections.js";
import { init, pollSpeed } from "./speed.js";
import { loadSyncSettings } from "./live-sync.js";
import { loadAudioSettings } from "./audio-settings.js";
import { setupGraphs } from "./graphs/index.js";

localize();
init();
loadSyncSettings();
loadAudioSettings();

byId("extVersion").textContent = "v" + api.runtime.getManifest().version;

// Badge/keyboard toggles default to on; Super theater (YouTube) defaults off.
STORE.get(["showRemaining", "streamBadge", "keyboard", "superTheater"], (r) => {
  byId<HTMLInputElement>("onVideoToggle").checked = r.showRemaining !== false;
  byId<HTMLInputElement>("onStreamToggle").checked = r.streamBadge !== false;
  byId<HTMLInputElement>("kbdToggle").checked = r.keyboard !== false;
  byId<HTMLInputElement>("superTheaterToggle").checked = r.superTheater === true;
});
byId<HTMLInputElement>("onVideoToggle").addEventListener("change", (e) => {
  STORE.set({ showRemaining: (e.target as HTMLInputElement).checked });
});
byId<HTMLInputElement>("onStreamToggle").addEventListener("change", (e) => {
  STORE.set({ streamBadge: (e.target as HTMLInputElement).checked });
});
byId<HTMLInputElement>("kbdToggle").addEventListener("change", (e) => {
  STORE.set({ keyboard: (e.target as HTMLInputElement).checked });
});
byId<HTMLInputElement>("superTheaterToggle").addEventListener("change", (e) => {
  STORE.set({ superTheater: (e.target as HTMLInputElement).checked });
});

setupGraphs();

// Poll the page every second so live-sync speed changes show in the readout.
setInterval(pollSpeed, 1000);
