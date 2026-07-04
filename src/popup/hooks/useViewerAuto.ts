import { useCallback, useEffect, useRef, useState } from "react";
import { STORE } from "../platform/storage.js";
import { useStored } from "./useStored.js";
import { api } from "../platform/browser.js";
import type { ActiveTab, SendToTab } from "./tab.js";
import type { Scope, ScopeFlags, ScopeStorage } from "../lib/scope.js";
import { useScopeSelection, type ScopeValues } from "./useScopeSelection.js";
import { pullAfter, type ViewerAutoResponse, type ViewerStateResponse } from "../lib/messaging.js";

export type ViewerAutoMode = "off" | "normal" | "theater";

const STORAGE: ScopeStorage = {
  global: ["viewerAutoGlobal", "viewerAuto"],
  siteMap: "viewerAutoSites",
  channelMap: "viewerAutoChannels",
};

function normalize(raw: unknown): ViewerAutoMode {
  return raw === "normal" || raw === "theater" ? raw : "off";
}

export interface UseViewerAuto {
  enabled: boolean;
  mode: ViewerAutoMode;
  pageMode: ViewerAutoMode;
  channel: string | null;
  channelName: string;
  scope: Scope;
  saved: ScopeFlags;
  savedValues: ScopeValues;
  setEnabled: (enabled: boolean) => void;
  setMode: (mode: ViewerAutoMode) => void;
  setPageMode: (mode: ViewerAutoMode) => void;
  save: (target?: Scope) => void;
  resetScope: (target?: Scope) => void;
  pickScope: (scope: Scope) => void;
}

export function useViewerAuto(tab: ActiveTab | null, send: SendToTab): UseViewerAuto {
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

  const [mode, setModeState] = useState<ViewerAutoMode>("off");
  const [pageMode, setPageModeState] = useState<ViewerAutoMode>("off");
  const [enabled, setEnabledState] = useState(true);
  const modeRef = useRef<ViewerAutoMode>("off");
  const modeHoldUntil = useRef(0);
  const setMode = useCallback((next: ViewerAutoMode) => {
    modeRef.current = normalize(next);
    setModeState(modeRef.current);
  }, []);
  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    STORE.set({ viewerAutoEnabled: next });
  }, []);
  useStored(["viewerAutoEnabled"], (r) => setEnabledState(r.viewerAutoEnabled !== false));

  const applyResolved = useCallback(
    (resp: ViewerAutoResponse) => {
      if (Date.now() < modeHoldUntil.current) return;
      setMode(normalize(resp.mode));
    },
    [setMode],
  );

  const applyPageState = useCallback((resp: ViewerStateResponse | null | undefined) => {
    setPageModeState(normalize(resp?.mode));
  }, []);

  const refreshPageState = useCallback(() => {
    if (!hasTab) {
      setPageModeState("off");
      return;
    }
    void send<ViewerStateResponse>("getViewerState").then(applyPageState);
  }, [hasTab, send, applyPageState]);

  const setPageMode = useCallback(
    (next: ViewerAutoMode) => {
      const mode = normalize(next);
      modeHoldUntil.current = Date.now() + 1200;
      setMode(mode);
      setPageModeState(mode);
      if (!hasTab) return;
      void send<ViewerStateResponse>("setViewerState", { mode }).then((resp) => {
        if (resp) applyPageState(resp);
      });
    },
    [hasTab, send, setMode, applyPageState],
  );

  const fallbackFromStorage = useCallback(() => {
    STORE.get(["viewerAutoGlobal", "viewerAuto", STORAGE.siteMap], (r) => {
      const sites = (r[STORAGE.siteMap] || {}) as Record<string, ViewerAutoMode>;
      setMode(normalize(sites[domain] ?? r.viewerAutoGlobal ?? r.viewerAuto));
    });
  }, [domain, setMode]);

  const save = useCallback(
    (target: Scope = scope) => {
      const next = modeRef.current;
      if (hasTab) {
        void send("rememberViewerAuto", { scope: target, mode: next }).then((r) => {
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
        target === "channel" ? setMode("off") : resetFallback(target, fallbackFromStorage);
      if (!hasTab) {
        fallback();
        return;
      }
      void send("resetViewerAuto", { scope: target }).then((r) => {
        if (r == null) fallback();
        else
          pullAfter<ViewerAutoResponse>(send, "getViewerAuto", (resp) => {
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
      void send<ViewerAutoResponse>("getViewerAuto").then((resp) => {
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
    refreshPageState();
  }, [
    tab,
    hasTab,
    send,
    applyResolved,
    applyChannel,
    defaultScope,
    refreshSaved,
    fallbackFromStorage,
    refreshPageState,
  ]);

  useEffect(() => {
    if (!hasTab || tab?.tabId == null) return;
    const onMessage = (
      msg: { action?: string; mode?: unknown },
      sender?: { tab?: { id?: number } },
    ) => {
      if (msg?.action !== "viewerStateChanged") return;
      if (sender?.tab?.id != null && sender.tab.id !== tab.tabId) return;
      applyPageState({ mode: normalize(msg.mode) });
    };
    api.runtime.onMessage.addListener(onMessage);
    return () => api.runtime.onMessage.removeListener?.(onMessage);
  }, [hasTab, tab?.tabId, applyPageState]);

  return {
    enabled,
    mode,
    pageMode,
    channel,
    channelName,
    scope,
    saved,
    savedValues,
    setEnabled,
    setMode,
    setPageMode,
    save,
    resetScope,
    pickScope,
  };
}
