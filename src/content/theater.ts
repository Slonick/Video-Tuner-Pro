// "Super theater" (YouTube only). When on, YouTube's theater mode fills the whole
// window: the player goes 100vh and the masthead tucks away (revealing on hover).
// We only toggle the html[vtp-super-theater] gate; the CSS below (adapted from
// Iridium, which is open source) does the rest, and only ever matches while
// YouTube itself is in theater / full-bleed mode.
import { api } from "./platform/browser.js";
import { STORE, OUR_AREAS } from "./platform/storage.js";
import { onStreamPage } from "./live/detection.js";

const ATTR = "vtp-super-theater";

const CSS = `
html[${ATTR}] #masthead-container.ytd-app:has(> [theater][is-watch-page]) #masthead {
  transform: translateY(-100%);
  transition: transform .5s ease-out !important;
}
html[${ATTR}] #masthead-container.ytd-app:has(> [theater][is-watch-page]):hover #masthead {
  transform: translateY(0);
}
html[${ATTR}] ytd-watch-flexy[full-bleed-player]:not([hidden]) #full-bleed-container.ytd-watch-flexy,
html[${ATTR}] ytd-watch-grid[full-bleed-player]:not([hidden]) #player-full-bleed-container.ytd-watch-grid {
  max-height: 100vh;
  height: 100vh;
  min-height: unset;
}
html[${ATTR}] #page-manager.ytd-app:has(> [theater]:not([hidden])) {
  margin-top: 0;
}
html[${ATTR}] #player-full-bleed-container {
  display: flex;
  flex-direction: row;
}
html[${ATTR}] #player-full-bleed-container #player-container {
  position: relative;
  flex: 1;
}
html[${ATTR}] #page-manager.ytd-app:has(> [theater]:not([hidden])) #chat-container {
  position: relative;
}
html[${ATTR}] #page-manager.ytd-app:has(> [theater]:not([hidden])) ytd-live-chat-frame {
  height: 100% !important;
  min-height: unset !important;
  top: unset !important;
}
`;

function isYouTube(): boolean {
  return /(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname);
}

let styleEl: HTMLStyleElement | null = null;
function ensureStyle(): void {
  if (styleEl) return;
  styleEl = document.createElement("style");
  styleEl.textContent = CSS;
  (document.head || document.documentElement).appendChild(styleEl);
}

export function applySuperTheater(on: boolean): void {
  if (!isYouTube()) return;
  ensureStyle();
  document.documentElement.toggleAttribute(ATTR, on);
}

// Streams and regular videos each have their own super-theater setting, so a
// live page can keep the chat visible while videos stay full-bleed. Pick the one
// that matches the current page.
function effectiveKey(): "superTheater" | "superTheaterStream" {
  return onStreamPage() ? "superTheaterStream" : "superTheater";
}
function reapply(): void {
  const key = effectiveKey();
  STORE.get([key], (r) => applySuperTheater(r[key] === true));
}

if (isYouTube()) {
  reapply();
  // The live-state flag (data-vtp-live, set by the MAIN-world probe) lands a beat
  // after load and flips on SPA navigation between a video and a live page — so
  // re-pick the setting whenever it changes.
  new MutationObserver(reapply).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-vtp-live"],
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (!OUR_AREAS.has(area)) return;
    if (changes.superTheater || changes.superTheaterStream) reapply();
  });
}
