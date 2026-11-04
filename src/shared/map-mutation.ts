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
  "viewerChatPanelSites",
  "viewerChatSideWidths",
] as const;

export type StoredMapName = (typeof STORED_MAP_NAMES)[number];
export interface StoredMapMutation {
  map: StoredMapName;
  set?: Record<string, unknown>;
  remove?: string[];
  clear?: boolean;
}

// Entry validators for the stored maps, shared by the background's map writes and
// the options backup import so neither can store an entry the readers choke on.
export function safeKey(key: string): boolean {
  return !!key && key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

function finite(value: unknown): value is number {
  return Number.isFinite(value);
}

export function validPosition(value: unknown): value is { fx: number; fy: number } {
  if (!value || typeof value !== "object") return false;
  const position = value as Record<string, unknown>;
  return (
    finite(position.fx) &&
    finite(position.fy) &&
    position.fx >= 0 &&
    position.fx <= 1 &&
    position.fy >= 0 &&
    position.fy <= 1
  );
}

// Per-site viewer chat entries. The settings registry clamps every number on
// read, so only the shape is checked here.
function validChatPanelPrefs(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const prefs = value as Record<string, unknown>;
  const numbers = ["opacity", "width", "height", "dx", "dy"].filter((k) => prefs[k] !== undefined);
  if (!numbers.every((k) => finite(prefs[k]))) return false;
  if (prefs.h !== undefined && prefs.h !== "left" && prefs.h !== "right") return false;
  if (prefs.v !== undefined && prefs.v !== "top" && prefs.v !== "bottom") return false;
  return numbers.length > 0 || prefs.h !== undefined || prefs.v !== undefined;
}

function validChatSideWidths(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const { normal, theater } = value as Record<string, unknown>;
  const widths = [normal, theater].filter((w) => w !== undefined);
  return widths.length > 0 && widths.every(finite);
}

export function validStoredMapValue(map: StoredMapName, value: unknown): boolean {
  if (map === "domains" || map === "channels") return finite(value) && value >= 0.1 && value <= 16;
  if (map === "syncTargets" || map === "syncTargetChannels")
    return finite(value) && value >= 1 && value <= 30;
  if (map === "autoSlowSites" || map === "autoSlowChannels") {
    if (!value || typeof value !== "object") return false;
    const target = (value as Record<string, unknown>).target;
    return finite(target) && target >= 3 && target <= 12;
  }
  if (map === "viewerAutoSites" || map === "viewerAutoChannels") {
    return value === "off" || value === "normal" || value === "theater";
  }
  if (map === "viewerFitSites" || map === "viewerFitChannels") {
    return value === "contain" || value === "cover" || value === "fill";
  }
  if (map === "badgePinned") return typeof value === "boolean";
  if (map === "viewerChatPanelSites") return validChatPanelPrefs(value);
  if (map === "viewerChatSideWidths") return validChatSideWidths(value);
  return validPosition(value);
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
