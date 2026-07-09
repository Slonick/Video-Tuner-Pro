// Shared "Save for" scope state for the speed + live-sync cards: the selected
// scope, the per-scope "has a saved value" dots, the channel info, and the
// no-content-script storage fallbacks — all derived from a ScopeStorage
// descriptor so neither card duplicates this logic.
import { useCallback, useRef, useState, type MutableRefObject } from "react";
import { STORE } from "../platform/storage.js";
import type { Scope, ScopeFlags, ScopeStorage } from "../lib/scope.js";
import { mutateStoredMap, type StoredMapName } from "../../shared/map-mutation.js";

export type ScopeValues = Record<Scope, unknown>;

export interface ScopeSelection {
  scope: Scope;
  saved: ScopeFlags;
  // The raw stored value per scope (number for speed/target, a bundle for auto-slow),
  // or null when nothing is saved there — for showing it in the Save menu.
  savedValues: ScopeValues;
  channel: string | null;
  channelName: string;
  channelKey: MutableRefObject<string | null>;
  channelKeys: MutableRefObject<string[]>;
  refreshSaved: () => void;
  applyChannel: (
    ch: string | null | undefined,
    name?: string | null,
    aliases?: string[] | null,
  ) => void;
  defaultScope: (scope: Scope | null | undefined, hasChannel: boolean) => void;
  pickScope: (scope: Scope) => void;
  markSaved: (scope: Scope, on: boolean, value?: unknown) => void;
  // Write/clear the selected scope straight to storage (global/site only — channel
  // needs the page). `value` is a number for speed/target, or a settings bundle for
  // auto-slow. `resetFallback` runs `done` once the store has been updated.
  saveFallback: (scope: Scope, value: unknown, done?: (ok?: boolean) => void) => void;
  resetFallback: (scope: Scope, done: (ok?: boolean) => void) => void;
}

// `storage` must be a stable reference (define it as a module constant).
export function useScopeSelection(domain: string, storage: ScopeStorage): ScopeSelection {
  const [scope, setScope] = useState<Scope>("site");
  const [saved, setSaved] = useState<ScopeFlags>({ global: false, site: false, channel: false });
  const [savedValues, setSavedValues] = useState<ScopeValues>({
    global: null,
    site: null,
    channel: null,
  });
  const [channel, setChannel] = useState<string | null>(null);
  const [channelName, setChannelName] = useState("");
  const channelKey = useRef<string | null>(null);
  const channelKeys = useRef<string[]>([]);

  const refreshSaved = useCallback(() => {
    STORE.get([...storage.global, storage.siteMap, storage.channelMap], (r) => {
      const sites = (r[storage.siteMap] || {}) as Record<string, unknown>;
      const channels = (r[storage.channelMap] || {}) as Record<string, unknown>;
      const globalKey = storage.global.find((k) => r[k] != null);
      const siteV = domain ? sites[domain] : undefined;
      const keys = new Set(channelKeys.current);
      let savedChannelKey: string | null = null;
      for (const key of Object.keys(channels)) {
        if (keys.has(key) && channels[key] != null) savedChannelKey = key;
      }
      const channelV = savedChannelKey ? channels[savedChannelKey] : undefined;
      setSaved({
        global: globalKey != null,
        site: siteV != null,
        channel: channelV != null,
      });
      setSavedValues({
        global: globalKey != null ? r[globalKey] : null,
        site: siteV != null ? siteV : null,
        channel: channelV != null ? channelV : null,
      });
    });
  }, [domain, storage]);

  const applyChannel = useCallback(
    (ch: string | null | undefined, name?: string | null, aliases?: string[] | null) => {
      const nextChannel = ch ?? null;
      const keys = Array.isArray(aliases)
        ? aliases.filter((k): k is string => typeof k === "string" && !!k)
        : [];
      if (nextChannel && !keys.includes(nextChannel)) keys.unshift(nextChannel);
      setChannel(nextChannel);
      if (name !== undefined) setChannelName(name || nextChannel || "");
      setScope((s) => (!ch && s === "channel" ? "site" : s));
      const changed =
        nextChannel !== channelKey.current ||
        keys.length !== channelKeys.current.length ||
        keys.some((k, i) => k !== channelKeys.current[i]);
      if (changed) {
        channelKey.current = nextChannel;
        channelKeys.current = keys;
        refreshSaved();
      }
    },
    [refreshSaved],
  );

  // Point the Save target at the scope the current value resolves FROM (channel >
  // site > global), so the menu's primary saves e.g. "everywhere" when the speed comes
  // from the global default. Falls back to Site when nothing is saved (s == null) or
  // a channel value exists but the page has no channel right now.
  const defaultScope = useCallback(
    (s: Scope | null | undefined, hasChannel: boolean) =>
      setScope(s === "channel" && hasChannel ? "channel" : s === "global" ? "global" : "site"),
    [],
  );
  const pickScope = useCallback((s: Scope) => setScope(s), []);
  // Optimistically reflect a save/clear (with the new value) so the menus update
  // without a storage round-trip; refreshSaved reconciles from storage afterwards.
  const markSaved = useCallback((s: Scope, on: boolean, value: unknown = null) => {
    setSaved((p) => ({ ...p, [s]: on }));
    setSavedValues((p) => ({ ...p, [s]: on ? value : null }));
  }, []);

  const saveFallback = useCallback(
    (s: Scope, value: unknown, done?: (ok?: boolean) => void) => {
      if (s === "global") {
        STORE.set({ [storage.global[0]]: value }, (ok) => {
          if (ok === false || storage.global.length === 1) {
            done?.(ok);
            return;
          }
          STORE.remove(storage.global.slice(1), done);
        });
        return;
      }
      if (s === "site" && domain) {
        mutateStoredMap(storage.siteMap as StoredMapName, { [domain]: value }, [], done);
        return;
      }
      done?.(false);
    },
    [domain, storage],
  );

  const resetFallback = useCallback(
    (s: Scope, done: (ok?: boolean) => void) => {
      if (s === "global") {
        STORE.remove(storage.global, done);
        return;
      }
      if (s === "site" && domain) {
        mutateStoredMap(storage.siteMap as StoredMapName, {}, [domain], done);
        return;
      }
      done(true);
    },
    [domain, storage],
  );

  return {
    scope,
    saved,
    savedValues,
    channel,
    channelName,
    channelKey,
    channelKeys,
    refreshSaved,
    applyChannel,
    defaultScope,
    pickScope,
    markSaved,
    saveFallback,
    resetFallback,
  };
}
