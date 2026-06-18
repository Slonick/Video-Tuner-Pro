// Selective-sync controls: a master switch in the card header over a per-category
// list. The master turns cross-device sync off entirely (everything stays on this
// device); each category switch routes that group between sync and local.
import { useState } from "react";
import {
  getSyncConfig,
  getSyncMaster,
  setCategorySync,
  setMasterSync,
} from "../../shared/store.js";
import { CATEGORIES, type Category } from "../../shared/sync-config.js";
import { msg } from "../../popup/i18n.js";
import { Switch } from "../../ui/Switch.js";

const LABEL_KEY: Record<Category, string> = {
  speeds: "catSpeeds",
  delays: "catDelays",
  audio: "catAudio",
  shortcuts: "catShortcuts",
  general: "catGeneral",
};
const DESC_KEY: Record<Category, string> = {
  speeds: "catSpeedsDesc",
  delays: "catDelaysDesc",
  audio: "catAudioDesc",
  shortcuts: "catShortcutsDesc",
  general: "catGeneralDesc",
};

export function Sync() {
  // The sync config is loaded synchronously from the cached store (the entry waits
  // for whenReady before mounting), so initial state can read it directly.
  const [cfg, setCfg] = useState(() => getSyncConfig());
  const [master, setMaster] = useState(() => getSyncMaster());

  const toggleCat = (cat: Category, on: boolean) => {
    setCfg({ ...cfg, [cat]: on });
    setCategorySync(cat, on);
  };
  const toggleMaster = (on: boolean) => {
    setMaster(on);
    setMasterSync(on);
  };

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{msg("optSyncTitle") || "Sync"}</h2>
          <p className="card-desc">{msg("optSyncDesc")}</p>
        </div>
        <span id="syncMaster">
          <Switch checked={master} onChange={toggleMaster} />
        </span>
      </div>
      <div className={"sync-rows" + (master ? "" : " is-off")} id="syncRows">
        {CATEGORIES.map((cat) => (
          <div className="sync-cat-row" key={cat}>
            <div className="sync-cat-text">
              <span className="sync-cat-label">{msg(LABEL_KEY[cat]) || cat}</span>
              <span className="sync-cat-desc">{msg(DESC_KEY[cat])}</span>
            </div>
            <Switch checked={cfg[cat]} disabled={!master} onChange={(on) => toggleCat(cat, on)} />
          </div>
        ))}
      </div>
    </section>
  );
}
