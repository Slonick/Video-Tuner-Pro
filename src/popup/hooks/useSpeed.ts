// Speed-card state + behaviour. Owns the playback speed (as a fraction), the live
// lock and the editable presets; scope selection + saved dots + storage fallbacks
// come from useScopeSelection. Talks to the content script via `send`, falling back
// to storage on pages with no content script.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STORE } from "../platform/storage.js";
import { clamp } from "../core/clamp.js";
import {
  normalizePresets,
  normalizePresetSet,
  normalizeSpeedMax,
  normalizeSpeedStep,
  SPEED_MAX_DEFAULT,
  STEP_DEFAULT,
} from "../../shared/presets.js";
import type { ActiveTab, SendToTab } from "./tab.js";
import type { Scope, ScopeFlags, ScopeStorage } from "../lib/scope.js";
import { useScopeSelection, type ScopeValues } from "./useScopeSelection.js";
import { useStored } from "./useStored.js";
import { pullAfter, type SpeedResponse } from "../lib/messaging.js";

const STORAGE: ScopeStorage = {
  global: ["globalSpeed"],
  siteMap: "domains",
  channelMap: "channels",
};
const sameArray = <T>(a: T[], b: T[]): boolean =>
  a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

// `v` is the speed fraction; `animate` says whether the readout/slider should
// glide to it (preset / ± / reset) or snap (drag / poll / load).
interface SpeedValue {
  v: number;
  animate: boolean;
}

export interface UseSpeed {
  speed: SpeedValue;
  presets: number[]; // editable percents, sorted (the grid + per-preset hotkeys)
  presetKeys: (string | null)[]; // hotkey chord per preset, aligned with `presets`
  pinned: boolean[]; // which presets show in the collapsed quick row, aligned with `presets`
  speedMax: number; // configurable upper bound for the slider (percent)
  speedStep: number; // per ± tap / keyboard step, as a fraction (e.g. 0.05)
  live: boolean;
  drm: boolean;
  viewerSupported: boolean;
  channel: string | null;
  channelName: string;
  scope: Scope;
  saved: ScopeFlags;
  savedValues: ScopeValues;
  isYouTube: boolean;
  setSpeed: (fraction: number) => void;
  nudge: (delta: number) => void;
  resetManual: () => void;
  resetScope: (target?: Scope) => void;
  save: (target?: Scope) => void | boolean | Promise<void | boolean>;
  pickScope: (scope: Scope) => void;
  sliderInput: (percent: number) => void;
  sliderCommit: (percent: number) => void;
}

