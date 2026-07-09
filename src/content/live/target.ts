// Per-scope live-sync allowed delay (buffer target), mirroring speed.ts:
// channel > site > global > 5s, with the same top-frame write guards. The slider
// previews live via setTarget (no persist); Save/Reset go through remember/reset.
import { clampTarget } from "../core/clamp.js";
import { getDomain } from "../core/domain.js";
import { resolveSyncTarget, type TargetScope } from "../core/resolve.js";
import { channelKeys } from "../channel.js";
import { ctxValid } from "../platform/browser.js";
import { STORE } from "../platform/storage.js";
import { mutateStoredMap } from "../../shared/map-mutation.js";
import { S } from "../state.js";
import { controlLive } from "./sync.js";

type Done = (ok?: boolean) => void;

export function persistSiteTarget(target: number, done?: Done): void {
  if (!ctxValid() || window.top !== window) {
    done?.(false);
    return;
  } // top frame only — see speed.ts
  mutateStoredMap("syncTargets", { [getDomain()]: target }, [], done);
}

export function persistChannelTarget(target: number, done?: Done): void {
  if (!ctxValid() || window.top !== window) {
    done?.(false);
    return;
  }
  const keys = channelKeys();
  if (!keys.length) {
    done?.(false);
    return;
  }
  mutateStoredMap("syncTargetChannels", { [keys[0]]: target }, keys.slice(1), done);
}

export function persistGlobalTarget(target: number, done?: Done): void {
  if (!ctxValid() || window.top !== window) {
    done?.(false);
    return;
  }
  STORE.set({ syncTargetGlobal: target }, (ok) => {
    if (ok === false) {
      done?.(false);
      return;
    }
    STORE.remove("liveSyncTarget", done);
  });
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
export function applyResolvedTargetFromStore(done?: Done): void {
  if (!ctxValid()) {
    done?.(false);
    return;
  }
  STORE.get(["syncTargets", "syncTargetChannels", "syncTargetGlobal", "liveSyncTarget"], (r) => {
    applyResolvedTarget(
      (r.syncTargets || {}) as Record<string, number>,
      (r.syncTargetChannels || {}) as Record<string, number>,
      (r.syncTargetGlobal ?? r.liveSyncTarget) as number | undefined,
    ); // legacy liveSyncTarget = old global
    done?.(true);
  });
}

// Drop the saved target for one scope and re-resolve the remaining chain.
export function resetTargetScope(scope: TargetScope, done?: Done): void {
  if (!ctxValid()) {
    done?.(false);
    return;
  }
  const finish = (ok?: boolean) => {
    if (ok === false) done?.(false);
    else applyResolvedTargetFromStore(done);
  };
  if (scope === "channel") {
    const keys = channelKeys();
    if (!keys.length) {
      done?.(false);
      return;
    }
    mutateStoredMap("syncTargetChannels", {}, keys, finish);
  } else if (scope === "site") {
    mutateStoredMap("syncTargets", {}, [getDomain()], finish);
  } else if (scope === "global") {
    STORE.remove(["syncTargetGlobal", "liveSyncTarget"], finish);
  } else done?.(false);
}

// Preview a target live without persisting (the slider drag). Mirrors the manual
// path of setSpeed; persistence is explicit, via Save → remember.
export function setTarget(target: number): void {
  S.liveSyncTarget = clampTarget(target);
  controlLive();
}
