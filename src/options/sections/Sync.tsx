// Selective-sync controls: a master switch as the first row (with its description)
// over a per-category list. The master turns cross-device sync off entirely
// (everything stays on this device); each category switch routes that group between
// sync and local.
import { useState } from "react";
import {
  getSyncConfig,
  getSyncMaster,
  setCategorySync,
  setMasterSync,
} from "../../shared/store.js";
import { CATEGORIES, type Category } from "../../shared/sync-config.js";
import { msg } from "../../popup/i18n.js";
import { Group } from "../Group.js";
import { Backup } from "./General.js";
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
    setCfg((current) => ({ ...current, [cat]: on }));
    setCategorySync(cat, on, (ok) => {
      if (ok === false) setCfg(getSyncConfig());
    });
  };
  const toggleMaster = (on: boolean) => {
    setMaster(on);
    setMasterSync(on, (ok) => {
      if (ok === false) setMaster(getSyncMaster());
    });
  };

  return (
    <Group head={<h2 className="opt-group-title">{msg("optSyncTitle") || "Sync"}</h2>}>
      <div className="sync-cat-row" id="syncMaster">
        <div className="sync-cat-text">
          <span className="sync-cat-label">{msg("optSyncMaster") || "Enable sync"}</span>
          <span className="sync-cat-desc">{msg("optSyncDesc")}</span>
        </div>
        <Switch
          checked={master}
          onChange={toggleMaster}
          ariaLabel={msg("optSyncMaster") || "Enable sync"}
        />
      </div>
      <div className={"sync-rows" + (master ? "" : " is-off")} id="syncRows">
        {CATEGORIES.map((cat) => (
          <div className="sync-cat-row" key={cat}>
            <div className="sync-cat-text">
              <span className="sync-cat-label">{msg(LABEL_KEY[cat]) || cat}</span>
              <span className="sync-cat-desc">{msg(DESC_KEY[cat])}</span>
            </div>
            <Switch
              checked={cfg[cat]}
              disabled={!master}
              onChange={(on) => toggleCat(cat, on)}
              ariaLabel={msg(LABEL_KEY[cat]) || cat}
            />
          </div>
        ))}
      </div>
      <div className="sync-cat-row sync-backup-row">
        <span className="sync-cat-label">{msg("optBackupTitle") || "Backup"}</span>
        <Backup />
      </div>
    </Group>
  );
}
