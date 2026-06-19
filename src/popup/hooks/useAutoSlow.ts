// Auto-slow card state — a per-scope bundle (enable + sensitivity + floor),
// resolved and saved like the live-sync allowed-delay (channel > site > global).
// The toggle/sliders preview live (setAutoSlow, no persist); Save commits the
// bundle to the chosen scope, Reset clears it. The global response dynamics
// (hold/reaction/ease-back) live on the options page, not here.
import { useCallback, useEffect, useRef, useState } from "react";
import { STORE } from "../platform/storage.js";
import { debounce } from "../core/debounce.js";
import type { ActiveTab, SendToTab } from "./tab.js";
import type { Scope, ScopeFlags, ScopeStorage } from "../lib/scope.js";
import { useScopeSelection } from "./useScopeSelection.js";
import { pullAfter, type AutoSlowResponse } from "../lib/messaging.js";

const STORAGE: ScopeStorage = {
  global: ["autoSlowGlobal"],
  siteMap: "autoSlowSites",
  channelMap: "autoSlowChannels",
};

interface Bundle {
  on: boolean;
  target: number;
}
const DEF: Bundle = { on: false, target: 6 };

export interface UseAutoSlow {
  enabled: boolean;
  target: number; // comfort ceiling, syllables/sec
  channel: string | null;
  scope: Scope;
  saved: ScopeFlags;
  setEnabled: (on: boolean) => void;
  setTarget: (v: number) => void;
  nudge: (delta: number) => void;
  save: () => void;
  resetManual: () => void;
  resetScope: () => void;
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

  const [enabled, setEnabledState] = useState(false);
  const [target, setTargetState] = useState(DEF.target);
  // Synchronous mirror so a Save right after a slider drag reads the latest values.
  const ref = useRef<Bundle>({ ...DEF });

  const apply = useCallback((b: Bundle) => {
    ref.current = { ...b };
    setEnabledState(b.on);
    setTargetState(b.target);
  }, []);
  const applyResolved = useCallback(
    (r: AutoSlowResponse) => apply({ on: !!r.enabled, target: r.target }),
    [apply],
  );

  // Live preview (no persist) — rebound when the tab (hence `send`) changes.
  const pushPreview = useCallback(() => {
    const b = ref.current;
    void send("setAutoSlow", { enabled: b.on, target: b.target });
  }, [send]);
  const debounced = useRef(debounce(pushPreview, 160));
  useEffect(() => {
    debounced.current = debounce(pushPreview, 160);
  }, [pushPreview]);

  // No content script (no tab): resolve site > global from storage directly.
  const fromStorage = useCallback(() => {
    STORE.get(["autoSlowGlobal", "autoSlowSites"], (r) => {
      const sites = (r.autoSlowSites || {}) as Record<string, Bundle>;
      const b = (domain && sites[domain]) || (r.autoSlowGlobal as Bundle) || DEF;
      apply({ on: !!b.on, target: b.target ?? DEF.target });
      defaultScope(null, false);
      refreshSaved();
    });
  }, [domain, apply, defaultScope, refreshSaved]);

  const setEnabled = useCallback(
    (on: boolean) => {
      ref.current.on = on;
      setEnabledState(on);
      pushPreview(); // toggling takes effect at once
    },
    [pushPreview],
  );
  const setTarget = useCallback((v: number) => {
    ref.current.target = v;
    setTargetState(v);
    debounced.current();
  }, []);
  // Step the target, clamped to the slider's range; reads the ref so back-to-back
  // taps don't race a pending re-render.
  const nudge = useCallback(
    (delta: number) => setTarget(Math.min(12, Math.max(3, ref.current.target + delta))),
    [setTarget],
  );

  const save = useCallback(() => {
    const b = { ...ref.current };
    markSaved(scope, true);
    if (hasTab) {
      void send("rememberAutoSlow", { scope, enabled: b.on, target: b.target }).then((r) => {
        if (r == null) saveFallback(scope, b);
      });
    } else {
      saveFallback(scope, b);
    }
  }, [scope, hasTab, send, saveFallback, markSaved]);

  const resetScope = useCallback(() => {
    markSaved(scope, false);
    const fallback = () => resetFallback(scope, fromStorage);
    if (!hasTab) {
      fallback();
      return;
    }
    void send("resetAutoSlow", { scope }).then((r) => {
      if (r == null) fallback();
      else pullAfter<AutoSlowResponse>(send, "getAutoSlow", applyResolved);
    });
  }, [scope, hasTab, markSaved, resetFallback, fromStorage, send, applyResolved]);

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
    if (hasTab) {
      void send<AutoSlowResponse>("getAutoSlow").then((resp) => {
        if (!resp) {
          fromStorage();
          return;
        }
        applyResolved(resp);
        applyChannel(resp.channel);
        defaultScope(resp.scope, !!resp.channel);
        refreshSaved();
      });
    } else {
      fromStorage();
    }
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

  return {
    enabled,
    target,
    channel: sc.channel,
    scope,
    saved: sc.saved,
    setEnabled,
    setTarget,
    nudge,
    save,
    resetManual,
    resetScope,
    pickScope: sc.pickScope,
  };
}
