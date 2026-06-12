// Video Tuner Pro — background (Chrome service worker / Firefox event page)
// Per tab:
//   • speed is shown in the native toolbar badge (setBadgeText) — bigger/clearer;
//   • the icon's play triangle is white normally, red on a live stream
//     (we swap between the white and red icon PNGs);
//   • no video / navigation -> default icon, no badge.
const api = (typeof browser !== "undefined") ? browser : chrome;

const DEFAULT_ICON = {
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
  48: "icons/icon-48.png",
  128: "icons/icon-128.png"
};
const RED_ICON = {
  16: "icons/icon-red-16.png",
  32: "icons/icon-red-32.png",
  48: "icons/icon-red-48.png",
  128: "icons/icon-red-128.png"
};

function reset(tabId) {
  try {
    api.action.setBadgeText({ text: "", tabId });
    api.action.setIcon({ path: DEFAULT_ICON, tabId });
  } catch (e) { /* tab gone */ }
}

api.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.action !== "icon" || !sender.tab) return;
  const tabId = sender.tab.id;
  if (msg.clear) { reset(tabId); return; }
  try {
    api.action.setBadgeText({ text: msg.text || "", tabId });
    api.action.setBadgeBackgroundColor({ color: "#0a84ff", tabId });
    if (api.action.setBadgeTextColor) {
      api.action.setBadgeTextColor({ color: "#ffffff", tabId });
    }
    api.action.setIcon({ path: msg.live ? RED_ICON : DEFAULT_ICON, tabId });
  } catch (e) { /* tab gone */ }
});

// Clear badge + restore default icon when a tab starts navigating, so stale state
// from the previous page doesn't linger before the new content script reports.
if (api.tabs && api.tabs.onUpdated) {
  api.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === "loading") reset(tabId);
  });
}

// One-time migration: copy any pre-existing device-local settings into synced
// storage (only if sync has none yet), so upgrading users keep their settings.
if (api.runtime && api.runtime.onInstalled && api.storage && api.storage.sync) {
  api.runtime.onInstalled.addListener(() => {
    api.storage.sync.get(["domains", "liveSync"], (s) => {
      if (s && (s.domains || s.liveSync != null)) return; // already synced
      api.storage.local.get(
        ["domains", "liveSync", "liveSyncTarget", "liveSyncMax"],
        (l) => {
          const copy = {};
          for (const k of ["domains", "liveSync", "liveSyncTarget", "liveSyncMax"]) {
            if (l[k] !== undefined) copy[k] = l[k];
          }
          if (Object.keys(copy).length) api.storage.sync.set(copy);
        }
      );
    });
  });
}
