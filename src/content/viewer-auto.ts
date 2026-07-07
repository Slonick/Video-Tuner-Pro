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
type Done = (ok?: boolean) => void;

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

export function persistSiteViewerAuto(mode: ViewerAutoMode, done?: Done): void {
  if (!ctxValid() || window.top !== window) {
    done?.(false);
    return;
  }
  STORE.get(["viewerAutoSites"], (r) => {
    const map = { ...((r.viewerAutoSites || {}) as Map) };
    map[getDomain()] = normalizeViewerAuto(mode);
    STORE.set({ viewerAutoSites: map }, done);
  });
}

export function persistChannelViewerAuto(mode: ViewerAutoMode, done?: Done): void {
  if (!ctxValid() || window.top !== window) {
    done?.(false);
    return;
  }
  const keys = channelKeys();
  if (!keys.length) {
    done?.(false);
    return;
  }
  STORE.get(["viewerAutoChannels"], (r) => {
    const map = { ...((r.viewerAutoChannels || {}) as Map) };
    for (const key of keys) delete map[key];
    map[keys[0]] = normalizeViewerAuto(mode);
    STORE.set({ viewerAutoChannels: map }, done);
  });
}

export function persistGlobalViewerAuto(mode: ViewerAutoMode, done?: Done): void {
  if (!ctxValid() || window.top !== window) {
    done?.(false);
    return;
  }
  STORE.set({ viewerAutoGlobal: normalizeViewerAuto(mode) }, (ok) => {
    if (ok === false) {
      done?.(false);
      return;
    }
    STORE.remove("viewerAuto", done);
  });
}

export function resetViewerAutoScope(scope: ViewerAutoScope, done?: Done): void {
  if (!ctxValid()) {
    done?.(false);
    return;
  }
  STORE.get(["viewerAutoGlobal", "viewerAuto", "viewerAutoSites", "viewerAutoChannels"], (r) => {
    const sites = { ...((r.viewerAutoSites || {}) as Map) };
    const channels = { ...((r.viewerAutoChannels || {}) as Map) };
    let global = r.viewerAutoGlobal ?? r.viewerAuto;
    const finish = (ok?: boolean) => {
      if (ok === false) {
        done?.(false);
        return;
      }
      applyResolvedViewerAuto(sites, channels, global);
      done?.(true);
    };
    if (scope === "channel") {
      const keys = channelKeys();
      if (!keys.length) {
        done?.(false);
        return;
      }
      for (const key of keys) delete channels[key];
      if (Object.keys(channels).length) STORE.set({ viewerAutoChannels: channels }, finish);
      else STORE.remove("viewerAutoChannels", finish);
    } else if (scope === "site") {
      delete sites[getDomain()];
      if (Object.keys(sites).length) STORE.set({ viewerAutoSites: sites }, finish);
      else STORE.remove("viewerAutoSites", finish);
    } else if (scope === "global") {
      global = undefined;
      STORE.remove(["viewerAutoGlobal", "viewerAuto"], finish);
    } else {
      done?.(false);
      return;
    }
  });
}
