// Pure (no Node/browser-only APIs) so the same factory drives both the vitest
// suite and the headless screenshot harness — each just feeds it different data.

export interface MockData {
  messages?: Record<string, { message: string }>;
  settings?: Record<string, unknown>;
  speed?: { speed: number; live?: boolean; channel?: string | null; channelName?: string };
  monitor?: unknown;
  history?: unknown;
  tab?: { id: number; url: string };
  version?: string;   // manifest version the popup header shows (screenshots pass the real one)
}

type Cb = (arg?: unknown) => void;

function substitute(msg: string, subs?: string | string[]): string {
  if (subs == null) return msg;
  const arr = Array.isArray(subs) ? subs : [subs];
  return msg
    .replace(/\$(\d+)/g, (_m, i) => arr[Number(i) - 1] ?? "")          // $1, $2 …
    .replace(/\$[A-Za-z_]\w*\$/g, () => arr.shift() ?? "");            // named $pct$ (positional)
}

export function createMockChrome(data: MockData = {}): typeof chrome {
  const store: Record<string, unknown> = { ...(data.settings || {}) };
  const tab = data.tab ?? { id: 1, url: "https://www.twitch.tv/example" };

  const area = () => ({
    get(keys: string | string[] | Record<string, unknown> | null, cb: (items: Record<string, unknown>) => void) {
      let out: Record<string, unknown> = {};
      if (keys == null) out = { ...store };
      else if (typeof keys === "string") { if (keys in store) out[keys] = store[keys]; }
      else if (Array.isArray(keys)) { for (const k of keys) if (k in store) out[k] = store[k]; }
      else { out = { ...keys }; for (const k of Object.keys(keys)) if (k in store) out[k] = store[k]; }
      cb(out);
    },
    set(obj: Record<string, unknown>, cb?: () => void) { Object.assign(store, obj); cb?.(); },
    remove(keys: string | string[], cb?: () => void) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
      cb?.();
    },
    onChanged: { addListener() {} },
  });

  const chromeMock = {
    i18n: {
      getMessage: (key: string, subs?: string | string[]) => substitute(data.messages?.[key]?.message ?? "", subs),
      getUILanguage: () => "en",
    },
    storage: { sync: area(), local: area(), onChanged: { addListener() {} } },
    runtime: {
      id: "mock", lastError: null as unknown, onMessage: { addListener() {} }, sendMessage() {},
      getManifest: () => ({ version: data.version ?? "0.0.0" }),
    },
    action: {
      setBadgeText() {}, setBadgeBackgroundColor() {}, setBadgeTextColor() {}, setIcon() {},
    },
    tabs: {
      query(_q: unknown, cb: (tabs: unknown[]) => void) { cb([tab]); },
      sendMessage(_id: number, msg: { action?: string; speed?: number }, cb?: Cb) {
        switch (msg?.action) {
          case "getSpeed":   cb?.({ speed: data.speed?.speed ?? 1, live: data.speed?.live ?? false, domain: "twitch.tv", channel: data.speed?.channel ?? null, channelName: data.speed?.channelName }); break;
          case "setSpeed":   cb?.({ success: true, speed: msg.speed, live: data.speed?.live ?? false }); break;
          case "getMonitor": cb?.(data.monitor ?? null); break;
          case "getHistory": cb?.(data.history ?? null); break;
          default:           cb?.(undefined);
        }
      },
    },
  };

  return chromeMock as unknown as typeof chrome;
}
