// Each imported module registers its own DOM listeners as a load-time side effect.
import { api } from "./platform/browser.js";
import { STORE, whenReady } from "./platform/storage.js";
import { byId } from "./dom.js";
import { localize, loadLang } from "./i18n.js";
import { initTheme } from "../shared/theme.js";
import "./sections.js";
import { init, pollSpeed } from "./speed.js";
import { loadSyncSettings } from "./live-sync.js";
import { loadAudioSettings, loadCompPresets } from "./audio-settings.js";
import { setupGraphs } from "./graphs/index.js";

initTheme();
localize();
byId("extVersion").textContent = "v" + api.runtime.getManifest().version;

// Gear button → open the full settings (options) page in a tab.
byId("openOptions").addEventListener("click", () => api.runtime.openOptionsPage());

// Wait for the selective-sync config so each setting is read from the area it
// actually lives in (an opted-out category is in local, not sync), then apply the
// saved language before building anything that renders localized text.
whenReady(() => {
  loadLang(() => {
    localize();
    init();
    loadSyncSettings();
    loadAudioSettings();
    loadCompPresets();   // edited preset values/names (after localize, so a custom name wins)

    // Badge/keyboard toggles default to on; Super theater (YouTube) defaults off.
    STORE.get(["showRemaining", "streamBadge", "keyboard", "superTheater"], (r) => {
      byId<HTMLInputElement>("onVideoToggle").checked = r.showRemaining !== false;
      byId<HTMLInputElement>("onStreamToggle").checked = r.streamBadge !== false;
      byId<HTMLInputElement>("kbdToggle").checked = r.keyboard !== false;
      byId<HTMLInputElement>("superTheaterToggle").checked = r.superTheater === true;
    });
  });
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
