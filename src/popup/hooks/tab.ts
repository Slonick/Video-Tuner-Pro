// Active-tab resolution + a typed messaging helper. The popup talks to the
// content script in the active tab; both are resolved once when the popup opens.
import { useCallback, useEffect, useState } from "react";
import { api, getActiveTab } from "../platform/browser.js";
import { normalizeHost } from "../core/domain.js";

export interface ActiveTab {
  tabId: number | null;
  domain: string;
}

// Resolve the active tab's id + normalized domain once. `null` until resolved.
export function useActiveTab(): ActiveTab | null {
  const [tab, setTab] = useState<ActiveTab | null>(null);
  useEffect(() => {
    let alive = true;
    void getActiveTab().then((t) => {
      if (!alive) return;
      let domain = "";
      try {
        domain = t && t.url ? normalizeHost(new URL(t.url).hostname) : "";
      } catch {
        domain = "";
      }
      setTab({ tabId: t?.id ?? null, domain });
    });
    return () => {
      alive = false;
    };
  }, []);
  return tab;
}

// Sends an action to the content script; resolves to the typed reply, or null
// when there's no tab / no receiver (the caller falls back to storage).
export type SendToTab = <T = Record<string, unknown>>(
  action: string,
  payload?: Record<string, unknown>,
) => Promise<T | null>;

// A stable `send` bound to the active tab (memoized on tabId).
export function useTabMessaging(tabId: number | null): SendToTab {
  return useCallback(
    <T = Record<string, unknown>>(action: string, payload?: Record<string, unknown>) =>
      new Promise<T | null>((resolve) => {
        if (tabId == null) {
          resolve(null);
          return;
        }
        api.tabs.sendMessage(tabId, { action, ...payload }, (resp) => {
          resolve(api.runtime.lastError || !resp ? null : (resp as T));
        });
      }),
    [tabId],
  ) as SendToTab;
}
