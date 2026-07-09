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
import { mutateStoredMap } from "../shared/map-mutation.js";
import { S } from "./state.js";
import { setViewerFitMode } from "./viewer.js";

type Map = Record<string, ViewerFitMode>;
type Done = (ok?: boolean) => void;

function applyResolvedViewerFit(sites: Map, channels: Map, global: unknown): void {
  const r = resolveViewerFit(channelKeys(), getDomain(), sites, channels, global);
  S.viewerFitScope = r.scope;
  setViewerFitMode(r.mode);
}

export function applyResolvedViewerFitFromStore(done?: Done): void {
  if (!ctxValid()) {
    done?.(false);
    return;
  }
  STORE.get(["viewerFitGlobal", "viewerFitSites", "viewerFitChannels"], (r) => {
    applyResolvedViewerFit(
      (r.viewerFitSites || {}) as Map,
      (r.viewerFitChannels || {}) as Map,
      r.viewerFitGlobal,
    );
    done?.(true);
  });
}

export function persistSiteViewerFit(mode: ViewerFitMode, done?: Done): void {
  if (!ctxValid() || window.top !== window) {
    done?.(false);
    return;
  }
  mutateStoredMap("viewerFitSites", { [getDomain()]: normalizeViewerFit(mode) }, [], done);
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
  mutateStoredMap(
    "viewerFitChannels",
    { [keys[0]]: normalizeViewerFit(mode) },
    keys.slice(1),
    done,
  );
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
  const finish = (ok?: boolean) => {
    if (ok === false) done?.(false);
    else applyResolvedViewerFitFromStore(done);
  };
  if (scope === "channel") {
    const keys = channelKeys();
    if (!keys.length) {
      done?.(false);
      return;
    }
    mutateStoredMap("viewerFitChannels", {}, keys, finish);
  } else if (scope === "site") {
    mutateStoredMap("viewerFitSites", {}, [getDomain()], finish);
  } else if (scope === "global") STORE.remove(["viewerFitGlobal"], finish);
  else done?.(false);
}
