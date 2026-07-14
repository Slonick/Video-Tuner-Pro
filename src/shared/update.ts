// Update checking. Both stores auto-update the extension on their own schedule;
// this only surfaces a "new version available" marker in the popup header.
// Chrome reports it via requestUpdateCheck/onUpdateAvailable; Firefox has neither,
// so we detect a newer version by comparing the manifest against the public AMO API.
import { getExtensionApi } from "./extension-api.js";

// Persisted by the background check, read by the popup header.
export const UPDATE_AVAILABLE_KEY = "updateAvailable";
export const UPDATE_LATEST_KEY = "updateLatestVersion";

export const UPDATE_ALARM = "vtp-update-check";
export const UPDATE_PERIOD_MIN = 360; // 6h — matches the stores' own cadence

// AMO's public read API returns the latest published version for Firefox, where
// there's no requestUpdateCheck(). Keyed by the gecko id from the manifest.
const AMO_ADDON_ID = "video-speed-controller-pro@slonick.dev";
const AMO_API_URL = `https://addons.mozilla.org/api/v5/addons/addon/${AMO_ADDON_ID}/`;

// Chrome ships requestUpdateCheck/onUpdateAvailable; Firefox ships neither.
export function hasUpdateApi(): boolean {
  try {
    const api = getExtensionApi();
    return typeof api?.runtime?.requestUpdateCheck === "function";
  } catch {
    return false;
  }
}

// Compare dotted numeric versions ("3.0.10" > "3.0.9"). Returns >0 if a > b,
// <0 if a < b, 0 if equal. Non-numeric / missing parts count as 0.
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = parseInt(pa[i] ?? "0", 10) || 0;
    const db = parseInt(pb[i] ?? "0", 10) || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

export function currentVersion(): string {
  try {
    const api = getExtensionApi();
    return api?.runtime?.getManifest().version ?? "0";
  } catch {
    return "0";
  }
}

// Fetch the latest published version from AMO (Firefox). Returns null on any
// failure — a flaky network check should never surface as an error to the user.
export async function fetchAmoLatest(): Promise<string | null> {
  try {
    const res = await fetch(AMO_API_URL, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { current_version?: { version?: string } };
    return data?.current_version?.version ?? null;
  } catch {
    return null;
  }
}
