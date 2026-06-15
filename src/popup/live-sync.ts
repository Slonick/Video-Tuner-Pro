import { api, getActiveTab } from "./platform/browser.js";
import { STORE } from "./platform/storage.js";
import { normalizeHost } from "./core/domain.js";
import { debounce } from "./core/debounce.js";
import { msg } from "./i18n.js";
import { byId } from "./dom.js";
import { movePill } from "./core/seg-pill.js";
import { autoExpandOnFirstEnable } from "./sections.js";

type Scope = "global" | "site" | "channel";

function clampTarget(n: unknown): number {
  const v = Number(n);
  if (Number.isNaN(v)) return 5;
  // Floor of 1s, matching the content script — 0 would mean perpetual catch-up.
  return Math.min(30, Math.max(1, Math.round(v)));
}

// The allowed delay is saved per scope (channel > site > global). Messaging needs
// the active tab; the channel key + scope come back from the content's getTarget.
let tabId: number | null = null;
let domain = "";
let channelKey: string | null = null;

// --- Scope picker (mirrors the speed card's, scoped to #syncScopeSeg) ----------
function scopeOpts(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#syncScopeSeg .scope-opt"));
}
function selectedScope(): Scope {
  return (scopeOpts().find((b) => b.classList.contains("active"))?.dataset.scope as Scope) || "site";
}
function selectScope(scope: Scope): void {
  scopeOpts().forEach((b) => {
    const on = b.dataset.scope === scope;
    b.classList.toggle("active", on);
    b.setAttribute("aria-checked", String(on));
  });
  movePill(byId("syncScopeSeg"));
}
function markScopeSaved(scope: Scope, on: boolean): void {
  scopeOpts().find((b) => b.dataset.scope === scope)?.classList.toggle("has-saved", on);
}
// "Slot has a saved delay" dots, read straight from storage (legacy liveSyncTarget
// counts as the old global).
function refreshScopeSaved(): void {
  STORE.get(["syncTargets", "syncTargetChannels", "syncTargetGlobal", "liveSyncTarget"], (r) => {
    const site = (r.syncTargets || {}) as Record<string, number>;
    const channels = (r.syncTargetChannels || {}) as Record<string, number>;
    const has: Record<Scope, boolean> = {
      global: (r.syncTargetGlobal ?? r.liveSyncTarget) != null,
      site: !!domain && site[domain] != null,
      channel: !!channelKey && channels[channelKey] != null,
    };
    scopeOpts().forEach((b) => b.classList.toggle("has-saved", has[b.dataset.scope as Scope]));
  });
}
// The Channel segment shows only when the page reports a channel.
function setChannel(channel: string | null | undefined): void {
  const on = !!channel;
  byId("syncScopeSeg").classList.toggle("has-channel", on);
  if (!on && selectedScope() === "channel") selectScope("site");
  movePill(byId("syncScopeSeg"));
  if ((channel ?? null) !== channelKey) {
    channelKey = channel ?? null;
    refreshScopeSaved();
  }
}

function reflectTarget(target: number): void {
  byId<HTMLInputElement>("syncTarget").value = String(target);
  byId("syncTargetVal").textContent = String(target);
}

// Default the picker to "site"; only preselect "channel" when the applied delay
// actually came from a channel save — same rule as the speed card.
function applyDefaultScope(scope: string | null | undefined, hasChannel: boolean): void {
  selectScope(hasChannel && scope === "channel" ? "channel" : "site");
}

function flashSaved(btn: HTMLElement): void {
  const original = btn.textContent;
  btn.textContent = msg("savedFeedback");
  btn.style.background = "#4caf50";
  setTimeout(() => { btn.textContent = original; btn.style.background = ""; }, 1500);
}

// Mirror of the content resolver for the no-content-script display path:
// site > global > 5s (channel needs the page, absent here).
function targetFromStorage(): void {
  STORE.get(["syncTargets", "syncTargetGlobal", "liveSyncTarget"], (r) => {
    const site = (r.syncTargets || {}) as Record<string, number>;
    const v = (domain && site[domain] != null) ? site[domain] : (r.syncTargetGlobal ?? r.liveSyncTarget);
    reflectTarget(clampTarget(v));
    applyDefaultScope(null, false);   // no page → default to Site, like the speed card
    refreshScopeSaved();
  });
}

export async function loadSyncSettings(): Promise<void> {
  const tab = await getActiveTab();
  tabId = tab?.id ?? null;
  try { domain = tab && tab.url ? normalizeHost(new URL(tab.url).hostname) : ""; }
  catch (e) { domain = ""; }

  STORE.get(["liveSync"], (r) => { byId<HTMLInputElement>("liveSyncToggle").checked = r.liveSync !== false; });

  if (tabId != null) {
    api.tabs.sendMessage(tabId, { action: "getTarget" }, (resp) => {
      if (!api.runtime.lastError && resp && typeof resp.target === "number") {
        reflectTarget(clampTarget(resp.target));
        setChannel(resp.channel);
        applyDefaultScope(resp.scope, !!resp.channel);
        refreshScopeSaved();
      } else {
        targetFromStorage();
      }
    });
  } else {
    targetFromStorage();
  }
}

