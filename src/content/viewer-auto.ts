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
import { mutateStoredMap } from "../shared/map-mutation.js";
import { S } from "./state.js";

type Map = Record<string, ViewerAutoMode>;
type Done = (ok?: boolean) => void;

function applyResolvedViewerAuto(sites: Map, channels: Map, global: unknown): void {
  const r = resolveViewerAuto(channelKeys(), getDomain(), sites, channels, global);
  S.viewerAuto = r.mode;
  S.viewerAutoScope = r.scope;
}

export function applyResolvedViewerAutoFromStore(done?: Done): void {
  if (!ctxValid()) {
    done?.(false);
    return;
  }
  STORE.get(["viewerAutoGlobal", "viewerAuto", "viewerAutoSites", "viewerAutoChannels"], (r) => {
    applyResolvedViewerAuto(
      (r.viewerAutoSites || {}) as Map,
      (r.viewerAutoChannels || {}) as Map,
      r.viewerAutoGlobal ?? r.viewerAuto,
    );
    done?.(true);
  });
}

export function persistSiteViewerAuto(mode: ViewerAutoMode, done?: Done): void {
  if (!ctxValid() || window.top !== window) {
    done?.(false);
    return;
  }
  mutateStoredMap("viewerAutoSites", { [getDomain()]: normalizeViewerAuto(mode) }, [], done);
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
  mutateStoredMap(
    "viewerAutoChannels",
    { [keys[0]]: normalizeViewerAuto(mode) },
    keys.slice(1),
    done,
  );
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
  const finish = (ok?: boolean) => {
    if (ok === false) done?.(false);
    else applyResolvedViewerAutoFromStore(done);
  };
  if (scope === "channel") {
    const keys = channelKeys();
    if (!keys.length) {
      done?.(false);
      return;
    }
    mutateStoredMap("viewerAutoChannels", {}, keys, finish);
  } else if (scope === "site") {
    mutateStoredMap("viewerAutoSites", {}, [getDomain()], finish);
  } else if (scope === "global") STORE.remove(["viewerAutoGlobal", "viewerAuto"], finish);
  else done?.(false);
}
