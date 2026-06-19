// Per-scope auto-slow settings (channel > site > global), mirroring live/target.ts.
// Each scope stores a bundle {on, sens, floor}; the highest-priority scope with an
// entry wins. Top-frame write guards match the rest of the scoped settings.
import { getDomain } from "../core/domain.js";
import { resolveAutoSlow, type AutoSlowSettings } from "../core/resolve.js";
import { channelKeys } from "../channel.js";
import { ctxValid } from "../platform/browser.js";
import { STORE } from "../platform/storage.js";
import { S } from "../state.js";
import { reapplyPrimaryRate } from "../speed.js";

type Map = Record<string, AutoSlowSettings>;

export function persistSiteAutoSlow(s: AutoSlowSettings): void {
  if (!ctxValid() || window.top !== window) return; // top frame only — see speed.ts
  STORE.get(["autoSlowSites"], (r) => {
    const m = (r.autoSlowSites || {}) as Map;
    m[getDomain()] = s;
    STORE.set({ autoSlowSites: m });
  });
}

export function persistChannelAutoSlow(s: AutoSlowSettings): void {
  if (!ctxValid() || window.top !== window) return;
  const keys = channelKeys();
  if (!keys.length) return;
  STORE.get(["autoSlowChannels"], (r) => {
    const m = (r.autoSlowChannels || {}) as Map;
    for (const k of keys) delete m[k];
    m[keys[0]] = s;
    STORE.set({ autoSlowChannels: m });
  });
}

export function persistGlobalAutoSlow(s: AutoSlowSettings): void {
  if (!ctxValid() || window.top !== window) return;
  STORE.set({ autoSlowGlobal: s });
}

// Set the resolved settings live, dropping any active slowdown when turned off so
// the user's speed is restored at once; turning on lets the sampler take over.
// Apply the scoped part (enable + target). The floor is a separate global setting
// (loaded/updated in the content entry), so it isn't touched here.
function applySettings(enabled: boolean, target: number): void {
  S.autoSlowEnabled = enabled;
  S.autoSlowTarget = target;
  if (!enabled && S.autoSlowFactor !== 1) {
    S.autoSlowFactor = 1;
    reapplyPrimaryRate();
  }
}

// Live preview (no persist) — the card's toggle/slider push the bundle here so the
// effect is audible before Save commits it. Mirrors live-sync's setTarget.
export function setAutoSlowPreview(s: AutoSlowSettings): void {
  applySettings(!!s.on, s.target);
}

function applyResolvedAutoSlow(
  site: Map,
  channels: Map,
  global: AutoSlowSettings | undefined,
): void {
  const r = resolveAutoSlow(channelKeys(), getDomain(), site, channels, global);
  S.autoSlowScope = r.scope;
  applySettings(r.enabled, r.target);
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
export function resetAutoSlowScope(scope: "channel" | "site" | "global"): void {
  if (!ctxValid()) return;
  STORE.get(["autoSlowSites", "autoSlowChannels", "autoSlowGlobal"], (r) => {
    const site = (r.autoSlowSites || {}) as Map;
    const channels = (r.autoSlowChannels || {}) as Map;
    let global = r.autoSlowGlobal as AutoSlowSettings | undefined;
    if (scope === "channel") {
      const keys = channelKeys();
      if (!keys.length) return;
      for (const k of keys) delete channels[k];
      STORE.set({ autoSlowChannels: channels });
    } else if (scope === "site") {
      delete site[getDomain()];
      STORE.set({ autoSlowSites: site });
    } else {
      global = undefined;
      STORE.remove("autoSlowGlobal");
    }
    applyResolvedAutoSlow(site, channels, global);
  });
}
