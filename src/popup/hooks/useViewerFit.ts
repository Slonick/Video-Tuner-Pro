import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STORE } from "../platform/storage.js";
import type { ActiveTab, SendToTab } from "./tab.js";
import type { Scope, ScopeFlags, ScopeStorage } from "../lib/scope.js";
import { useScopeSelection, type ScopeValues } from "./useScopeSelection.js";
import { pullAfter, type ViewerFitResponse } from "../lib/messaging.js";

export type ViewerFitMode = "contain" | "cover" | "fill";

const STORAGE: ScopeStorage = {
  global: ["viewerFitGlobal"],
  siteMap: "viewerFitSites",
  channelMap: "viewerFitChannels",
};

function normalize(raw: unknown): ViewerFitMode {
  return raw === "cover" || raw === "fill" ? raw : "contain";
}

export interface UseViewerFit {
  mode: ViewerFitMode;
  channel: string | null;
  channelName: string;
  scope: Scope;
  saved: ScopeFlags;
  savedValues: ScopeValues;
  setMode: (mode: ViewerFitMode) => void;
  save: (target?: Scope) => boolean | Promise<boolean>;
  resetScope: (target?: Scope) => void;
  pickScope: (scope: Scope) => void;
}

export function useViewerFit(tab: ActiveTab | null, send: SendToTab): UseViewerFit {
  const domain = tab?.domain ?? "";
  const hasTab = tab?.tabId != null;
  const {
    scope,
    applyChannel,
    defaultScope,
    refreshSaved,
    markSaved,
    saveFallback,
    resetFallback,
    saved,
    savedValues,
    channel,
    channelName,
    channelKey,
    pickScope,
  } = useScopeSelection(domain, STORAGE);

  const [mode, setModeState] = useState<ViewerFitMode>("contain");
  const modeRef = useRef<ViewerFitMode>("contain");
  const modeHoldUntil = useRef(0);
  const setMode = useCallback(
    (next: ViewerFitMode) => {
      const previous = modeRef.current;
      modeRef.current = normalize(next);
      setModeState(modeRef.current);
      modeHoldUntil.current = Date.now() + 1200;
      if (hasTab)
        void send<ViewerFitResponse>("setViewerFit", { mode: modeRef.current }).then((resp) => {
          if (!resp || resp.success === false) {
            modeHoldUntil.current = 0;
            modeRef.current = previous;
            setModeState(previous);
            return;
          }
          modeRef.current = normalize(resp.mode);
          setModeState(modeRef.current);
        });
    },
    [hasTab, send],
  );

  const applyResolved = useCallback((resp: ViewerFitResponse) => {
    if (Date.now() < modeHoldUntil.current) return;
    modeRef.current = normalize(resp.mode);
    setModeState(modeRef.current);
  }, []);

  const fallbackFromStorage = useCallback(() => {
    STORE.get(["viewerFitGlobal", STORAGE.siteMap, STORAGE.channelMap], (r) => {
      const sites = (r[STORAGE.siteMap] || {}) as Record<string, ViewerFitMode>;
      const channels = (r[STORAGE.channelMap] || {}) as Record<string, ViewerFitMode>;
      modeRef.current = normalize(
        (channelKey.current ? channels[channelKey.current] : undefined) ??
          sites[domain] ??
          r.viewerFitGlobal,
      );
      setModeState(modeRef.current);
    });
  }, [domain, channelKey]);

  const save = useCallback(
    (target: Scope = scope) => {
      const next = modeRef.current;
      const fallback = () =>
        new Promise<boolean>((resolve) => {
          if (target === "channel") {
            refreshSaved();
            resolve(false);
            return;
          }
          saveFallback(target, next, (ok) => {
            if (ok === false) {
              refreshSaved();
              resolve(false);
              return;
            }
            markSaved(target, true, next);
            resolve(true);
          });
        });
      if (hasTab) {
        return send<{ success?: boolean }>("rememberViewerFit", {
          scope: target,
          mode: next,
        }).then((r) => {
          if (r == null) return fallback();
          if (r.success === false) {
            refreshSaved();
            return false;
          }
          markSaved(target, true, next);
          return true;
        });
      }
      return fallback();
    },
    [scope, hasTab, send, saveFallback, markSaved, refreshSaved],
  );

  const resetScope = useCallback(
    (target: Scope = scope) => {
      const fallback = () => {
        if (target === "channel") {
          refreshSaved();
          return;
        }
        resetFallback(target, (ok) => {
          if (ok !== false) markSaved(target, false);
          fallbackFromStorage();
        });
      };
      if (!hasTab) {
        fallback();
        return;
      }
      void send("resetViewerFit", { scope: target }).then((r) => {
        if (r == null) fallback();
        else if ((r as { success?: boolean }).success === false) refreshSaved();
        else
          pullAfter<ViewerFitResponse>(send, "getViewerFit", (resp) => {
            applyResolved(resp);
            defaultScope(resp.scope, !!resp.channel);
            refreshSaved();
          });
      });
    },
    [
      scope,
      hasTab,
      markSaved,
      resetFallback,
      fallbackFromStorage,
      send,
      applyResolved,
      defaultScope,
      refreshSaved,
    ],
  );

  useEffect(() => {
    if (!tab) return;
    if (hasTab) {
      void send<ViewerFitResponse>("getViewerFit").then((resp) => {
        if (resp) {
          applyResolved(resp);
          applyChannel(resp.channel, resp.channelName, resp.channelKeys);
          defaultScope(resp.scope, !!resp.channel);
          refreshSaved();
        } else {
          fallbackFromStorage();
          defaultScope(null, false);
          refreshSaved();
        }
      });
    } else {
      fallbackFromStorage();
      defaultScope(null, false);
      refreshSaved();
    }
  }, [
    tab,
    hasTab,
    send,
    applyResolved,
    applyChannel,
    defaultScope,
    refreshSaved,
    fallbackFromStorage,
  ]);

  return useMemo(
    () => ({
      mode,
      channel,
      channelName,
      scope,
      saved,
      savedValues,
      setMode,
      save,
      resetScope,
      pickScope,
    }),
    [mode, channel, channelName, scope, saved, savedValues, setMode, save, resetScope, pickScope],
  );
}
