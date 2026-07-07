// Resolve the page's playback speed from the saved-speed maps, by priority:
//   manual (the live S.currentSpeed, handled by the caller) >
//   channel > site > global > 100%.
// Pure (no DOM/storage) so it's shared by the content resolver and the per-scope
// reset, and unit-testable in isolation. The caller clamps the returned speed.
export type SpeedScope = "channel" | "site" | "global" | null;

function latestChannelKey<T>(channelKeys: string[], entries: Record<string, T>): string | null {
  if (!channelKeys.length) return null;
  const available = new Set(channelKeys);
  let latest: string | null = null;
  for (const key of Object.keys(entries)) {
    if (available.has(key) && entries[key] != null) latest = key;
  }
  return latest;
}

export function resolveSpeed(
  channelKeys: string[],
  domain: string,
  domains: Record<string, number>,
  channels: Record<string, number>,
  globalSpeed: number | undefined,
): { speed: number; scope: SpeedScope } {
  // A per-channel speed may be saved under EITHER the channel-id or the @handle
  // form (YouTube exposes both). If both forms exist, the most recently written
  // storage entry wins, so an older alias cannot shadow a fresh save.
  const chKey = latestChannelKey(channelKeys, channels);
  if (chKey != null) return { speed: channels[chKey], scope: "channel" };
  if (domains[domain] != null) return { speed: domains[domain], scope: "site" };
  if (globalSpeed != null) return { speed: globalSpeed, scope: "global" };
  return { speed: 1.0, scope: null };
}

// The live-sync allowed-delay (seconds), resolved the same way as speed:
//   channel > site > global > 5s default. Caller clamps the returned target.
export type TargetScope = "channel" | "site" | "global" | null;

export function resolveSyncTarget(
  channelKeys: string[],
  domain: string,
  siteTargets: Record<string, number>,
  channelTargets: Record<string, number>,
  globalTarget: number | undefined,
): { target: number; scope: TargetScope } {
  const chKey = latestChannelKey(channelKeys, channelTargets);
  if (chKey != null) return { target: channelTargets[chKey], scope: "channel" };
  if (siteTargets[domain] != null) return { target: siteTargets[domain], scope: "site" };
  if (globalTarget != null) return { target: globalTarget, scope: "global" };
  return { target: 5, scope: null };
}

// Auto-slow's target is saved per scope, resolved by the same priority. The
// feature enable is a separate global flag in the settings registry.
export type AutoSlowScope = "channel" | "site" | "global" | null;

export interface AutoSlowSettings {
  target: number; // comfort ceiling — syllables/sec (matches the graph's target line)
  on?: boolean; // legacy field from the old scoped-enable model; ignored.
}
export interface ResolvedAutoSlow {
  target: number;
  scope: AutoSlowScope;
}

export const AUTO_SLOW_DEFAULTS: AutoSlowSettings = { target: 6 };

function bundle(s: AutoSlowSettings, scope: AutoSlowScope): ResolvedAutoSlow {
  const target = Number(s.target);
  return {
    target: Number.isNaN(target) ? 6 : Math.min(12, Math.max(3, target)),
    scope,
  };
}

export function resolveAutoSlow(
  channelKeys: string[],
  domain: string,
  sites: Record<string, AutoSlowSettings>,
  channels: Record<string, AutoSlowSettings>,
  global: AutoSlowSettings | undefined,
): ResolvedAutoSlow {
  const chKey = latestChannelKey(channelKeys, channels);
  if (chKey != null) return bundle(channels[chKey], "channel");
  if (sites[domain] != null) return bundle(sites[domain], "site");
  if (global != null) return bundle(global, "global");
  return { target: 6, scope: null };
}

export type ViewerAutoMode = "off" | "normal" | "theater";
export type ViewerAutoScope = "channel" | "site" | "global" | null;

export function normalizeViewerAuto(raw: unknown): ViewerAutoMode {
  return raw === "normal" || raw === "theater" ? raw : "off";
}

export function resolveViewerAuto(
  channelKeys: string[],
  domain: string,
  sites: Record<string, ViewerAutoMode>,
  channels: Record<string, ViewerAutoMode>,
  global: unknown,
): { mode: ViewerAutoMode; scope: ViewerAutoScope } {
  const chKey = latestChannelKey(channelKeys, channels);
  if (chKey != null) return { mode: normalizeViewerAuto(channels[chKey]), scope: "channel" };
  if (sites[domain] != null) return { mode: normalizeViewerAuto(sites[domain]), scope: "site" };
  if (global != null) return { mode: normalizeViewerAuto(global), scope: "global" };
  return { mode: "off", scope: null };
}

export type ViewerFitMode = "contain" | "cover" | "fill";
export type ViewerFitScope = "channel" | "site" | "global" | null;

export function normalizeViewerFit(raw: unknown): ViewerFitMode {
  return raw === "cover" || raw === "fill" ? raw : "contain";
}

export function resolveViewerFit(
  channelKeys: string[],
  domain: string,
  sites: Record<string, ViewerFitMode>,
  channels: Record<string, ViewerFitMode>,
  global: unknown,
): { mode: ViewerFitMode; scope: ViewerFitScope } {
  const chKey = latestChannelKey(channelKeys, channels);
  if (chKey != null) return { mode: normalizeViewerFit(channels[chKey]), scope: "channel" };
  if (sites[domain] != null) return { mode: normalizeViewerFit(sites[domain]), scope: "site" };
  if (global != null) return { mode: normalizeViewerFit(global), scope: "global" };
  return { mode: "contain", scope: null };
}
