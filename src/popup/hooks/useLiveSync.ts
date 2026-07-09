// Live-sync card state + behaviour. Owns the on/off toggle and the allowed delay
// (seconds); scope selection + saved dots + storage fallbacks come from
// useScopeSelection. Dragging previews live (setTarget); Save commits (rememberTarget).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STORE } from "../platform/storage.js";
import { debounce } from "../core/debounce.js";
import type { ActiveTab, SendToTab } from "./tab.js";
import type { Scope, ScopeFlags, ScopeStorage } from "../lib/scope.js";
import { useScopeSelection, type ScopeValues } from "./useScopeSelection.js";
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
  savedValues: ScopeValues;
  previewTarget: (seconds: number) => void; // slider drag (live preview, no persist)
  nudge: (delta: number) => void;
  save: (target?: Scope) => boolean | Promise<boolean>;
  resetManual: () => void;
  resetScope: (target?: Scope) => void;
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
  const userRevision = useRef(0);
  const setTarget = useCallback((t: number) => {
    targetRef.current = t;
    setTargetState(t);
  }, []);
  const touchUserTarget = useCallback(() => {
    userRevision.current++;
  }, []);

  const fromStorage = useCallback(
    (expectedRevision?: number) => {
      STORE.get([...STORAGE.global, STORAGE.siteMap], (r) => {
        const sites = (r[STORAGE.siteMap] || {}) as Record<string, number>;
        const v =
          domain && sites[domain] != null
            ? sites[domain]
            : (r.syncTargetGlobal ?? r.liveSyncTarget);
        if (expectedRevision == null || userRevision.current === expectedRevision) {
          setTarget(clampTarget(v));
        }
        defaultScope(null, false);
        refreshSaved();
      });
    },
    [domain, defaultScope, refreshSaved, setTarget],
  );

  // Dragging previews the delay live (no persist) — Save commits it. Rebind the
  // debounced sender whenever the tab (hence `send`) changes.
  const preview = useRef(debounce((v: number) => void send("setTarget", { target: v }), 160));
  useEffect(() => {
    preview.current = debounce((v: number) => void send("setTarget", { target: v }), 160);
  }, [send]);

  const previewTarget = useCallback(
    (seconds: number) => {
      const t = clampTarget(seconds);
      touchUserTarget();
      setTarget(t);
      preview.current(t);
    },
    [setTarget, touchUserTarget],
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

  const save = useCallback(
    (target: Scope = scope) => {
      const t = clampTarget(targetRef.current);
      const fallback = () =>
        new Promise<boolean>((resolve) => {
          if (target === "channel") {
            refreshSaved();
            resolve(false);
            return;
          }
          saveFallback(target, t, (ok) => {
            if (ok === false) {
              refreshSaved();
              resolve(false);
              return;
            }
            markSaved(target, true, t);
            resolve(true);
          });
        });
      if (hasTab) {
        return send<{ success?: boolean }>("rememberTarget", { scope: target, target: t }).then(
          (r) => {
            if (r == null) return fallback();
            if (r.success === false) {
              refreshSaved();
              return false;
            }
            markSaved(target, true, t);
            return true;
          },
        );
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
          fromStorage();
        });
      };
      if (!hasTab) {
        fallback();
        return;
      }
      void send<{ success?: boolean }>("resetTarget", { scope: target }).then((r) => {
        if (r == null) fallback();
        else if (r.success === false) refreshSaved();
        // Re-resolve so the value drops to the next scope and Save retargets to it.
        else
          pullAfter<TargetResponse>(send, "getTarget", (resp) => {
            markSaved(target, false);
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
      fromStorage,
      send,
      applyResolved,
      defaultScope,
      refreshSaved,
    ],
  );

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
    const initialRevision = userRevision.current;
    let canceled = false;
    STORE.get(["liveSync"], (r) => setEnabledState(r.liveSync !== false));
    if (hasTab) {
      void send<TargetResponse>("getTarget").then((resp) => {
        if (canceled) return;
        if (resp && typeof resp.target === "number") {
          if (userRevision.current === initialRevision) setTarget(clampTarget(resp.target));
          applyChannel(resp.channel, resp.channelName, resp.channelKeys);
          defaultScope(resp.scope, !!resp.channel);
          refreshSaved();
        } else {
          fromStorage(initialRevision);
        }
      });
    } else {
      fromStorage(initialRevision);
    }
    return () => {
      canceled = true;
    };
  }, [tab, hasTab, send, setTarget, applyChannel, defaultScope, refreshSaved, fromStorage]);

  return useMemo(
    () => ({
      enabled,
      setEnabled,
      target,
      channel: sc.channel,
      scope,
      saved: sc.saved,
      savedValues: sc.savedValues,
      previewTarget,
      nudge,
      save,
      resetManual,
      resetScope,
      pickScope: sc.pickScope,
    }),
    [
      enabled,
      setEnabled,
      target,
      sc.channel,
      scope,
      sc.saved,
      sc.savedValues,
      previewTarget,
      nudge,
      save,
      resetManual,
      resetScope,
      sc.pickScope,
    ],
  );
}
