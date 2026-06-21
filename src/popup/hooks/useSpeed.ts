// Speed-card state + behaviour. Owns the playback speed (as a fraction), the live
// lock and the editable presets; scope selection + saved dots + storage fallbacks
// come from useScopeSelection. Talks to the content script via `send`, falling back
// to storage on pages with no content script.
import { useCallback, useEffect, useRef, useState } from "react";
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
import { pullAfter, type SpeedResponse } from "../lib/messaging.js";

const STORAGE: ScopeStorage = {
  global: ["globalSpeed"],
  siteMap: "domains",
  channelMap: "channels",
};

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
  save: (target?: Scope) => void;
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
  // Synchronous mirror so back-to-back nudges / a save right after one see the
  // latest value (no re-render between them).
  const speedRef = useRef(1);
  const sliderTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const isYouTube = /(^|\.)youtube(-nocookie)?\.com$/.test(domain);

  const apply = useCallback((v: number, animate: boolean) => {
    speedRef.current = v;
    setSpeedState({ v, animate });
  }, []);

  const applyResolved = useCallback(
    (resp: SpeedResponse) => {
      if (typeof resp.speed === "number") apply(resp.speed, true);
    },
    [apply],
  );

  // site > global > 100% (channel needs the page, absent here).
  const fallbackFromStorage = useCallback(
    (animate = false) => {
      STORE.get(["globalSpeed", STORAGE.siteMap], (r) => {
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
      const clamped = clamp(fraction);
      apply(clamped, true);
      sendSpeed(clamped);
    },
    [apply, sendSpeed],
  );

  const nudge = useCallback(
    (delta: number) => setSpeed(clamp(speedRef.current) + delta),
    [setSpeed],
  );

  const resetManual = useCallback(() => {
    if (!hasTab) {
      fallbackFromStorage(true);
      return;
    }
    void send("resetToSaved").then((r) => {
      if (r == null) fallbackFromStorage(true);
      else pullAfter<SpeedResponse>(send, "getSpeed", applyResolved);
    });
  }, [hasTab, fallbackFromStorage, send, applyResolved]);

  // `target` defaults to the active scope, or the scope chosen from the menu.
  const resetScope = useCallback(
    (target: Scope = scope) => {
      markSaved(target, false);
      // Channel has no off-page fallback (it needs the DOM) — revert to 1× instead.
      const fallback = () =>
        target === "channel" ? setSpeed(1) : resetFallback(target, () => fallbackFromStorage(true));
      if (!hasTab) {
        fallback();
        return;
      }
      void send("reset", { scope: target }).then((r) => {
        if (r == null) fallback();
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
      hasTab,
      markSaved,
      resetFallback,
      fallbackFromStorage,
      setSpeed,
      send,
      applyResolved,
      defaultScope,
      refreshSaved,
    ],
  );

  const save = useCallback(
    (target: Scope = scope) => {
      const v = clamp(speedRef.current);
      if (hasTab) {
        void send("remember", { scope: target, speed: v }).then((r) => {
          if (r == null) saveFallback(target, v);
        });
      } else {
        saveFallback(target, v);
      }
      markSaved(target, true, v);
    },
    [scope, hasTab, send, saveFallback, markSaved],
  );

  const sliderInput = useCallback(
    (percent: number) => {
      const clamped = clamp(percent / 100);
      apply(clamped, false);
      clearTimeout(sliderTimer.current);
      sliderTimer.current = setTimeout(() => sendSpeed(clamped), 160);
    },
    [apply, sendSpeed],
  );

  const sliderCommit = useCallback(
    (percent: number) => {
      clearTimeout(sliderTimer.current);
      sendSpeed(clamp(percent / 100));
    },
    [sendSpeed],
  );

  // Initial load: editable presets, then the page's resolved speed (or storage).
  useEffect(() => {
    if (!tab) return;
    STORE.get(["speedPresets", "presetKeys", "presetPins", "speedMax", "speedStep"], (r) => {
      const set = normalizePresetSet(r.speedPresets, r.presetKeys, r.presetPins);
      setPresets(set.presets);
      setPresetKeys(set.keys);
      setPinned(set.pinned);
      setSpeedMax(normalizeSpeedMax(r.speedMax));
      setSpeedStep(normalizeSpeedStep(r.speedStep) / 100);
    });
    let resolved = false;
    if (hasTab) {
      void send<SpeedResponse>("getSpeed").then((resp) => {
        if (resp && typeof resp.speed === "number") {
          resolved = true;
          apply(resp.speed, false);
          setLive(!!resp.live);
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
      refreshSaved();
    }
    const t = setTimeout(() => {
      if (!resolved) fallbackFromStorage();
    }, 400);
    return () => clearTimeout(t);
  }, [tab, hasTab, send, apply, fallbackFromStorage, applyChannel, defaultScope, refreshSaved]);

  // Poll while open so live-sync speed changes show in the readout.
  const missesRef = useRef(0);
  useEffect(() => {
    if (!hasTab) return;
    const id = setInterval(() => {
      void send<SpeedResponse>("getSpeed").then((resp) => {
        if (!resp) return;
        applyChannel(resp.channel, resp.channelName);
        if (resp.live) {
          missesRef.current = 0;
          setLive(true);
          if (typeof resp.speed === "number") apply(resp.speed, false);
        } else if (++missesRef.current >= 4) {
          setLive(false);
        }
      });
    }, 1000);
    return () => clearInterval(id);
  }, [hasTab, send, applyChannel, apply]);

  return {
    speed,
    presets,
    presetKeys,
    pinned,
    speedMax,
    speedStep,
    live,
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
  };
}
