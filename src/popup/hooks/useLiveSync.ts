// Live-sync card state + behaviour. Owns the on/off toggle and the allowed delay
// (seconds); scope selection + saved dots + storage fallbacks come from
// useScopeSelection. Dragging previews live (setTarget); Save commits (rememberTarget).
import { useCallback, useEffect, useRef, useState } from "react";
import { STORE } from "../platform/storage.js";
import { debounce } from "../core/debounce.js";
import type { ActiveTab, SendToTab } from "./tab.js";
import type { Scope, ScopeFlags, ScopeStorage } from "../lib/scope.js";
import { useScopeSelection } from "./useScopeSelection.js";
import { pullAfter, type TargetResponse } from "../lib/messaging.js";

const STORAGE: ScopeStorage = {
  global: ["syncTargetGlobal", "liveSyncTarget"],
  siteMap: "syncTargets",
  channelMap: "syncTargetChannels",
};

function clampTarget(n: unknown): number {
  const v = Number(n);
  if (Number.isNaN(v)) return 5;
  return Math.min(30, Math.max(1, Math.round(v)));
}

export interface UseLiveSync {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  target: number;
  channel: string | null;
  scope: Scope;
  saved: ScopeFlags;
  previewTarget: (seconds: number) => void; // slider drag (live preview, no persist)
  nudge: (delta: number) => void;
  save: () => void;
  resetManual: () => void;
  resetScope: () => void;
  pickScope: (scope: Scope) => void;
}

export function useLiveSync(tab: ActiveTab | null, send: SendToTab): UseLiveSync {
  const domain = tab?.domain ?? "";
  const hasTab = tab?.tabId != null;
  const sc = useScopeSelection(domain, STORAGE);
  const {
    scope,
    applyChannel,
    defaultScope,
    refreshSaved,
    markSaved,
    saveFallback,
    resetFallback,
  } = sc;

  const [enabled, setEnabledState] = useState(true);
  const [target, setTargetState] = useState(3);
  // Synchronous mirror so back-to-back nudges see the latest value (no re-render).
  const targetRef = useRef(3);
  const setTarget = useCallback((t: number) => {
    targetRef.current = t;
    setTargetState(t);
  }, []);

  const fromStorage = useCallback(() => {
    STORE.get([...STORAGE.global, STORAGE.siteMap], (r) => {
      const sites = (r[STORAGE.siteMap] || {}) as Record<string, number>;
      const v =
        domain && sites[domain] != null ? sites[domain] : (r.syncTargetGlobal ?? r.liveSyncTarget);
      setTarget(clampTarget(v));
      defaultScope(null, false);
      refreshSaved();
    });
  }, [domain, defaultScope, refreshSaved, setTarget]);

  // Dragging previews the delay live (no persist) — Save commits it. Rebind the
  // debounced sender whenever the tab (hence `send`) changes.
  const preview = useRef(debounce((v: number) => void send("setTarget", { target: v }), 160));
  useEffect(() => {
    preview.current = debounce((v: number) => void send("setTarget", { target: v }), 160);
  }, [send]);

  const previewTarget = useCallback(
    (seconds: number) => {
      const t = clampTarget(seconds);
      setTarget(t);
      preview.current(t);
    },
    [setTarget],
  );

  const nudge = useCallback(
    (delta: number) => previewTarget(targetRef.current + delta),
    [previewTarget],
  );

  const applyResolved = useCallback(
    (resp: TargetResponse) => {
      if (typeof resp.target === "number") setTarget(clampTarget(resp.target));
    },
    [setTarget],
  );

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    STORE.set({ liveSync: on });
  }, []);

  const save = useCallback(() => {
    const t = clampTarget(targetRef.current);
    if (hasTab) {
      void send("rememberTarget", { scope, target: t }).then((r) => {
        if (r == null) saveFallback(scope, t);
      });
    } else {
      saveFallback(scope, t);
    }
    markSaved(scope, true);
  }, [scope, hasTab, send, saveFallback, markSaved]);

  const resetScope = useCallback(() => {
    markSaved(scope, false);
    const fallback = () => resetFallback(scope, fromStorage);
    if (!hasTab) {
      fallback();
      return;
    }
    void send("resetTarget", { scope }).then((r) => {
      if (r == null) fallback();
      else pullAfter<TargetResponse>(send, "getTarget", applyResolved);
    });
  }, [scope, hasTab, markSaved, resetFallback, fromStorage, send, applyResolved]);

  const resetManual = useCallback(() => {
    if (!hasTab) {
      fromStorage();
      return;
    }
    void send("resetTargetToSaved").then((r) => {
      if (r == null) fromStorage();
      else pullAfter<TargetResponse>(send, "getTarget", applyResolved);
    });
  }, [hasTab, fromStorage, send, applyResolved]);

  useEffect(() => {
    if (!tab) return;
    STORE.get(["liveSync"], (r) => setEnabledState(r.liveSync !== false));
    if (hasTab) {
      void send<TargetResponse>("getTarget").then((resp) => {
        if (resp && typeof resp.target === "number") {
          setTarget(clampTarget(resp.target));
          applyChannel(resp.channel);
          defaultScope(resp.scope, !!resp.channel);
          refreshSaved();
        } else {
          fromStorage();
        }
      });
    } else {
      fromStorage();
    }
  }, [tab, hasTab, send, setTarget, applyChannel, defaultScope, refreshSaved, fromStorage]);

  return {
    enabled,
    setEnabled,
    target,
    channel: sc.channel,
    scope,
    saved: sc.saved,
    previewTarget,
    nudge,
    save,
    resetManual,
    resetScope,
    pickScope: sc.pickScope,
  };
}
