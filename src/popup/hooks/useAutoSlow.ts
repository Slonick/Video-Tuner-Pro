// Auto-slow TARGET state — the comfort ceiling, saved per scope (channel > site >
// global) like the live-sync allowed-delay. The slider previews live (setAutoSlow,
// no persist); Save commits the target to the chosen scope, Reset clears it. The
// master ON/OFF is a separate global flag (autoSlowEnabled, a StoredToggle in the
// card header), and the response dynamics live on the options page — neither here.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STORE } from "../platform/storage.js";
import { debounce } from "../core/debounce.js";
import type { ActiveTab, SendToTab } from "./tab.js";
import type { Scope, ScopeFlags, ScopeStorage } from "../lib/scope.js";
import { useScopeSelection, type ScopeValues } from "./useScopeSelection.js";
import { pullAfter, type AutoSlowResponse } from "../lib/messaging.js";

const STORAGE: ScopeStorage = {
  global: ["autoSlowGlobal"],
  siteMap: "autoSlowSites",
  channelMap: "autoSlowChannels",
};

interface Bundle {
  target: number;
}
const DEF: Bundle = { target: 6 };

export interface UseAutoSlow {
  target: number; // comfort ceiling, syllables/sec
  channel: string | null;
  scope: Scope;
  saved: ScopeFlags;
  savedValues: ScopeValues;
  setTarget: (v: number) => void;
  nudge: (delta: number) => void;
  save: (target?: Scope) => boolean | Promise<boolean>;
  resetManual: () => void;
  resetScope: (target?: Scope) => void;
  pickScope: (scope: Scope) => void;
}

export function useAutoSlow(tab: ActiveTab | null, send: SendToTab): UseAutoSlow {
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

  const [target, setTargetState] = useState(DEF.target);
  // Synchronous mirror so a Save right after a slider drag reads the latest value.
  const ref = useRef<Bundle>({ ...DEF });
  const userRevision = useRef(0);

  const apply = useCallback((b: Bundle) => {
    ref.current = { ...b };
    setTargetState(b.target);
  }, []);
  const applyResolved = useCallback((r: AutoSlowResponse) => apply({ target: r.target }), [apply]);

  // Live preview (no persist) — rebound when the tab (hence `send`) changes.
  const pushPreview = useCallback(() => {
    void send("setAutoSlow", { target: ref.current.target });
  }, [send]);
  const debounced = useRef(debounce(pushPreview, 160));
  useEffect(() => {
    debounced.current = debounce(pushPreview, 160);
  }, [pushPreview]);

  // No content script (no tab): resolve site > global from storage directly.
  const fromStorage = useCallback(
    (expectedRevision?: number) => {
      STORE.get(["autoSlowGlobal", "autoSlowSites"], (r) => {
        const sites = (r.autoSlowSites || {}) as Record<string, Bundle>;
        const b = (domain && sites[domain]) || (r.autoSlowGlobal as Bundle) || DEF;
        if (expectedRevision == null || userRevision.current === expectedRevision) {
          apply({ target: b.target ?? DEF.target });
        }
        defaultScope(null, false);
        refreshSaved();
      });
    },
    [domain, apply, defaultScope, refreshSaved],
  );

  const touchUserTarget = useCallback(() => {
    userRevision.current++;
  }, []);

  const setTarget = useCallback(
    (v: number) => {
      touchUserTarget();
      ref.current.target = v;
      setTargetState(v);
      debounced.current();
    },
    [touchUserTarget],
  );
  // Step the target, clamped to the slider's range; reads the ref so back-to-back
  // taps don't race a pending re-render.
  const nudge = useCallback(
    (delta: number) => setTarget(Math.min(12, Math.max(3, ref.current.target + delta))),
    [setTarget],
  );

  const save = useCallback(
    (target: Scope = scope) => {
      const b = { ...ref.current };
      const fallback = () =>
        new Promise<boolean>((resolve) => {
          if (target === "channel") {
            refreshSaved();
            resolve(false);
            return;
          }
          saveFallback(target, b, (ok) => {
            if (ok === false) {
              refreshSaved();
              resolve(false);
              return;
            }
            markSaved(target, true, b);
            resolve(true);
          });
        });
      if (hasTab) {
        return send<{ success?: boolean }>("rememberAutoSlow", {
          scope: target,
          target: b.target,
        }).then((r) => {
          if (r == null) return fallback();
          if (r.success === false) {
            refreshSaved();
            return false;
          }
          markSaved(target, true, b);
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
          fromStorage();
        });
      };
      if (!hasTab) {
        fallback();
        return;
      }
      void send<{ success?: boolean }>("resetAutoSlow", { scope: target }).then((r) => {
        if (r == null) fallback();
        else if (r.success === false) refreshSaved();
        // Re-resolve so the value drops to the next scope and Save retargets to it.
        else
          pullAfter<AutoSlowResponse>(send, "getAutoSlow", (resp) => {
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
    void send("resetAutoSlowToSaved").then((r) => {
      if (r == null) fromStorage();
      else pullAfter<AutoSlowResponse>(send, "getAutoSlow", applyResolved);
    });
  }, [hasTab, fromStorage, send, applyResolved]);

  useEffect(() => {
    if (!tab) return;
    const initialRevision = userRevision.current;
    let canceled = false;
    if (hasTab) {
      void send<AutoSlowResponse>("getAutoSlow").then((resp) => {
        if (canceled) return;
        if (!resp) {
          fromStorage(initialRevision);
          return;
        }
        if (userRevision.current === initialRevision) applyResolved(resp);
        applyChannel(resp.channel, resp.channelName, resp.channelKeys);
        defaultScope(resp.scope, !!resp.channel);
        refreshSaved();
      });
    } else {
      fromStorage(initialRevision);
    }
    return () => {
      canceled = true;
    };
  }, [
    tab,
    hasTab,
    send,
    apply,
    applyResolved,
    applyChannel,
    defaultScope,
    refreshSaved,
    fromStorage,
  ]);

  return useMemo(
    () => ({
      target,
      channel: sc.channel,
      scope,
      saved: sc.saved,
      savedValues: sc.savedValues,
      setTarget,
      nudge,
      save,
      resetManual,
      resetScope,
      pickScope: sc.pickScope,
    }),
    [
      target,
      sc.channel,
      scope,
      sc.saved,
      sc.savedValues,
      setTarget,
      nudge,
      save,
      resetManual,
      resetScope,
      sc.pickScope,
    ],
  );
}
