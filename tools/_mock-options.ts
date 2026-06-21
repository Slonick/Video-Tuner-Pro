// Browser entry for the options-page screenshot harness: installs window.chrome
// from the mock before options.js runs. Messages/version/theme come from globals
// the harness injects on the page.
import { createMockChrome } from "../test/mocks/chrome.js";

declare global {
  interface Window {
    __MESSAGES__?: Record<string, { message: string }>;
    __VERSION__?: string;
    __THEME__?: string;
    __GLASS__?: string;
  }
}

const messages = window.__MESSAGES__ || {};
const theme = window.__THEME__;
const settings: Record<string, unknown> = {
  theme: theme === "dark" || theme === "light" ? theme : "system",
  overlayButton: "always",
  globalSpeed: 1.5,
  domains: { "example.com": 2 },
  glassOpacity: Number(window.__GLASS__) || 1,
};
(window as unknown as { chrome: typeof chrome }).chrome = createMockChrome({
  messages,
  settings,
  version: window.__VERSION__,
});
// Apply the glass-opacity multiplier up front so the harness can preview any value.
document.documentElement.style.setProperty(
  "--glass-opacity",
  String(Number(window.__GLASS__) || 1),
);
