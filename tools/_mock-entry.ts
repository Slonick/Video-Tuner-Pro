// Browser entry: installs window.chrome from the mock before popup.js runs.
// esbuild bundles this for the screenshot harness; the scenario name + locale
// messages are injected by the harness via globals on the page.
import { createMockChrome } from "../test/mocks/chrome.js";
import { scenario } from "../test/mocks/scenarios.js";
import type { ScenarioName } from "../test/mocks/scenarios.js";

declare global {
  interface Window {
    __SCENARIO__?: ScenarioName;
    __MESSAGES__?: Record<string, { message: string }>;
    __VERSION__?: string;
    __THEME__?: string;
  }
}

const name = window.__SCENARIO__ || "audio";
const messages = window.__MESSAGES__ || {};
const data = scenario(name);
// Force the palette by seeding the saved theme the popup reads (initTheme), so the
// data-theme attribute — not the OS prefers-color-scheme — decides the colours.
const theme = window.__THEME__;
if (theme === "light" || theme === "dark") data.settings = { ...data.settings, theme };
(window as unknown as { chrome: typeof chrome }).chrome =
  createMockChrome({ ...data, messages, version: window.__VERSION__ });
