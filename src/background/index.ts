// Video Tuner Pro — background (Chrome service worker / Firefox event page)
// Per tab:
//   • speed is shown in the native toolbar badge (setBadgeText) — bigger/clearer;
//   • the icon's play triangle is white normally, red on a live stream
//     (we swap between the white and red icon PNGs);
//   • no video / navigation -> default icon, no badge.
import { STORE, whenReady } from "../shared/store.js";
import {
  STORED_MAP_NAMES,
  safeKey,
  validPosition,
  validStoredMapValue,
  type StoredMapMutation,
  type StoredMapName,
} from "../shared/map-mutation.js";
import {
  UPDATE_AVAILABLE_KEY,
  UPDATE_LATEST_KEY,
  UPDATE_ALARM,
  UPDATE_PERIOD_MIN,
  hasUpdateApi,
  cmpVersion,
  currentVersion,
  fetchAmoLatest,
} from "../shared/update.js";
import { getExtensionApi } from "../shared/extension-api.js";
import { hasSponsorDataConsent } from "../shared/sponsor-consent.js";
import { initDevReload } from "./dev-reload.js";

void initDevReload();

const api = getExtensionApi();

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
// Which frame drives each tab's toolbar badge, mirrored into storage.session: the
// worker is unloaded when idle, and one that forgot the owner would let any frame,
// e.g. an ad iframe, take over the badge.
const BADGE_OWNERS_KEY = "badgeOwners";
const badgeOwners = new Map<number, number>();
let badgeOwnersLoaded = false;
const badgeOwnersWaiters: Array<() => void> = [];
const videoFrameOwners = new Map<number, { frameId?: number; expires: number }>();
const VIDEO_FRAME_CACHE_MS = 5000;
const VIDEO_FRAME_MISS_CACHE_MS = 1500;

interface VideoFrameProbe {
  hasVideo?: boolean;
  score?: number;
}

const storedMapNames = new Set<unknown>(STORED_MAP_NAMES);
const storedMapQueues = new Map<StoredMapName, Promise<void>>();

function validStoredMapMutation(raw: Record<string, unknown>): Required<StoredMapMutation> | null {
  if (!storedMapNames.has(raw.map)) return null;
  const map = raw.map as StoredMapName;
  const set: Record<string, unknown> = {};
  if (raw.set && typeof raw.set === "object") {
    for (const [key, value] of Object.entries(raw.set as Record<string, unknown>)) {
      if (safeKey(key) && validStoredMapValue(map, value)) {
        // A dragged spot needs no more than sub-pixel precision, while a raw double
        // costs ~18 characters per axis in a per-site map that must fit one 8 KB item.
        set[key] = validPosition(value)
          ? {
              ...value,
              fx: Math.round(value.fx * 1e4) / 1e4,
              fy: Math.round(value.fy * 1e4) / 1e4,
            }
          : value;
      }
    }
  }
  const remove = Array.isArray(raw.remove)
    ? raw.remove.filter((key): key is string => typeof key === "string" && safeKey(key))
    : [];
  const clear = raw.clear === true;
  if (!clear && !Object.keys(set).length && !remove.length) return null;
  return { map, set, remove, clear };
}