// No content script (chrome:// / store pages): write the scope's target straight
// to storage. The channel scope needs the page DOM, so it has no fallback.
function saveScopeFallback(scope: Scope, target: number): void {
  if (scope === "global") { STORE.set({ syncTargetGlobal: target }); return; }
  if (scope === "site" && domain) {
    STORE.get(["syncTargets"], (r) => {
      const t = (r.syncTargets || {}) as Record<string, number>;
      t[domain] = target;
      STORE.set({ syncTargets: t });
    });
  }
}

function saveTarget(): void {
  const target = clampTarget(byId<HTMLInputElement>("syncTarget").value);
  const scope = selectedScope();
  if (tabId != null) {
    api.tabs.sendMessage(tabId, { action: "rememberTarget", scope, target }, () => {
      if (api.runtime.lastError) saveScopeFallback(scope, target);
    });
  } else {
    saveScopeFallback(scope, target);
  }
  markScopeSaved(scope, true);
  flashSaved(byId("syncSetBtn"));
}

function resetScopeFallback(scope: Scope): void {
  if (scope === "global") { STORE.remove(["syncTargetGlobal", "liveSyncTarget"], targetFromStorage); return; }
  if (scope === "site" && domain) {
    STORE.get(["syncTargets"], (r) => {
      const t = (r.syncTargets || {}) as Record<string, number>;
      delete t[domain];
      STORE.set({ syncTargets: t }, targetFromStorage);
    });
  } else {
    targetFromStorage();
  }
}

function resetTarget(): void {
  const scope = selectedScope();
  markScopeSaved(scope, false); // the slot is being cleared
  const id = tabId;
  if (id == null) { resetScopeFallback(scope); return; }
  api.tabs.sendMessage(id, { action: "resetTarget", scope }, () => {
    if (api.runtime.lastError) { resetScopeFallback(scope); return; }
    // Content cleared the scope and re-resolved; pull the new value back.
    setTimeout(() => api.tabs.sendMessage(id, { action: "getTarget" }, (r) => {
      if (!api.runtime.lastError && r && typeof r.target === "number") reflectTarget(clampTarget(r.target));
    }), 80);
  });
}

// Revert a previewed/manual delay back to the saved value (channel > site >
// global > 5s), without forgetting anything — mirrors the speed card's reset.
function resetTargetManual(): void {
  const id = tabId;
  if (id == null) { targetFromStorage(); return; }
  api.tabs.sendMessage(id, { action: "resetTargetToSaved" }, () => {
    if (api.runtime.lastError) { targetFromStorage(); return; }
    setTimeout(() => api.tabs.sendMessage(id, { action: "getTarget" }, (r) => {
      if (!api.runtime.lastError && r && typeof r.target === "number") reflectTarget(clampTarget(r.target));
    }), 80);
  });
}

// Dragging previews the delay live (no persist) — Save commits it to the scope.
const previewTarget = debounce((v: number) => {
  if (tabId != null) api.tabs.sendMessage(tabId, { action: "setTarget", target: v }, () => { void api.runtime.lastError; });
}, 160);

byId<HTMLInputElement>("liveSyncToggle").addEventListener("change", (e) => {
  const checked = (e.target as HTMLInputElement).checked;
  STORE.set({ liveSync: checked });
  autoExpandOnFirstEnable(checked, "syncBody", "liveSyncSeen");
});
byId<HTMLInputElement>("syncTarget").addEventListener("input", (e) => {
  const target = clampTarget((e.target as HTMLInputElement).value);
  byId("syncTargetVal").textContent = String(target);
  previewTarget(target);
});
// The −/+ buttons nudge the delay by 1 s (moving the slider + readout together).
function nudgeTarget(delta: number): void {
  const target = clampTarget(Number(byId<HTMLInputElement>("syncTarget").value) + delta);
  reflectTarget(target);
  previewTarget(target);
}
byId("syncDown").addEventListener("click", () => nudgeTarget(-1));
byId("syncUp").addEventListener("click", () => nudgeTarget(1));
byId("syncReset").addEventListener("click", resetTargetManual);
scopeOpts().forEach((btn) => {
  btn.addEventListener("click", () => selectScope(btn.dataset.scope as Scope));
});
byId("syncResetBtn").addEventListener("click", resetTarget);
byId("syncSetBtn").addEventListener("click", saveTarget);
