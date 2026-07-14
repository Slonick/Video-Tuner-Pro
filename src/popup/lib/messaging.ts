// Typed shapes for the content-script replies the popup reads, plus the shared
// "re-read after a scope change" helper. Keeps the hooks free of ad-hoc casts.
import type { Scope } from "./scope.js";
import type { SendToTab } from "../hooks/tab.js";

export interface SpeedResponse {
  speed: number;
  live?: boolean;
  channel?: string | null;
  channelKeys?: string[] | null;
  channelName?: string | null;
  scope?: Scope | null;
  drm?: boolean;
  viewerSupported?: boolean;
}

export interface TargetResponse {
  target: number;
  scope?: Scope | null;
  channel?: string | null;
  channelKeys?: string[] | null;
  channelName?: string | null;
  live?: boolean;
}

export interface AutoSlowResponse {
  enabled: boolean;
  target: number; // comfort ceiling, syllables/sec
  scope?: Scope | null;
  channel?: string | null;
  channelKeys?: string[] | null;
  channelName?: string | null;
}

export interface ViewerAutoResponse {
  mode: "off" | "normal" | "theater";
  scope?: Scope | null;
  channel?: string | null;
  channelKeys?: string[] | null;
  channelName?: string | null;
}

export interface ViewerStateResponse {
  mode: "off" | "normal" | "theater";
  success?: boolean;
}

export interface ViewerFitResponse {
  mode: "contain" | "cover" | "fill";
  scope?: Scope | null;
  channel?: string | null;
  channelKeys?: string[] | null;
  channelName?: string | null;
  success?: boolean;
}

// After the content script clears/re-resolves a scope, the new value isn't ready
// synchronously — re-read it shortly after and apply.
export function pullAfter<T>(
  send: SendToTab,
  action: string,
  apply: (resp: T) => void,
  delay = 80,
): void {
  setTimeout(() => {
    void send<T>(action).then((r) => {
      if (r) apply(r);
    });
  }, delay);
}
