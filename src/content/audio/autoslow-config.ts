// Per-scope auto-slow target (channel > site > global), mirroring live/target.ts.
// The master enable and response dynamics are global registry settings.
import { getDomain } from "../core/domain.js";
import { resolveAutoSlow, type AutoSlowSettings } from "../core/resolve.js";
import { channelKeys } from "../channel.js";
import { ctxValid } from "../platform/browser.js";
import { STORE } from "../platform/storage.js";
import { mutateStoredMap } from "../../shared/map-mutation.js";
import { S } from "../state.js";

type Map = Record<string, AutoSlowSettings>;
type Done = (ok?: boolean) => void;

export function persistSiteAutoSlow(s: AutoSlowSettings, done?: Done): void {
  if (!ctxValid() || window.top !== window) {
    done?.(false);
    return;
  } // top frame only — see speed.ts
  mutateStoredMap("autoSlowSites", { [getDomain()]: s }, [], done);
}

export function persistChannelAutoSlow(s: AutoSlowSettings, done?: Done): void {
  if (!ctxValid() || window.top !== window) {
    done?.(false);
    return;
  }
  const keys = channelKeys();
  if (!keys.length) {
    done?.(false);
    return;
  }
  mutateStoredMap("autoSlowChannels", { [keys[0]]: s }, keys.slice(1), done);
}

export function persistGlobalAutoSlow(s: AutoSlowSettings, done?: Done): void {
  if (!ctxValid() || window.top !== window) {
    done?.(false);
    return;
  }
  STORE.set({ autoSlowGlobal: s }, done);
}

// Apply the scoped part — just the target. The master enable is a global flag
// (registry-loaded; the sampler resets the slowdown when it's off) and the floor /
// response dynamics are global too, so none of those are touched here.
function applySettings(target: number): void {
  S.autoSlowTarget = target;
}

// Live preview (no persist) — the card's target slider pushes the target here so
// the effect is audible before Save commits it. Mirrors live-sync's setTarget.
export function setAutoSlowPreview(s: AutoSlowSettings): void {
  applySettings(s.target);
}

function applyResolvedAutoSlow(
  site: Map,
  channels: Map,
  global: AutoSlowSettings | undefined,
): void {
  const r = resolveAutoSlow(channelKeys(), getDomain(), site, channels, global);
  S.autoSlowScope = r.scope;
  applySettings(r.target);
}

export function applyResolvedAutoSlowFromStore(done?: Done): void {
  if (!ctxValid()) {
    done?.(false);
    return;
  }
  STORE.get(["autoSlowSites", "autoSlowChannels", "autoSlowGlobal"], (r) => {
    applyResolvedAutoSlow(
      (r.autoSlowSites || {}) as Map,
      (r.autoSlowChannels || {}) as Map,
      r.autoSlowGlobal as AutoSlowSettings | undefined,
    );
    done?.(true);
  });
}

// Drop the saved bundle for one scope and re-resolve the remaining chain.
export function resetAutoSlowScope(scope: "channel" | "site" | "global", done?: Done): void {
  if (!ctxValid()) {
    done?.(false);
    return;
  }
  const finish = (ok?: boolean) => {
    if (ok === false) done?.(false);
    else applyResolvedAutoSlowFromStore(done);
  };
  if (scope === "channel") {
    const keys = channelKeys();
    if (!keys.length) {
      done?.(false);
      return;
    }
    mutateStoredMap("autoSlowChannels", {}, keys, finish);
  } else if (scope === "site") {
    mutateStoredMap("autoSlowSites", {}, [getDomain()], finish);
  } else STORE.remove("autoSlowGlobal", finish);
}