function mutateStoredMap(mutation: Required<StoredMapMutation>): Promise<boolean> {
  const run = () =>
    new Promise<boolean>((resolve) => {
      whenReady(() => {
        if (mutation.clear) {
          STORE.remove(mutation.map, (ok) => resolve(ok !== false));
          return;
        }
        STORE.get([mutation.map], (result) => {
          const current = { ...(result[mutation.map] as Record<string, number>) };
          for (const key of mutation.remove) delete current[key];
          Object.assign(current, mutation.set);
          const finish = (ok?: boolean) => resolve(ok !== false);
          if (Object.keys(current).length) STORE.set({ [mutation.map]: current }, finish);
          else STORE.remove(mutation.map, finish);
        });
      });
    });
  const queue = storedMapQueues.get(mutation.map) || Promise.resolve();
  const result = queue.then(run);
  storedMapQueues.set(
    mutation.map,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

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

function loadBadgeOwners(): void {
  const done = (saved?: unknown) => {
    if (saved) {
      for (const [tabId, frameId] of Object.entries(saved)) {
        if (typeof frameId === "number") badgeOwners.set(Number(tabId), frameId);
      }
    }
    badgeOwnersLoaded = true;
    while (badgeOwnersWaiters.length) badgeOwnersWaiters.shift()!();
  };
  try {
    api.storage.session.get(BADGE_OWNERS_KEY, (items) => {
      void api.runtime.lastError;
      done(items?.[BADGE_OWNERS_KEY]);
    });
  } catch (e) {
    done();
  }
}
loadBadgeOwners();

// Run fn once the saved owners are back in memory (at once from then on), so no
// ownership decision is made against a freshly restarted worker's empty map.
function withBadgeOwners(fn: () => void): void {
  if (badgeOwnersLoaded) fn();
  else badgeOwnersWaiters.push(fn);
}

function saveBadgeOwners(): void {
  call(() => api.storage.session.set({ [BADGE_OWNERS_KEY]: Object.fromEntries(badgeOwners) }));
}

function reset(tabId: number): void {
  withBadgeOwners(() => {
    if (badgeOwners.delete(tabId)) saveBadgeOwners();
  });
  videoFrameOwners.delete(tabId);
  call(() => api.action.setBadgeText({ text: "", tabId }));
  call(() => api.action.setIcon({ path: DEFAULT_ICON, tabId }));
}

function probeVideoFrame(): VideoFrameProbe {
  const videos = Array.from(document.querySelectorAll("video"));
  const candidates: Array<{ area: number; paused: boolean }> = [];
  let largestArea = 0;
  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    const ready = video.readyState > 0 || !!video.currentSrc || !!video.src;
    if (!ready || rect.width < 40 || rect.height < 40) continue;
    const area = rect.width * rect.height;
    candidates.push({ area, paused: video.paused });
    if (area > largestArea) largestArea = area;
  }
  const viableArea = largestArea * 0.25;
  let best = 0;
  for (const candidate of candidates) {
    const score =
      (candidate.area >= viableArea && !candidate.paused ? largestArea : 0) + candidate.area;
    if (score > best) best = score;
  }
  return { hasVideo: best > 0, score: best };
}

function findVideoFrame(tabId: number, done: (frameId?: number) => void): void {
  const cached = videoFrameOwners.get(tabId);
  if (cached && cached.expires > Date.now()) {
    done(cached.frameId);
    return;
  }
  let settled = false;
  const finish = (results?: Array<{ frameId?: number; result?: VideoFrameProbe }>) => {
    if (settled) return;
    settled = true;
    void api.runtime.lastError;
    let best: { frameId: number; score: number } | null = null;
    for (const entry of results || []) {
      const frameId = entry.frameId;
      const score = entry.result?.score || 0;
      if (!entry.result?.hasVideo || typeof frameId !== "number") continue;
      if (!best || score > best.score) best = { frameId, score };
    }
    if (best) {
      videoFrameOwners.set(tabId, {
        frameId: best.frameId,
        expires: Date.now() + VIDEO_FRAME_CACHE_MS,
      });
    } else {
      videoFrameOwners.set(tabId, { expires: Date.now() + VIDEO_FRAME_MISS_CACHE_MS });
    }
    done(best?.frameId);
  };
  try {
    const result = api.scripting.executeScript(
      {
        target: { tabId, allFrames: true },
        func: probeVideoFrame,
      },
      finish,
    ) as unknown as Promise<Array<{ frameId?: number; result?: VideoFrameProbe }>> | undefined;
    if (result && typeof result.then === "function") {
      void result.then(finish, () => finish());
    }
  } catch (e) {
    finish();
  }
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === "sponsorConsentStatus") {
    void hasSponsorDataConsent().then(
      (granted) => sendResponse({ granted }),
      () => sendResponse({ granted: false }),
    );
    return true;
  }
  if (msg && msg.action === "mutateStoredMap") {
    const mutation = validStoredMapMutation(msg);
    if (!mutation) {
      sendResponse({ success: false });
      return;
    }
    const reply = (success: boolean) => {
      try {
        sendResponse({ success });
      } catch (e) {
        /* sender disappeared before the write completed */
      }
    };
    void mutateStoredMap(mutation).then(reply, () => reply(false));
    return true;
  }
  // The gear opens the options page. The popup runs as an in-page iframe behind the
  // on-video overlay, and openOptionsPage() from that embedded extension frame is a
  // no-op on Firefox — so the popup asks the background (which always can) instead.
  if (msg && msg.action === "openOptions") {
    call(() => api.runtime.openOptionsPage());
    return;
  }
  // The page-world quality loader (through its frame's content script) needs the
  // adapter bundle. Injecting it into exactly that frame keeps it out of
  // web_accessible_resources, whose URL would identify the extension to every page.
  if (msg && msg.action === "injectQualityBridge") {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId;
    if (typeof tabId !== "number" || typeof frameId !== "number") {
      sendResponse({ ok: false });
      return;
    }
    let settled = false;
    const reply = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        sendResponse({ ok });
      } catch (e) {
        /* frame went away before the injection finished */
      }
    };
    try {
      const result = api.scripting.executeScript(
        {
          target: { tabId, frameIds: [frameId] },
          world: "MAIN",
          files: ["quality-inject.js"],
        },
        () => reply(!api.runtime.lastError),
      ) as unknown as Promise<unknown> | undefined;
      if (result && typeof result.then === "function") {
        void result.then(
          () => reply(true),
          () => reply(false),
        );
      }
    } catch (e) {
      reply(false);
    }
    return true;
  }
  // The on-video button inside an embedded player asks for the overlay: like a toolbar
  // click it opens in the top frame, not clipped inside the embed.
  if (msg && msg.action === "toggleOverlay") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number")
      call(() => api.tabs.sendMessage(tabId, { action: "toggleOverlay" }, { frameId: 0 }));
    return;
  }
  // The embedded overlay popup can't resolve its host tab via tabs.query on Firefox,
  // so it asks who it's in — the background has it from sender.tab. (A subframe's
  // content script asks too when it can't see the top origin: site settings key by it.)
  if (msg && msg.action === "whoami") {
    const t = sender.tab;
    sendResponse({ tab: t ? { id: t.id, url: t.url } : undefined });
    return;
  }
  // …and it relays its content-script messages through here too (the embedded frame
  // can't call tabs.sendMessage). Forward to the host tab and pipe the reply back.
  if (msg && msg.action === "relayToTab" && typeof msg.tabId === "number") {
    const tabId = msg.tabId;
    const routeVideo = msg.route === "video";
    const finish = (resp: unknown) => {
      try {
        sendResponse(resp);
      } catch (e) {
        /* popup closed before the reply */
      }
    };
    const relay = (frameId?: number) => {
      try {
        const options = typeof frameId === "number" ? { frameId } : undefined;
        api.tabs.sendMessage(tabId, msg.msg, options, (resp: unknown) => {
          const failed = !!api.runtime.lastError || !resp;
          if (failed && typeof frameId === "number") {
            if (routeVideo) videoFrameOwners.delete(tabId);
            relay();
            return;
          }
          // Absorb "no receiver"; the popup treats null as no-reply.
          void api.runtime.lastError;
          finish(resp);
        });
      } catch (e) {
        if (typeof frameId === "number") {
          relay();
          return;
        }
        finish(undefined);
      }
    };
    withBadgeOwners(() => {
      const owner = badgeOwners.get(tabId);
      if (routeVideo) findVideoFrame(tabId, (frameId) => relay(frameId ?? owner));
      else relay(owner);
    });
    return true; // sendResponse fires asynchronously
  }
  if (!msg || msg.action !== "icon" || !sender.tab) return;
  const tabId = sender.tab.id;
  if (typeof tabId !== "number") return;
  const frameId = typeof sender.frameId === "number" ? sender.frameId : 0;
  withBadgeOwners(() => {
    const owner = badgeOwners.get(tabId);
    if (msg.clear) {
      // Unknown owner: nothing claimed the badge since it was last reset (or a restarted
      // worker couldn't read it back). Only the top frame may clear then, not e.g. an ad
      // iframe whose video went away.
      if (owner === frameId || (owner == null && frameId === 0)) reset(tabId);
      return;
    }
    if (frameId !== 0 && owner != null && owner !== frameId) return;
    if (owner !== frameId) {
      badgeOwners.set(tabId, frameId);
      saveBadgeOwners();
    }
    call(() => api.action.setBadgeText({ text: msg.text || "", tabId }));
    call(() => api.action.setBadgeBackgroundColor({ color: "#0a84ff", tabId }));
    call(() => api.action.setBadgeTextColor({ color: "#ffffff", tabId }));
    call(() => api.action.setIcon({ path: msg.live ? RED_ICON : DEFAULT_ICON, tabId }));
  });
  return false; // no async response (only relayToTab keeps the channel open)
});

