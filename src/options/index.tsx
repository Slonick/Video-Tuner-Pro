// Options page entry. Apply the theme right away, then — once the selective-sync
// config has loaded and the saved language is applied — render the React app so
// every section reads from the right storage area in the chosen language.
//
// Layout mirrors macOS System Settings: a sidebar of grouped sections on the left,
// the selected group's cards on the right. The eight cards collapse into four nav
// groups (General / Speed / Audio / Data) so the list stays short. Every pane stays
// mounted (just hidden) — sections load from storage on mount and we don't want to
// re-run that on each tab switch, and e2e drives controls across panes.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { GlassBackdrop } from "../ui/GlassBackdrop.js";
import {
  ensureGlassFilter,
  applyGlassOpacity,
  clampGlassOpacity,
  GLASS_OPACITY_KEY,
} from "../shared/glass.js";
import { loadLang, msg } from "../popup/i18n.js";
import { whenReady, STORE } from "../shared/store.js";
import { initTheme } from "../shared/theme.js";
import { General } from "./sections/General.js";
import { Keys } from "./sections/Keys.js";
import { SpeedPresets } from "./sections/SpeedPresets.js";
import { Presets } from "./sections/Presets.js";
import { Saved } from "./sections/Saved.js";
import { Sync } from "./sections/Sync.js";
import { AutoSlow } from "./sections/AutoSlow.js";
import { LiveSync } from "./sections/LiveSync.js";
import { ViewerChat } from "./sections/ViewerChat.js";
import { NavGeneral, NavSpeed, NavAudio, NavData } from "./nav-icons.js";

interface Group {
  id: string;
  labelKey: string;
  labelFallback: string;
  Icon: () => React.ReactElement;
  Pane: () => React.ReactElement;
}

const GROUPS: Group[] = [
  {
    id: "general",
    labelKey: "optNavGeneral",
    labelFallback: "General",
    Icon: NavGeneral,
    Pane: () => (
      <>
        <General />
        <ViewerChat />
      </>
    ),
  },
  {
    id: "speed",
    labelKey: "optNavSpeed",
    labelFallback: "Speed",
    Icon: NavSpeed,
    Pane: () => (
      <>
        <Keys />
        <SpeedPresets />
        <LiveSync />
      </>
    ),
  },
  {
    id: "audio",
    labelKey: "optNavAudio",
    labelFallback: "Audio",
    Icon: NavAudio,
    Pane: () => (
      <>
        <AutoSlow />
        <Presets />
      </>
    ),
  },
  {
    id: "data",
    labelKey: "optNavData",
    labelFallback: "Data & sync",
    Icon: NavData,
    Pane: () => (
      <>
        <Sync />
        <Saved />
      </>
    ),
  },
];

function Options() {
  const [active, setActive] = useState(GROUPS[0].id);
  return (
    <>
      <GlassBackdrop />
      <div className="opt-shell">
        <aside className="opt-sidebar">
          <div className="opt-brand">
            <span className="opt-brand-name">{msg("appHeader") || "Video Tuner"}</span>
            <span className="pro-badge">PRO</span>
          </div>
          <nav className="opt-nav">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                id={"nav-" + g.id}
                type="button"
                className={"opt-nav-item" + (active === g.id ? " is-active" : "")}
                aria-current={active === g.id ? "page" : undefined}
                onClick={() => setActive(g.id)}
              >
                <span className="opt-nav-icon">
                  <g.Icon />
                </span>
                {msg(g.labelKey) || g.labelFallback}
              </button>
            ))}
          </nav>
        </aside>
        <main className="opt-content">
          {GROUPS.map((g) => (
            <div key={g.id} id={"pane-" + g.id} className="opt-pane" hidden={active !== g.id}>
              <header className="opt-content-header">
                <span className="opt-content-icon">
                  <g.Icon />
                </span>
                <h1>{msg(g.labelKey) || g.labelFallback}</h1>
              </header>
              <g.Pane />
            </div>
          ))}
        </main>
      </div>
    </>
  );
}

initTheme();
whenReady(() => {
  loadLang(() => {
    document.title = msg("optPageTitle") || "Video Tuner Pro — Settings";
    ensureGlassFilter(document);
    STORE.get([GLASS_OPACITY_KEY], (r) =>
      applyGlassOpacity(document.documentElement, clampGlassOpacity(r[GLASS_OPACITY_KEY])),
    );
    createRoot(document.getElementById("root")!).render(<Options />);
  });
});
