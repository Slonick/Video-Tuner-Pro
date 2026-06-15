// Options page entry. Apply the theme and localize the static markup right away,
// then — once the selective-sync config has loaded and the saved language is
// applied — build each section in that language and from the right storage area.
import { localize, loadLang } from "../popup/i18n.js";
import { whenReady } from "../shared/store.js";
import { initTheme } from "../shared/theme.js";
import { initAppearance } from "./appearance.js";
import { initKeys } from "./keys.js";
import { initPresets } from "./presets.js";
import { initSaved } from "./saved.js";
import { initSync } from "./sync.js";
import { initBackup } from "./backup.js";

initTheme();
localize();
whenReady(() => {
  loadLang(() => {
    localize();
    initAppearance();
    initKeys();
    initPresets();
    initSaved();
    initSync();
    initBackup();
  });
});