// The toolbar icon has no default_popup, so a click reaches us here. Ask the top
// frame to toggle the content script's in-page overlay iframe — it isn't capped by
// the native popup's size. It opens on any page the content script runs on — video or
// not, blacklisted site or not. Pages without a content script (privileged pages, the
// store, PDF viewer) have nothing to host it, so a click there is simply a no-op.
if (api.action && api.action.onClicked) {
  api.action.onClicked.addListener((tab) => {
    const tabId = tab.id;
    if (typeof tabId !== "number") return;
    call(() => api.tabs.sendMessage(tabId, { action: "toggleOverlay" }, { frameId: 0 }));
  });
}

// Clear badge + restore default icon when a tab starts navigating, so stale state
// from the previous page doesn't linger before the new content script reports.
if (api.tabs && api.tabs.onUpdated) {
  api.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === "loading") reset(tabId);
  });
}
if (api.tabs && api.tabs.onRemoved) {
  api.tabs.onRemoved.addListener((tabId) => reset(tabId));
}

// On reload/update the content scripts already running in open tabs are orphaned
// (their extension context is dead) and the browser won't re-inject until the page
// navigates — so the page silently stops responding to the popup/shortcuts until a
// manual refresh. Re-inject the isolated content script into every open http(s) tab
// so it keeps working without a refresh. The MAIN-world probes also publish fresh
// DOM bridges (YouTube/HLS quality, latency), so they must be refreshed too.
function reinjectOpenTabs(): void {
  call(() =>
    api.tabs.query({ url: ["http://*/*", "https://*/*"] }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id == null) continue;
        const tabId = tab.id as number;
        call(() =>
          api.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ["content.js"],
          }),
        );
        if (shouldInjectLatencyBridge(tab.url)) {
          call(() =>
            api.scripting.executeScript({
              target: { tabId, allFrames: true },
              files: ["inject.js"],
              world: "MAIN",
            }),
          );
        }
        call(() =>
          api.scripting.executeScript({
            target: { tabId, allFrames: true },
            files: ["page-bridge.js"],
            world: "MAIN",
          }),
        );
      }
    }),
  );
}

