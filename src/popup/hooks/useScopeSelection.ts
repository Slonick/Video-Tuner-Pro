// Shared "Save for" scope state for the speed + live-sync cards: the selected
// scope, the per-scope "has a saved value" dots, the channel info, and the
// no-content-script storage fallbacks — all derived from a ScopeStorage
// descriptor so neither card duplicates this logic.
import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { STORE } from "../platform/storage.js";
import type { Scope, ScopeFlags, ScopeStorage } from "../lib/scope.js";

export interface ScopeSelection {
  scope: Scope;
  saved: ScopeFlags;
  channel: string | null;
  channelName: string;
  channelKey: MutableRefObject<string | null>;
  refreshSaved: () => void;
  applyChannel: (ch: string | null | undefined, name?: string | null) => void;
  defaultScope: (scope: Scope | null | undefined, hasChannel: boolean) => void;
  pickScope: (scope: Scope) => void;
  markSaved: (scope: Scope, on: boolean) => void;
  // Write/clear the selected scope straight to storage (global/site only — channel
  // needs the page). `value` is a number for speed/target, or a settings bundle for
  // auto-slow. `resetFallback` runs `done` once the store has been updated.
  saveFallback: (scope: Scope, value: unknown) => void;
  resetFallback: (scope: Scope, done: () => void) => void;
}

// `storage` must be a stable reference (define it as a module constant).
export function useScopeSelection(domain: string, storage: ScopeStorage): ScopeSelection {
  const [scope, setScope] = useState<Scope>("site");
  const [saved, setSaved] = useState<ScopeFlags>({ global: false, site: false, channel: false });
  const [channel, setChannel] = useState<string | null>(null);
  const [channelName, setChannelName] = useState("");
  const channelKey = useRef<string | null>(null);

  const refreshSaved = useCallback(() => {
    STORE.get([...storage.global, storage.siteMap, storage.channelMap], (r) => {
      const sites = (r[storage.siteMap] || {}) as Record<string, number>;
      const channels = (r[storage.channelMap] || {}) as Record<string, number>;
      setSaved({
        global: storage.global.some((k) => r[k] != null),
        site: !!domain && sites[domain] != null,
        channel: !!channelKey.current && channels[channelKey.current] != null,
      });
    });
  }, [domain, storage]);

  const applyChannel = useCallback(
    (ch: string | null | undefined, name?: string | null) => {
      setChannel(ch ?? null);
      if (name !== undefined) setChannelName(name || ch || "");
      setScope((s) => (!ch && s === "channel" ? "site" : s));
      if ((ch ?? null) !== channelKey.current) {
        channelKey.current = ch ?? null;
        refreshSaved();
      }
    },
    [refreshSaved],
  );

  const defaultScope = useCallback(
    (s: Scope | null | undefined, hasChannel: boolean) =>
      setScope(hasChannel && s === "channel" ? "channel" : "site"),
    [],
  );
  const pickScope = useCallback((s: Scope) => setScope(s), []);
  const markSaved = useCallback(
    (s: Scope, on: boolean) => setSaved((p) => ({ ...p, [s]: on })),
    [],
  );

  const saveFallback = useCallback(
    (s: Scope, value: unknown) => {
      if (s === "global") {
        STORE.set({ [storage.global[0]]: value });
        return;
      }
      if (s === "site" && domain) {
        STORE.get([storage.siteMap], (r) => {
          const map = { ...((r[storage.siteMap] || {}) as Record<string, unknown>) };
          map[domain] = value;
          STORE.set({ [storage.siteMap]: map });
        });
      }
    },
    [domain, storage],
  );

  const resetFallback = useCallback(
    (s: Scope, done: () => void) => {
      if (s === "global") {
        STORE.remove(storage.global, done);
        return;
      }
      if (s === "site" && domain) {
        STORE.get([storage.siteMap], (r) => {
          const map = { ...((r[storage.siteMap] || {}) as Record<string, number>) };
          delete map[domain];
          STORE.set({ [storage.siteMap]: map }, done);
        });
        return;
      }
      done();
    },
    [domain, storage],
  );

  return {
    scope,
    saved,
    channel,
    channelName,
    channelKey,
    refreshSaved,
    applyChannel,
    defaultScope,
    pickScope,
    markSaved,
    saveFallback,
    resetFallback,
  };
}
