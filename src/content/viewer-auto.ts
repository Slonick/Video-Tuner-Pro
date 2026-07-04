import { channelKeys } from "./channel.js";
import { getDomain } from "./core/domain.js";
import {
  normalizeViewerAuto,
  resolveViewerAuto,
  type ViewerAutoMode,
  type ViewerAutoScope,
} from "./core/resolve.js";
import { ctxValid } from "./platform/browser.js";
import { STORE } from "./platform/storage.js";
import { S } from "./state.js";

type Map = Record<string, ViewerAutoMode>;

function applyResolvedViewerAuto(sites: Map, channels: Map, global: unknown): void {
  const r = resolveViewerAuto(channelKeys(), getDomain(), sites, channels, global);
  S.viewerAuto = r.mode;
  S.viewerAutoScope = r.scope;
}

export function applyResolvedViewerAutoFromStore(): void {
  if (!ctxValid()) return;
  STORE.get(["viewerAutoGlobal", "viewerAuto", "viewerAutoSites", "viewerAutoChannels"], (r) => {
    applyResolvedViewerAuto(
      (r.viewerAutoSites || {}) as Map,
      (r.viewerAutoChannels || {}) as Map,
      r.viewerAutoGlobal ?? r.viewerAuto,
    );
  });
}

export function persistSiteViewerAuto(mode: ViewerAutoMode): void {
  if (!ctxValid() || window.top !== window) return;
  STORE.get(["viewerAutoSites"], (r) => {
    const map = (r.viewerAutoSites || {}) as Map;
    map[getDomain()] = normalizeViewerAuto(mode);
    STORE.set({ viewerAutoSites: map });
  });
}

export function persistChannelViewerAuto(mode: ViewerAutoMode): void {
  if (!ctxValid() || window.top !== window) return;
  const keys = channelKeys();
  if (!keys.length) return;
  STORE.get(["viewerAutoChannels"], (r) => {
    const map = (r.viewerAutoChannels || {}) as Map;
    for (const key of keys) delete map[key];
    map[keys[0]] = normalizeViewerAuto(mode);
    STORE.set({ viewerAutoChannels: map });
  });
}

export function persistGlobalViewerAuto(mode: ViewerAutoMode): void {
  if (!ctxValid() || window.top !== window) return;
  STORE.set({ viewerAutoGlobal: normalizeViewerAuto(mode) });
}

export function resetViewerAutoScope(scope: ViewerAutoScope): void {
  if (!ctxValid()) return;
  STORE.get(["viewerAutoGlobal", "viewerAuto", "viewerAutoSites", "viewerAutoChannels"], (r) => {
    const sites = (r.viewerAutoSites || {}) as Map;
    const channels = (r.viewerAutoChannels || {}) as Map;
    let global = r.viewerAutoGlobal ?? r.viewerAuto;
    if (scope === "channel") {
      const keys = channelKeys();
      if (!keys.length) return;
      for (const key of keys) delete channels[key];
      STORE.set({ viewerAutoChannels: channels });
    } else if (scope === "site") {
      delete sites[getDomain()];
      STORE.set({ viewerAutoSites: sites });
    } else if (scope === "global") {
      global = undefined;
      STORE.remove(["viewerAutoGlobal", "viewerAuto"]);
    } else {
      return;
    }
    applyResolvedViewerAuto(sites, channels, global);
  });
}
