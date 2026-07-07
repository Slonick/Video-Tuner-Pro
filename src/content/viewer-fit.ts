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
type Done = (ok?: boolean) => void;

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

export function persistSiteViewerFit(mode: ViewerFitMode, done?: Done): void {
  if (!ctxValid() || window.top !== window) {
    done?.(false);
    return;
  }
  STORE.get(["viewerFitSites"], (r) => {
    const map = { ...((r.viewerFitSites || {}) as Map) };
    map[getDomain()] = normalizeViewerFit(mode);
    STORE.set({ viewerFitSites: map }, done);
  });
}

export function persistChannelViewerFit(mode: ViewerFitMode, done?: Done): void {
  if (!ctxValid() || window.top !== window) {
    done?.(false);
    return;
  }
  const keys = channelKeys();
  if (!keys.length) {
    done?.(false);
    return;
  }
  STORE.get(["viewerFitChannels"], (r) => {
    const map = { ...((r.viewerFitChannels || {}) as Map) };
    for (const key of keys) delete map[key];
    map[keys[0]] = normalizeViewerFit(mode);
    STORE.set({ viewerFitChannels: map }, done);
  });
}

export function persistGlobalViewerFit(mode: ViewerFitMode, done?: Done): void {
  if (!ctxValid() || window.top !== window) {
    done?.(false);
    return;
  }
  STORE.set({ viewerFitGlobal: normalizeViewerFit(mode) }, done);
}

export function resetViewerFitScope(scope: ViewerFitScope, done?: Done): void {
  if (!ctxValid()) {
    done?.(false);
    return;
  }
  STORE.get(["viewerFitGlobal", "viewerFitSites", "viewerFitChannels"], (r) => {
    const sites = { ...((r.viewerFitSites || {}) as Map) };
    const channels = { ...((r.viewerFitChannels || {}) as Map) };
    let global = r.viewerFitGlobal;
    const finish = (ok?: boolean) => {
      if (ok === false) {
        done?.(false);
        return;
      }
      applyResolvedViewerFit(sites, channels, global);
      done?.(true);
    };
    if (scope === "channel") {
      const keys = channelKeys();
      if (!keys.length) {
        done?.(false);
        return;
      }
      for (const key of keys) delete channels[key];
      if (Object.keys(channels).length) STORE.set({ viewerFitChannels: channels }, finish);
      else STORE.remove("viewerFitChannels", finish);
    } else if (scope === "site") {
      delete sites[getDomain()];
      if (Object.keys(sites).length) STORE.set({ viewerFitSites: sites }, finish);
      else STORE.remove("viewerFitSites", finish);
    } else if (scope === "global") {
      global = undefined;
      STORE.remove(["viewerFitGlobal"], finish);
    } else {
      done?.(false);
      return;
    }
  });
}
