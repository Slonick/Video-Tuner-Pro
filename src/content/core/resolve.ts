// Resolve the page's playback speed from the saved-speed maps, by priority:
//   manual (the live S.currentSpeed, handled by the caller) >
//   channel > site > global > 100%.
// Pure (no DOM/storage) so it's shared by the content resolver and the per-scope
// reset, and unit-testable in isolation. The caller clamps the returned speed.
export type SpeedScope = "channel" | "site" | "global" | null;

export function resolveSpeed(
  channelKeys: string[],
  domain: string,
  domains: Record<string, number>,
  channels: Record<string, number>,
  globalSpeed: number | undefined,
): { speed: number; scope: SpeedScope } {
  // A per-channel speed may be saved under EITHER the channel-id or the @handle
  // form (YouTube exposes both) — the first match wins over the site speed.
  const chKey = channelKeys.find((k) => channels[k] != null);
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
  const chKey = channelKeys.find((k) => channelTargets[k] != null);
  if (chKey != null) return { target: channelTargets[chKey], scope: "channel" };
  if (siteTargets[domain] != null) return { target: siteTargets[domain], scope: "site" };
  if (globalTarget != null) return { target: globalTarget, scope: "global" };
  return { target: 5, scope: null };
}
