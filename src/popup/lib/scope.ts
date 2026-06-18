// Save scope shared by the speed and live-sync cards: a value is stored at one of
// these levels and resolved by priority channel > site > global.
export type Scope = "global" | "site" | "channel";
export type ScopeFlags = Record<Scope, boolean>;

// Where each scope's value lives in storage — lets useScopeSelection derive the
// "has a saved value" dots and the no-content-script fallbacks generically.
export interface ScopeStorage {
  global: string[]; // global value keys; first present wins, first is the write target
  siteMap: string; // storage key of the per-site map (keyed by domain)
  channelMap: string; // storage key of the per-channel map (keyed by channel key)
}
