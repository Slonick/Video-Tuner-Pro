import { getExtensionApi } from "./extension-api.js";

export const STORED_MAP_NAMES = [
  "domains",
  "channels",
  "syncTargets",
  "syncTargetChannels",
  "autoSlowSites",
  "autoSlowChannels",
  "viewerAutoSites",
  "viewerAutoChannels",
  "viewerFitSites",
  "viewerFitChannels",
  "badgePos",
  "badgePinned",
  "overlayBtnPos",
  "overlayPanelPos",
] as const;

export type StoredMapName = (typeof STORED_MAP_NAMES)[number];
export interface StoredMapMutation {
  map: StoredMapName;
  set?: Record<string, unknown>;
  remove?: string[];
  clear?: boolean;
}

type Done = (ok?: boolean) => void;

const api = getExtensionApi();

export function mutateStoredMap(
  map: StoredMapName,
  set: Record<string, unknown>,
  remove: string[],
  done?: Done,
): void {
  let settled = false;
  const finish = (response?: { success?: boolean } | null) => {
    if (settled) return;
    settled = true;
    void api.runtime.lastError;
    done?.(response?.success === true);
  };
  try {
    const result = api.runtime.sendMessage(
      { action: "mutateStoredMap", map, set, remove },
      finish,
    ) as unknown as Promise<{ success?: boolean } | undefined> | undefined;
    if (result && typeof result.then === "function") {
      void result.then(
        (response) => finish(response),
        () => finish(null),
      );
    }
  } catch {
    finish(null);
  }
}

export function clearStoredMap(map: StoredMapName, done?: Done): void {
  let settled = false;
  const finish = (response?: { success?: boolean } | null) => {
    if (settled) return;
    settled = true;
    void api.runtime.lastError;
    done?.(response?.success === true);
  };
  try {
    const result = api.runtime.sendMessage(
      { action: "mutateStoredMap", map, clear: true },
      finish,
    ) as unknown as Promise<{ success?: boolean } | undefined> | undefined;
    if (result && typeof result.then === "function") {
      void result.then(
        (response) => finish(response),
        () => finish(null),
      );
    }
  } catch {
    finish(null);
  }
}
