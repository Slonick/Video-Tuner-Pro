// Each imported module registers its own DOM listeners as a load-time side effect.
import { STORE } from "./platform/storage.js";
import { byId } from "./dom.js";
import { localize } from "./i18n.js";
import "./sections.js";
import { init } from "./speed.js";
import { loadSyncSettings } from "./live-sync.js";
import { loadAudioSettings } from "./audio-settings.js";
import { setupGraphs } from "./graphs/index.js";

localize();
init();
loadSyncSettings();
loadAudioSettings();

// On-video badge toggles default to on (hence the !== false checks).
STORE.get(["showRemaining", "streamBadge"], (r) => {
  byId<HTMLInputElement>("onVideoToggle").checked = r.showRemaining !== false;
  byId<HTMLInputElement>("onStreamToggle").checked = r.streamBadge !== false;
});
byId<HTMLInputElement>("onVideoToggle").addEventListener("change", (e) => {
  STORE.set({ showRemaining: (e.target as HTMLInputElement).checked });
});
byId<HTMLInputElement>("onStreamToggle").addEventListener("change", (e) => {
  STORE.set({ streamBadge: (e.target as HTMLInputElement).checked });
});

setupGraphs();
