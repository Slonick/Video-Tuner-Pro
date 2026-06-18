// Video Tuner Pro — background (Chrome service worker / Firefox event page)
// Per tab:
//   • speed is shown in the native toolbar badge (setBadgeText) — bigger/clearer;
//   • the icon's play triangle is white normally, red on a live stream
//     (we swap between the white and red icon PNGs);
//   • no video / navigation -> default icon, no badge.
import { STORE, whenReady } from "../shared/store.js";

const api = typeof browser !== "undefined" ? browser : chrome;

const DEFAULT_ICON = {
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
  48: "icons/icon-48.png",
  128: "icons/icon-128.png",
};
const RED_ICON = {
  16: "icons/icon-red-16.png",
  32: "icons/icon-red-32.png",
  48: "icons/icon-red-48.png",
  128: "icons/icon-red-128.png",
};

// On Chrome MV3 these action APIs return a Promise that rejects asynchronously
// when the tab is already gone ("No tab with id …"); a plain try/catch only
// swallows a synchronous throw, so also absorb the async rejection.
function call(fn: () => unknown): void {
  try {
    const r = fn() as { catch?: (cb: () => void) => void } | undefined;
    if (r && typeof r.catch === "function") r.catch(() => {});
  } catch (e) {
    /* tab gone */
  }
}

function reset(tabId?: number): void {
  call(() => api.action.setBadgeText({ text: "", tabId }));
  call(() => api.action.setIcon({ path: DEFAULT_ICON, tabId }));
}

api.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.action !== "icon" || !sender.tab) return;
  const tabId = sender.tab.id;
  if (msg.clear) {
    reset(tabId);
    return;
  }
  call(() => api.action.setBadgeText({ text: msg.text || "", tabId }));
  call(() => api.action.setBadgeBackgroundColor({ color: "#0a84ff", tabId }));
  if (api.action.setBadgeTextColor) {
    call(() => api.action.setBadgeTextColor({ color: "#ffffff", tabId }));
  }
  call(() => api.action.setIcon({ path: msg.live ? RED_ICON : DEFAULT_ICON, tabId }));
});

// Clear badge + restore default icon when a tab starts navigating, so stale state
// from the previous page doesn't linger before the new content script reports.
if (api.tabs && api.tabs.onUpdated) {
  api.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === "loading") reset(tabId);
  });
}

// On reload/update the content scripts already running in open tabs are orphaned
// (their extension context is dead) and the browser won't re-inject until the page
// navigates — so the page silently stops responding to the popup/shortcuts until a
// manual refresh. Re-inject the isolated content script into every open http(s) tab
// so it keeps working without a refresh. (The MAIN-world latency probe is plain
// page JS with no extension dependency, so it survives the reload and isn't
// re-injected; the fresh content script removes any leftover badge and the old
// instance tears itself down on its next tick.)
if (api.runtime && api.runtime.onInstalled && api.scripting && api.tabs) {
  api.runtime.onInstalled.addListener(() => {
    call(() =>
      api.tabs.query({ url: ["http://*/*", "https://*/*"] }, (tabs) => {
        for (const tab of tabs || []) {
          if (tab.id == null) continue;
          call(() =>
            api.scripting.executeScript({
              target: { tabId: tab.id as number, allFrames: true },
              files: ["content.js"],
            }),
          );
        }
      }),
    );
  });
}

// First-run seeding: persist the shipped global defaults — playback speed 100%
// and the live-sync allowed delay (5s) — so the "global" scope is a real, saved
// value instead of an implicit code fallback. Routed through STORE so each key
// lands in the area its category syncs to, and only written when absent so it
// never clobbers an existing (or already-synced) value. syncTargetGlobal also
// defers to the legacy `liveSyncTarget` global, which loadSpeed still honours.
if (api.runtime && api.runtime.onInstalled) {
  api.runtime.onInstalled.addListener(() => {
    whenReady(() => {
      STORE.get(["globalSpeed", "syncTargetGlobal", "liveSyncTarget"], (r) => {
        const seed: Record<string, unknown> = {};
        if (r.globalSpeed == null) seed.globalSpeed = 1.0; // 100%
        if (r.syncTargetGlobal == null && r.liveSyncTarget == null) seed.syncTargetGlobal = 5; // seconds
        if (Object.keys(seed).length) STORE.set(seed);
      });
    });
  });
}

// One-time migration: copy any pre-existing device-local settings into synced
// storage (only if sync has none yet), so upgrading users keep their settings.
if (api.runtime && api.runtime.onInstalled && api.storage && api.storage.sync) {
  api.runtime.onInstalled.addListener(() => {
    api.storage.sync.get(["domains", "liveSync"], (s) => {
      if (s && (s.domains || s.liveSync != null)) return; // already synced
      api.storage.local.get(["domains", "liveSync", "liveSyncTarget", "liveSyncMax"], (l) => {
        const copy: Record<string, unknown> = {};
        for (const k of ["domains", "liveSync", "liveSyncTarget", "liveSyncMax"]) {
          if (l[k] !== undefined) copy[k] = l[k];
        }
        if (Object.keys(copy).length) api.storage.sync.set(copy);
      });
    });
  });
}
