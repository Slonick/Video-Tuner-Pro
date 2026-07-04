import { useCallback, useEffect, useRef, useState } from "react";
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
  save: (target?: Scope) => void;
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
    pickScope,
  } = useScopeSelection(domain, STORAGE);

  const [mode, setModeState] = useState<ViewerFitMode>("contain");
  const modeRef = useRef<ViewerFitMode>("contain");
  const setMode = useCallback(
    (next: ViewerFitMode) => {
      modeRef.current = normalize(next);
      setModeState(modeRef.current);
      if (hasTab) void send("setViewerFit", { mode: modeRef.current });
    },
    [hasTab, send],
  );

  const applyResolved = useCallback(
    (resp: ViewerFitResponse) => {
      modeRef.current = normalize(resp.mode);
      setModeState(modeRef.current);
    },
    [],
  );

  const fallbackFromStorage = useCallback(() => {
    STORE.get(["viewerFitGlobal", STORAGE.siteMap], (r) => {
      const sites = (r[STORAGE.siteMap] || {}) as Record<string, ViewerFitMode>;
      modeRef.current = normalize(sites[domain] ?? r.viewerFitGlobal);
      setModeState(modeRef.current);
    });
  }, [domain]);

  const save = useCallback(
    (target: Scope = scope) => {
      const next = modeRef.current;
      if (hasTab) {
        void send("rememberViewerFit", { scope: target, mode: next }).then((r) => {
          if (r == null) saveFallback(target, next);
        });
      } else {
        saveFallback(target, next);
      }
      markSaved(target, true, next);
    },
    [scope, hasTab, send, saveFallback, markSaved],
  );

  const resetScope = useCallback(
    (target: Scope = scope) => {
      markSaved(target, false);
      const fallback = () =>
        target === "channel" ? setMode("contain") : resetFallback(target, fallbackFromStorage);
      if (!hasTab) {
        fallback();
        return;
      }
      void send("resetViewerFit", { scope: target }).then((r) => {
        if (r == null) fallback();
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
      setMode,
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
          applyChannel(resp.channel, resp.channelName);
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

  return {
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
  };
}
