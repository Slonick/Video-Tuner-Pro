// Live-sync settings (global, persisted in storage): the toggle, allowed-delay
// target, and max catch-up rate.
import { STORE, debounce } from "./env.js";
import { autoExpandOnFirstEnable } from "./sections.js";

function clampTarget(n) {
  n = Number(n);
  if (Number.isNaN(n)) return 5;
  return Math.min(15, Math.max(0, Math.round(n)));
}

function clampMaxPercent(n) {
  n = Number(n);
  if (Number.isNaN(n)) return 150;
  return Math.min(300, Math.max(125, Math.round(n / 5) * 5));
}

function reflectSyncUI(enabled, target, maxPercent) {
  document.getElementById("liveSyncToggle").checked = enabled;
  document.getElementById("syncTarget").value = target;
  document.getElementById("syncTargetVal").textContent = target;
  document.getElementById("syncMax").value = maxPercent;
  document.getElementById("syncMaxVal").textContent = maxPercent;
}

export function loadSyncSettings() {
  STORE.get(["liveSync", "liveSyncTarget", "liveSyncMax"], (result) => {
    reflectSyncUI(
      result.liveSync !== false,
      clampTarget(result.liveSyncTarget != null ? result.liveSyncTarget : 5),
      clampMaxPercent((result.liveSyncMax != null ? result.liveSyncMax : 1.5) * 100)
    );
  });
}

const saveSyncTarget = debounce((v) => STORE.set({ liveSyncTarget: v }), 350);
const saveSyncMax = debounce((v) => STORE.set({ liveSyncMax: v }), 350);

document.getElementById("liveSyncToggle").addEventListener("change", (e) => {
  STORE.set({ liveSync: e.target.checked });
  autoExpandOnFirstEnable(e.target.checked, "syncBody", "liveSyncSeen");
});
document.getElementById("syncTarget").addEventListener("input", (e) => {
  const target = clampTarget(e.target.value);
  document.getElementById("syncTargetVal").textContent = target;
  saveSyncTarget(target);
});
document.getElementById("syncMax").addEventListener("input", (e) => {
  const percent = clampMaxPercent(e.target.value);
  document.getElementById("syncMaxVal").textContent = percent;
  saveSyncMax(percent / 100);
});