// Chrome's url query also matches a tab by the page it is still loading, leaving out
// the URL of the one it shows when that's out of reach (e.g. the new-tab page).
function shouldInjectLatencyBridge(url?: string): boolean {
  if (!url) return false;
  const host = new URL(url).hostname.toLowerCase();
  return (
    host === "twitch.tv" ||
    host.endsWith(".twitch.tv") ||
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com") ||
    host === "kick.com" ||
    host.endsWith(".kick.com") ||
    host === "w.tv" ||
    host.endsWith(".w.tv")
  );
}

// Only an install or an update orphans running scripts; after a browser start or a
// browser update every page loads fresh with the manifest's content scripts.
if (api.runtime && api.runtime.onInstalled && api.scripting && api.tabs) {
  api.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install" || details.reason === "update") reinjectOpenTabs();
  });
}

// First-run seeding: persist the shipped global defaults — playback speed 100%
// and the live-sync allowed delay (5s) — so the "global" scope is a real, saved
// value instead of an implicit code fallback. Routed through STORE so each key
// lands in the area its category syncs to, and only written when absent so it
// never clobbers an existing (or already-synced) value. syncTargetGlobal also
// defers to the legacy `liveSyncTarget` global, which loadSpeed still honours.
if (api.runtime && api.runtime.onInstalled) {
  api.runtime.onInstalled.addListener((details) => {
    if (details.reason !== "install") return;
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

// One-time migration: copy pre-router device-local settings into the routed store
// only where the current routed area has no value yet.
if (api.runtime && api.runtime.onInstalled && api.storage && api.storage.sync) {
  api.runtime.onInstalled.addListener(() => {
    const keys = ["domains", "liveSync", "liveSyncTarget", "liveSyncMax"];
    const doneKey = "legacyLocalSyncMigrationDone";
    whenReady(() => {
      api.storage.local.get([doneKey, ...keys], (local) => {
        if (local[doneKey]) return;
        STORE.get(keys, (current) => {
          const copy: Record<string, unknown> = {};
          for (const k of keys) {
            if (current[k] === undefined && local[k] !== undefined) copy[k] = local[k];
          }
          const markDone = () => api.storage.local.set({ [doneKey]: true });
          if (Object.keys(copy).length) {
            STORE.set(copy, (ok) => {
              if (ok !== false) markDone();
            });
          } else markDone();
        });
      });
    });
  });
}

// --- Update checking ---------------------------------------------------------
// Both stores update us on their own schedule; this just lets the popup header
// surface a "new version available" marker. The result lives in local storage
// (it's per-browser — the latest/staged version differs across browsers, so it
// must never sync).
function recordUpdate(available: boolean, latest?: string): void {
  const rec: Record<string, unknown> = { [UPDATE_AVAILABLE_KEY]: available };
  if (latest) rec[UPDATE_LATEST_KEY] = latest;
  call(() => api.storage.local.set(rec));
}

function runUpdateCheck(): void {
  if (hasUpdateApi()) {
    // Chrome: ask the browser directly. "update_available" means a newer version
    // is staged (and will be applied automatically when the worker next idles).
    call(() =>
      api.runtime.requestUpdateCheck((status, details) => {
        void api.runtime.lastError;
        recordUpdate(status === "update_available", details?.version);
      }),
    );
  } else {
    // Firefox: no requestUpdateCheck — compare the manifest against AMO's latest.
    void fetchAmoLatest().then((latest) => {
      if (latest == null) return; // network blip: leave the last result untouched
      recordUpdate(cmpVersion(latest, currentVersion()) > 0, latest);
    });
  }
}

// Chrome stages an update while we're running and fires this; record it so the
// header marker appears (with the new version when known). We don't reload —
// Chrome applies the staged update on its next idle anyway. Firefox fires it too,
// but there merely listening defers the update until the browser restarts.
if (hasUpdateApi() && api.runtime.onUpdateAvailable) {
  api.runtime.onUpdateAvailable.addListener((details) => {
    recordUpdate(true, details.version);
  });
}

// Check on install/startup and every UPDATE_PERIOD_MIN via an alarm (the worker
// can't keep a setInterval alive across its idle unloads).
if (api.alarms) {
  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === UPDATE_ALARM) runUpdateCheck();
  });
  const schedule = () => {
    call(() => api.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_PERIOD_MIN }));
    runUpdateCheck();
  };
  if (api.runtime.onInstalled) api.runtime.onInstalled.addListener(schedule);
  if (api.runtime.onStartup) api.runtime.onStartup.addListener(schedule);
}
