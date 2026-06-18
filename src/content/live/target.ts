// Per-scope live-sync allowed delay (buffer target), mirroring speed.ts:
// channel > site > global > 5s, with the same top-frame write guards. The slider
// previews live via setTarget (no persist); Save/Reset go through remember/reset.
import { clampTarget } from "../core/clamp.js";
import { getDomain } from "../core/domain.js";
import { resolveSyncTarget, type TargetScope } from "../core/resolve.js";
import { channelKeys } from "../channel.js";
import { ctxValid } from "../platform/browser.js";
import { STORE } from "../platform/storage.js";
import { S } from "../state.js";
import { controlLive } from "./sync.js";

export function persistSiteTarget(target: number): void {
  if (!ctxValid() || window.top !== window) return; // top frame only — see speed.ts
  STORE.get(["syncTargets"], (r) => {
    const t = (r.syncTargets || {}) as Record<string, number>;
    t[getDomain()] = target;
    STORE.set({ syncTargets: t });
  });
}

export function persistChannelTarget(target: number): void {
  if (!ctxValid() || window.top !== window) return;
  const keys = channelKeys();
  if (!keys.length) return;
  STORE.get(["syncTargetChannels"], (r) => {
    const t = (r.syncTargetChannels || {}) as Record<string, number>;
    for (const k of keys) delete t[k];
    t[keys[0]] = target;
    STORE.set({ syncTargetChannels: t });
  });
}

export function persistGlobalTarget(target: number): void {
  if (!ctxValid() || window.top !== window) return;
  STORE.set({ syncTargetGlobal: target });
}

// Re-resolve the chain from the given maps and apply it (no persist).
function applyResolvedTarget(
  siteTargets: Record<string, number>,
  channelTargets: Record<string, number>,
  globalTarget: number | undefined,
): void {
  const r = resolveSyncTarget(
    channelKeys(),
    getDomain(),
    siteTargets,
    channelTargets,
    globalTarget,
  );
  S.targetScope = r.scope;
  S.liveSyncTarget = clampTarget(r.target);
  controlLive();
}

// Resolve + apply from storage. Used on channel change and storage updates.
export function applyResolvedTargetFromStore(): void {
  if (!ctxValid()) return;
  STORE.get(["syncTargets", "syncTargetChannels", "syncTargetGlobal", "liveSyncTarget"], (r) => {
    applyResolvedTarget(
      (r.syncTargets || {}) as Record<string, number>,
      (r.syncTargetChannels || {}) as Record<string, number>,
      (r.syncTargetGlobal ?? r.liveSyncTarget) as number | undefined,
    ); // legacy liveSyncTarget = old global
  });
}

// Drop the saved target for one scope and re-resolve the remaining chain.
export function resetTargetScope(scope: TargetScope): void {
  if (!ctxValid()) return;
  STORE.get(["syncTargets", "syncTargetChannels", "syncTargetGlobal", "liveSyncTarget"], (r) => {
    const site = (r.syncTargets || {}) as Record<string, number>;
    const channels = (r.syncTargetChannels || {}) as Record<string, number>;
    let global = (r.syncTargetGlobal ?? r.liveSyncTarget) as number | undefined;
    if (scope === "channel") {
      const keys = channelKeys();
      if (!keys.length) return;
      for (const k of keys) delete channels[k];
      STORE.set({ syncTargetChannels: channels });
    } else if (scope === "site") {
      delete site[getDomain()];
      STORE.set({ syncTargets: site });
    } else if (scope === "global") {
      global = undefined;
      STORE.remove(["syncTargetGlobal", "liveSyncTarget"]); // clear the new + legacy global
    } else {
      return;
    }
    applyResolvedTarget(site, channels, global);
  });
}

// Preview a target live without persisting (the slider drag). Mirrors the manual
// path of setSpeed; persistence is explicit, via Save → remember.
export function setTarget(target: number): void {
  S.liveSyncTarget = clampTarget(target);
  controlLive();
}
