import { STORE } from "./platform/storage.js";
import { debounce } from "./core/debounce.js";
import { byId } from "./dom.js";
import { autoExpandOnFirstEnable } from "./sections.js";

function clampTarget(n: unknown): number {
  const v = Number(n);
  if (Number.isNaN(v)) return 5;
  return Math.min(15, Math.max(0, Math.round(v)));
}

function clampMaxPercent(n: unknown): number {
  const v = Number(n);
  if (Number.isNaN(v)) return 150;
  return Math.min(300, Math.max(125, Math.round(v / 5) * 5));
}

function reflectSyncUI(enabled: boolean, target: number, maxPercent: number): void {
  byId<HTMLInputElement>("liveSyncToggle").checked = enabled;
  byId<HTMLInputElement>("syncTarget").value = String(target);
  byId("syncTargetVal").textContent = String(target);
  byId<HTMLInputElement>("syncMax").value = String(maxPercent);
  byId("syncMaxVal").textContent = String(maxPercent);
}

export function loadSyncSettings(): void {
  STORE.get(["liveSync", "liveSyncTarget", "liveSyncMax"], (result) => {
    reflectSyncUI(
      result.liveSync !== false,
      clampTarget(result.liveSyncTarget != null ? result.liveSyncTarget : 5),
      clampMaxPercent(Number(result.liveSyncMax != null ? result.liveSyncMax : 1.5) * 100)
    );
  });
}

const saveSyncTarget = debounce((v: number) => STORE.set({ liveSyncTarget: v }), 350);
const saveSyncMax = debounce((v: number) => STORE.set({ liveSyncMax: v }), 350);

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
byId<HTMLInputElement>("syncMax").addEventListener("input", (e) => {
  const percent = clampMaxPercent((e.target as HTMLInputElement).value);
  byId("syncMaxVal").textContent = String(percent);
  saveSyncMax(percent / 100);
});
