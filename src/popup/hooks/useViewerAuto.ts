import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  save: (target?: Scope) => boolean | Promise<boolean>;
  resetScope: (target?: Scope) => void;
  pickScope: (scope: Scope) => void;
}

export function useViewerAuto(
  tab: ActiveTab | null,
  send: SendToTab,
  pageLive = false,
): UseViewerAuto {
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
  const [enabled, setEnabledState] = useState(false);
  const modeRef = useRef<ViewerAutoMode>("off");
  const pageModeRef = useRef<ViewerAutoMode>("off");
  const pageModeRequestId = useRef(0);
  const modeHoldUntil = useRef(0);
  const pageModeHoldUntil = useRef(0);
  const setMode = useCallback((next: ViewerAutoMode) => {
    modeRef.current = normalize(next);
    setModeState(modeRef.current);
  }, []);
  const setPickedMode = useCallback(
    (next: ViewerAutoMode) => {
      modeHoldUntil.current = Date.now() + 1200;
      setMode(next);
    },
    [setMode],
  );
  const setEnabled = useCallback(
    (next: boolean) => {
      const prev = enabled;
      setEnabledState(next);
      STORE.set({ viewerAutoEnabled: next }, (ok) => {
        if (ok === false) setEnabledState(prev);
      });
    },
    [enabled],
  );
  useStored(["viewerAutoEnabled"], (r) => setEnabledState(r.viewerAutoEnabled !== false));

  const applyResolved = useCallback(
    (resp: ViewerAutoResponse) => {
      if (Date.now() < modeHoldUntil.current) return;
      setMode(normalize(resp.mode));
    },
    [setMode],
  );

  const applyPageState = useCallback(
    (resp: ViewerStateResponse | null | undefined, force = false) => {
      if (!force && Date.now() < pageModeHoldUntil.current) return;
      pageModeRef.current = normalize(resp?.mode);
      setPageModeState(pageModeRef.current);
    },
    [],
  );

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
      const previousPageMode = pageModeRef.current;
      pageModeHoldUntil.current = Date.now() + 1200;
      pageModeRef.current = mode;
      setPageModeState(mode);
      if (!hasTab) return;
      const requestId = ++pageModeRequestId.current;
      void send<ViewerStateResponse>("setViewerState", { mode, live: pageLive }).then((resp) => {
        if (requestId !== pageModeRequestId.current) return;
        if (!resp || resp.success === false) {
          pageModeHoldUntil.current = 0;
          pageModeRef.current = previousPageMode;
          setPageModeState(previousPageMode);
          return;
        }
        applyPageState(resp, true);
      });
    },
    [hasTab, send, applyPageState, pageLive],
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
        return send<{ success?: boolean }>("rememberViewerAuto", {
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
      void send("resetViewerAuto", { scope: target }).then((r) => {
        if (r == null) fallback();
        else if ((r as { success?: boolean }).success === false) refreshSaved();
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
      msg: { action?: string; mode?: unknown; tabId?: unknown },
      sender?: { tab?: { id?: number } },
    ) => {
      if (msg?.action !== "viewerStateChanged") return;
      const tabId = typeof msg.tabId === "number" ? msg.tabId : sender?.tab?.id;
      if (tabId == null) {
        refreshPageState();
        return;
      }
      if (tabId !== tab.tabId) return;
      applyPageState({ mode: normalize(msg.mode) });
    };
    api.runtime.onMessage.addListener(onMessage);
    return () => api.runtime.onMessage.removeListener?.(onMessage);
  }, [hasTab, tab?.tabId, applyPageState, refreshPageState]);

  return useMemo(
    () => ({
      enabled,
      mode,
      pageMode,
      channel,
      channelName,
      scope,
      saved,
      savedValues,
      setEnabled,
      setMode: setPickedMode,
      setPageMode,
      save,
      resetScope,
      pickScope,
    }),
    [
      enabled,
      mode,
      pageMode,
      channel,
      channelName,
      scope,
      saved,
      savedValues,
      setEnabled,
      setPickedMode,
      setPageMode,
      save,
      resetScope,
      pickScope,
    ],
  );
}
