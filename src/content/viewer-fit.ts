import { channelKeys } from "./channel.js";
import { getDomain } from "./core/domain.js";
import {
  normalizeViewerFit,
  resolveViewerFit,
  type ViewerFitMode,
  type ViewerFitScope,
} from "./core/resolve.js";
import { ctxValid } from "./platform/browser.js";
import { STORE } from "./platform/storage.js";
import { S } from "./state.js";
import { setViewerFitMode } from "./viewer.js";

type Map = Record<string, ViewerFitMode>;

function applyResolvedViewerFit(sites: Map, channels: Map, global: unknown): void {
  const r = resolveViewerFit(channelKeys(), getDomain(), sites, channels, global);
  S.viewerFitScope = r.scope;
  setViewerFitMode(r.mode);
}

export function applyResolvedViewerFitFromStore(): void {
  if (!ctxValid()) return;
  STORE.get(["viewerFitGlobal", "viewerFitSites", "viewerFitChannels"], (r) => {
    applyResolvedViewerFit(
      (r.viewerFitSites || {}) as Map,
      (r.viewerFitChannels || {}) as Map,
      r.viewerFitGlobal,
    );
  });
}

export function persistSiteViewerFit(mode: ViewerFitMode): void {
  if (!ctxValid() || window.top !== window) return;
  STORE.get(["viewerFitSites"], (r) => {
    const map = (r.viewerFitSites || {}) as Map;
    map[getDomain()] = normalizeViewerFit(mode);
    STORE.set({ viewerFitSites: map });
  });
}

export function persistChannelViewerFit(mode: ViewerFitMode): void {
  if (!ctxValid() || window.top !== window) return;
  const keys = channelKeys();
  if (!keys.length) return;
  STORE.get(["viewerFitChannels"], (r) => {
    const map = (r.viewerFitChannels || {}) as Map;
    for (const key of keys) delete map[key];
    map[keys[0]] = normalizeViewerFit(mode);
    STORE.set({ viewerFitChannels: map });
  });
}

export function persistGlobalViewerFit(mode: ViewerFitMode): void {
  if (!ctxValid() || window.top !== window) return;
  STORE.set({ viewerFitGlobal: normalizeViewerFit(mode) });
}

export function resetViewerFitScope(scope: ViewerFitScope): void {
  if (!ctxValid()) return;
  STORE.get(["viewerFitGlobal", "viewerFitSites", "viewerFitChannels"], (r) => {
    const sites = (r.viewerFitSites || {}) as Map;
    const channels = (r.viewerFitChannels || {}) as Map;
    let global = r.viewerFitGlobal;
    if (scope === "channel") {
      const keys = channelKeys();
      if (!keys.length) return;
      for (const key of keys) delete channels[key];
      STORE.set({ viewerFitChannels: channels });
    } else if (scope === "site") {
      delete sites[getDomain()];
      STORE.set({ viewerFitSites: sites });
    } else if (scope === "global") {
      global = undefined;
      STORE.remove(["viewerFitGlobal"]);
    } else {
      return;
    }
    applyResolvedViewerFit(sites, channels, global);
  });
}