export function useSpeed(tab: ActiveTab | null, send: SendToTab): UseSpeed {
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

  const [speed, setSpeedState] = useState<SpeedValue>({ v: 1, animate: false });
  const [presets, setPresets] = useState<number[]>(() => normalizePresets(undefined));
  const [presetKeys, setPresetKeys] = useState<(string | null)[]>(
    () => normalizePresetSet(undefined, undefined).keys,
  );
  const [pinned, setPinned] = useState<boolean[]>(
    () => normalizePresetSet(undefined, undefined).pinned,
  );
  const [speedMax, setSpeedMax] = useState<number>(SPEED_MAX_DEFAULT);
  const [speedStep, setSpeedStep] = useState<number>(STEP_DEFAULT / 100);
  const [live, setLive] = useState(false);
  const [drm, setDrm] = useState(false);
  const [viewerSupported, setViewerSupported] = useState(true);
  // Synchronous mirror so back-to-back nudges / a save right after one see the
  // latest value (no re-render between them).
  const speedRef = useRef(1);
  const sliderTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const userRevision = useRef(0);

  const isYouTube = /(^|\.)youtube(-nocookie)?\.com$/.test(domain);

  const apply = useCallback((v: number, animate: boolean) => {
    speedRef.current = v;
    setSpeedState((prev) => (prev.v === v && prev.animate === animate ? prev : { v, animate }));
  }, []);

  const touchUserSpeed = useCallback(() => {
    userRevision.current++;
  }, []);

  const applyResolved = useCallback(
    (resp: SpeedResponse) => {
      if (typeof resp.speed === "number") apply(resp.speed, true);
    },
    [apply],
  );

  // site > global > 100% (channel needs the page, absent here).
  const fallbackFromStorage = useCallback(
    (animate = false, expectedRevision?: number) => {
      STORE.get(["globalSpeed", STORAGE.siteMap], (r) => {
        if (expectedRevision != null && userRevision.current !== expectedRevision) return;
        const sites = (r[STORAGE.siteMap] || {}) as Record<string, number>;
        const v = sites[domain] ?? (r.globalSpeed as number | undefined) ?? 1;
        apply(clamp(v), animate);
      });
    },
    [domain, apply],
  );

  const sendSpeed = useCallback(
    (clamped: number) => {
      void send<SpeedResponse>("setSpeed", { speed: clamped }).then((resp) => {
        if (!resp) return;
        setLive(!!resp.live);
        // Re-sync only when the content script CLAMPED us (e.g. live forced 1×).
        if (
          typeof resp.speed === "number" &&
          Math.round(resp.speed * 100) !== Math.round(clamped * 100)
        ) {
          apply(resp.speed, false);
        }
      });
    },
    [send, apply],
  );

  const setSpeed = useCallback(
    (fraction: number) => {
      if (live) return;
      const clamped = clamp(fraction);
      touchUserSpeed();
      apply(clamped, true);
      sendSpeed(clamped);
    },
    [apply, live, sendSpeed, touchUserSpeed],
  );

  const nudge = useCallback(
    (delta: number) => setSpeed(clamp(speedRef.current) + delta),
    [setSpeed],
  );

  const resetManual = useCallback(() => {
    if (live) return;
    if (!hasTab) {
      fallbackFromStorage(true);
      return;
    }
    void send("resetToSaved").then((r) => {
      if (r == null) fallbackFromStorage(true);
      else pullAfter<SpeedResponse>(send, "getSpeed", applyResolved);
    });
  }, [hasTab, live, fallbackFromStorage, send, applyResolved]);

  // `target` defaults to the active scope, or the scope chosen from the menu.
  const resetScope = useCallback(
    (target: Scope = scope) => {
      if (live) return;
      // Channel has no off-page fallback (it needs the DOM) — revert to 1× instead.
      const fallback = () => {
        if (target === "channel") {
          refreshSaved();
          return;
        }
        resetFallback(target, (ok) => {
          if (ok !== false) markSaved(target, false);
          fallbackFromStorage(true);
        });
      };
      if (!hasTab) {
        fallback();
        return;
      }
      void send("reset", { scope: target }).then((r) => {
        if (r == null) fallback();
        else if ((r as { success?: boolean }).success === false) refreshSaved();
        // After clearing `target`, re-resolve: the value drops to the next scope
        // (channel > site > global > 100%) and the Save button retargets to it.
        else
          pullAfter<SpeedResponse>(send, "getSpeed", (resp) => {
            applyResolved(resp);
            defaultScope(resp.scope, !!resp.channel);
            refreshSaved();
          });
      });
    },
    [
      scope,
      live,
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

  const save = useCallback(
    (target: Scope = scope) => {
      if (live) return false;
      const v = clamp(speedRef.current);
      const fallback = () =>
        new Promise<boolean>((resolve) => {
          if (target === "channel") {
            refreshSaved();
            resolve(false);
            return;
          }
          saveFallback(target, v, (ok) => {
            if (ok === false) {
              refreshSaved();
              resolve(false);
              return;
            }
            markSaved(target, true, v);
            resolve(true);
          });
        });
      if (hasTab) {
        return send<{ success?: boolean }>("remember", { scope: target, speed: v }).then((r) => {
          if (r == null) return fallback();
          if (r.success === false) {
            refreshSaved();
            return false;
          }
          markSaved(target, true, v);
          return true;
        });
      }
      return fallback();
    },
    [scope, live, hasTab, send, saveFallback, markSaved, refreshSaved],
  );

  const sliderInput = useCallback(
    (percent: number) => {
      if (live) return;
      const clamped = clamp(percent / 100);
      touchUserSpeed();
      apply(clamped, false);
      clearTimeout(sliderTimer.current);
      sliderTimer.current = setTimeout(() => sendSpeed(clamped), 160);
    },
    [apply, live, sendSpeed, touchUserSpeed],
  );

  const sliderCommit = useCallback(
    (percent: number) => {
      if (live) return;
      clearTimeout(sliderTimer.current);
      touchUserSpeed();
      sendSpeed(clamp(percent / 100));
    },
    [live, sendSpeed, touchUserSpeed],
  );

  // Editable presets + slider bounds come from storage; stay subscribed so edits
  // on the options page (the presets editor / max speed) show in an open popup
  // without a reopen. Not tab-gated — they don't depend on the page.
  useStored(["speedPresets", "presetKeys", "presetPins", "speedMax", "speedStep"], (r) => {
    const set = normalizePresetSet(r.speedPresets, r.presetKeys, r.presetPins);
    setPresets((prev) => (sameArray(prev, set.presets) ? prev : set.presets));
    setPresetKeys((prev) => (sameArray(prev, set.keys) ? prev : set.keys));
    setPinned((prev) => (sameArray(prev, set.pinned) ? prev : set.pinned));
    const nextMax = normalizeSpeedMax(r.speedMax);
    const nextStep = normalizeSpeedStep(r.speedStep) / 100;
    setSpeedMax((prev) => (prev === nextMax ? prev : nextMax));
    setSpeedStep((prev) => (prev === nextStep ? prev : nextStep));
  });

  // Initial load: the page's resolved speed (or storage fallback).
  useEffect(() => {
    if (!tab) return;
    let resolved = false;
    let canceled = false;
    const initialRevision = userRevision.current;
    if (hasTab) {
      void send<SpeedResponse>("getSpeed").then((resp) => {
        if (canceled) return;
        if (resp && typeof resp.speed === "number") {
          resolved = true;
          if (userRevision.current === initialRevision) apply(resp.speed, false);
          setLive(!!resp.live);
          setDrm(!!resp.drm);
          setViewerSupported(resp.viewerSupported !== false);
          applyChannel(resp.channel, resp.channelName, resp.channelKeys);
          defaultScope(resp.scope, !!resp.channel);
          refreshSaved();
        } else {
          fallbackFromStorage(false, initialRevision);
          defaultScope(null, false);
          refreshSaved();
        }
      });
    } else {
      fallbackFromStorage(false, initialRevision);
      refreshSaved();
    }
    const t = setTimeout(() => {
      if (!resolved) fallbackFromStorage(false, initialRevision);
    }, 400);
    return () => {
      canceled = true;
      clearTimeout(t);
    };
  }, [tab, hasTab, send, apply, fallbackFromStorage, applyChannel, defaultScope, refreshSaved]);

  // Poll while open so live-sync speed changes show in the readout.
  const missesRef = useRef(0);
  useEffect(() => {
    if (!hasTab || !live) return;
    const id = setInterval(() => {
      void send<SpeedResponse>("getSpeed").then((resp) => {
        if (!resp) return;
        applyChannel(resp.channel, resp.channelName, resp.channelKeys);
        setDrm(!!resp.drm);
        setViewerSupported(resp.viewerSupported !== false);
        if (resp.live) {
          missesRef.current = 0;
          setLive(true);
          if (typeof resp.speed === "number") apply(resp.speed, false);
        } else if (++missesRef.current >= 4) {
          setLive(false);
        }
      });
    }, 1000);
    return () => {
      clearInterval(id);
      missesRef.current = 0;
    };
  }, [hasTab, live, send, applyChannel, apply]);

  useEffect(() => {
    if (!hasTab || live) return;
    const id = setInterval(() => {
      void send<SpeedResponse>("getSpeed").then((resp) => {
        if (!resp) return;
        applyChannel(resp.channel, resp.channelName, resp.channelKeys);
        setDrm(!!resp.drm);
        setViewerSupported(resp.viewerSupported !== false);
        if (resp.live) {
          missesRef.current = 0;
          setLive(true);
          if (typeof resp.speed === "number") apply(resp.speed, false);
        }
      });
    }, 1500);
    return () => {
      clearInterval(id);
      missesRef.current = 0;
    };
  }, [hasTab, live, send, applyChannel, apply]);

  return useMemo(
    () => ({
      speed,
      presets,
      presetKeys,
      pinned,
      speedMax,
      speedStep,
      live,
      drm,
      viewerSupported,
      channel: sc.channel,
      channelName: sc.channelName,
      scope,
      saved: sc.saved,
      savedValues: sc.savedValues,
      isYouTube,
      setSpeed,
      nudge,
      resetManual,
      resetScope,
      save,
      pickScope: sc.pickScope,
      sliderInput,
      sliderCommit,
    }),
    [
      speed,
      presets,
      presetKeys,
      pinned,
      speedMax,
      speedStep,
      live,
      drm,
      viewerSupported,
      sc.channel,
      sc.channelName,
      scope,
      sc.saved,
      sc.savedValues,
      isYouTube,
      setSpeed,
      nudge,
      resetManual,
      resetScope,
      save,
      sc.pickScope,
      sliderInput,
      sliderCommit,
    ],
  );
}
