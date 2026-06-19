// Options page entry. Apply the theme right away, then — once the selective-sync
// config has loaded and the saved language is applied — render the React app so
// every section reads from the right storage area in the chosen language.
import { createRoot } from "react-dom/client";
import { loadLang, msg } from "../popup/i18n.js";
import { whenReady } from "../shared/store.js";
import { initTheme } from "../shared/theme.js";
import { General } from "./sections/General.js";
import { Keys } from "./sections/Keys.js";
import { SpeedPresets } from "./sections/SpeedPresets.js";
import { Presets } from "./sections/Presets.js";
import { Saved } from "./sections/Saved.js";
import { Sync } from "./sections/Sync.js";
import { AutoSlow } from "./sections/AutoSlow.js";

function Options() {
  return (
    <main className="wrap">
      <header className="opt-header">
        <h1>
          <span>{msg("appHeader") || "Video Tuner"}</span>
          <span className="pro-badge">PRO</span>
        </h1>
        <span className="opt-subtitle">{msg("optHeader") || "Settings"}</span>
      </header>
      <div className="opt-grid">
        <div className="opt-col opt-col-6">
          <General />
        </div>
        <div className="opt-col opt-col-6">
          <Keys />
        </div>
        <div className="opt-col opt-col-12">
          <SpeedPresets />
        </div>
        <div className="opt-col opt-col-12">
          <Presets />
        </div>
        <div className="opt-col opt-col-12">
          <AutoSlow />
        </div>
        <div className="opt-col opt-col-6">
          <Sync />
        </div>
        <div className="opt-col opt-col-6">
          <Saved />
        </div>
      </div>
    </main>
  );
}

initTheme();
whenReady(() => {
  loadLang(() => {
    document.title = msg("optPageTitle") || "Video Tuner Pro — Settings";
    createRoot(document.getElementById("root")!).render(<Options />);
  });
});
