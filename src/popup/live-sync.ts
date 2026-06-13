import { STORE } from "./platform/storage.js";
import { debounce } from "./core/debounce.js";
import { byId } from "./dom.js";
import { autoExpandOnFirstEnable } from "./sections.js";

function clampTarget(n: unknown): number {
  const v = Number(n);
  if (Number.isNaN(v)) return 5;
  // Floor of 1s, matching the content script — 0 would mean perpetual catch-up.
  return Math.min(30, Math.max(1, Math.round(v)));
}

function reflectSyncUI(enabled: boolean, target: number): void {
  byId<HTMLInputElement>("liveSyncToggle").checked = enabled;
  byId<HTMLInputElement>("syncTarget").value = String(target);
  byId("syncTargetVal").textContent = String(target);
}

export function loadSyncSettings(): void {
  STORE.get(["liveSync", "liveSyncTarget"], (result) => {
    reflectSyncUI(
      result.liveSync !== false,
      clampTarget(result.liveSyncTarget != null ? result.liveSyncTarget : 5)
    );
  });
}

const saveSyncTarget = debounce((v: number) => STORE.set({ liveSyncTarget: v }), 350);

byId<HTMLInputElement>("liveSyncToggle").addEventListener("change", (e) => {
  const checked = (e.target as HTMLInputElement).checked;
  STORE.set({ liveSync: checked });
  autoExpandOnFirstEnable(checked, "syncBody", "liveSyncSeen");
});
byId<HTMLInputElement>("syncTarget").addEventListener("input", (e) => {
  const target = clampTarget((e.target as HTMLInputElement).value);
  byId("syncTargetVal").textContent = String(target);
  saveSyncTarget(target);
});
