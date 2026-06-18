// Popup entry. Apply the theme, then — once the selective-sync config has loaded
// and the saved language is applied — render the React app (so msg() returns text
// in the chosen language during the first render).
import { createRoot } from "react-dom/client";
import { whenReady } from "./platform/storage.js";
import { loadLang } from "./i18n.js";
import { initTheme } from "../shared/theme.js";
import { App } from "./components/App.js";

initTheme();
whenReady(() => {
  loadLang(() => {
    createRoot(document.getElementById("root")!).render(<App />);
  });
});
