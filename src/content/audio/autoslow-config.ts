// Per-scope auto-slow target (channel > site > global), mirroring live/target.ts.
// The master enable and response dynamics are global registry settings.
import { getDomain } from "../core/domain.js";
import { resolveAutoSlow, type AutoSlowSettings } from "../core/resolve.js";
import { channelKeys } from "../channel.js";
import { ctxValid } from "../platform/browser.js";
import { STORE } from "../platform/storage.js";
import { S } from "../state.js";

type Map = Record<string, AutoSlowSettings>;
type Done = (ok?: boolean) => void;

export function persistSiteAutoSlow(s: AutoSlowSettings, done?: Done): void {
  if (!ctxValid() || window.top !== window) {
    done?.(false);
    return;
  } // top frame only — see speed.ts
  STORE.get(["autoSlowSites"], (r) => {
    const m = { ...((r.autoSlowSites || {}) as Map) };
    m[getDomain()] = s;
    STORE.set({ autoSlowSites: m }, done);
  });
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
  STORE.get(["autoSlowChannels"], (r) => {
    const m = { ...((r.autoSlowChannels || {}) as Map) };
    for (const k of keys) delete m[k];
    m[keys[0]] = s;
    STORE.set({ autoSlowChannels: m }, done);
  });
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

export function applyResolvedAutoSlowFromStore(): void {
  if (!ctxValid()) return;
  STORE.get(["autoSlowSites", "autoSlowChannels", "autoSlowGlobal"], (r) => {
    applyResolvedAutoSlow(
      (r.autoSlowSites || {}) as Map,
      (r.autoSlowChannels || {}) as Map,
      r.autoSlowGlobal as AutoSlowSettings | undefined,
    );
  });
}

// Drop the saved bundle for one scope and re-resolve the remaining chain.
export function resetAutoSlowScope(scope: "channel" | "site" | "global", done?: Done): void {
  if (!ctxValid()) {
    done?.(false);
    return;
  }
  STORE.get(["autoSlowSites", "autoSlowChannels", "autoSlowGlobal"], (r) => {
    const site = { ...((r.autoSlowSites || {}) as Map) };
    const channels = { ...((r.autoSlowChannels || {}) as Map) };
    let global = r.autoSlowGlobal as AutoSlowSettings | undefined;
    const finish = (ok?: boolean) => {
      if (ok === false) {
        done?.(false);
        return;
      }
      applyResolvedAutoSlow(site, channels, global);
      done?.(true);
    };
    if (scope === "channel") {
      const keys = channelKeys();
      if (!keys.length) {
        done?.(false);
        return;
      }
      for (const k of keys) delete channels[k];
      if (Object.keys(channels).length) STORE.set({ autoSlowChannels: channels }, finish);
      else STORE.remove("autoSlowChannels", finish);
    } else if (scope === "site") {
      delete site[getDomain()];
      if (Object.keys(site).length) STORE.set({ autoSlowSites: site }, finish);
      else STORE.remove("autoSlowSites", finish);
    } else {
      global = undefined;
      STORE.remove("autoSlowGlobal", finish);
    }
  });
}
