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
  }
}

const name = window.__SCENARIO__ || "audio";
const messages = window.__MESSAGES__ || {};
(window as unknown as { chrome: typeof chrome }).chrome = createMockChrome({ ...scenario(name), messages });
