// Pure (no Node/browser-only APIs) so the same factory drives both the vitest
// suite and the headless screenshot harness — each just feeds it different data.

export interface MockData {
  messages?: Record<string, { message: string }>;
  settings?: Record<string, unknown>;
  speed?: { speed: number; live?: boolean; channel?: string | null; channelName?: string };
  monitor?: unknown;
  history?: unknown;
  tab?: { id: number; url: string };
  version?: string; // manifest version the popup header shows (screenshots pass the real one)
  failSetKeys?: string[];
  viewer?: {
    autoMode?: "off" | "normal" | "theater";
    pageMode?: "off" | "normal" | "theater";
    fitMode?: "contain" | "cover" | "fill";
    scope?: "global" | "site" | "channel" | null;
  };
}

type Cb = (arg?: unknown) => void;
type StorageChanges = Record<string, chrome.storage.StorageChange>;
type StorageListener = (changes: StorageChanges, areaName: "sync" | "local") => void;

function substitute(msg: string, subs?: string | string[]): string {
  if (subs == null) return msg;
  const arr = Array.isArray(subs) ? subs : [subs];
  return msg
    .replace(/\$(\d+)/g, (_m, i) => arr[Number(i) - 1] ?? "") // $1, $2 …
    .replace(/\$[A-Za-z_]\w*\$/g, () => arr.shift() ?? ""); // named $pct$ (positional)
}

export function createMockChrome(data: MockData = {}): typeof chrome {
  const store: Record<string, unknown> = { ...(data.settings || {}) };
  const tab = data.tab ?? { id: 1, url: "https://www.twitch.tv/example" };
  const storageListeners: StorageListener[] = [];
  const runtime = {
    id: "mock",
    lastError: null as unknown,
    onMessage: { addListener() {} },
    sendMessage(
      msg?: {
        action?: string;
        map?: string;
        set?: Record<string, unknown>;
        remove?: string[];
        clear?: boolean;
      },
      cb?: (response?: unknown) => void,
    ) {
      if (msg?.action !== "mutateStoredMap" || !msg.map) {
        cb?.(undefined);
        return;
      }
      if (data.failSetKeys?.includes(msg.map)) {
        cb?.({ success: false });
        return;
      }
      const current = { ...((store[msg.map] || {}) as Record<string, unknown>) };
      if (msg.clear) {
        delete store[msg.map];
        cb?.({ success: true });
        return;
      }
      for (const key of msg.remove || []) delete current[key];
      Object.assign(current, msg.set || {});
      if (Object.keys(current).length) store[msg.map] = current;
      else delete store[msg.map];
      cb?.({ success: true });
    },
    getManifest: () => ({ version: data.version ?? "0.0.0" }),
  };

  const emitStorageChanged = (changes: StorageChanges, areaName: "sync" | "local") => {
    for (const listener of [...storageListeners]) listener(changes, areaName);
  };

  const area = (areaName: "sync" | "local") => ({
    get(
      keys: string | string[] | Record<string, unknown> | null,
      cb: (items: Record<string, unknown>) => void,
    ) {
      let out: Record<string, unknown> = {};
      if (keys == null) out = { ...store };
      else if (typeof keys === "string") {
        if (keys in store) out[keys] = store[keys];
      } else if (Array.isArray(keys)) {
        for (const k of keys) if (k in store) out[k] = store[k];
      } else {
        out = { ...keys };
        for (const k of Object.keys(keys)) if (k in store) out[k] = store[k];
      }
      cb(out);
    },
    set(obj: Record<string, unknown>, cb?: () => void) {
      if (Object.keys(obj).some((key) => data.failSetKeys?.includes(key))) {
        runtime.lastError = { message: "mock storage set failed" };
        cb?.();
        runtime.lastError = null;
        return;
      }
      const changes: StorageChanges = {};
      for (const [key, newValue] of Object.entries(obj)) {
        changes[key] = { oldValue: store[key], newValue };
      }
      Object.assign(store, obj);
      cb?.();
      emitStorageChanged(changes, areaName);
    },
    remove(keys: string | string[], cb?: () => void) {
      const changes: StorageChanges = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        changes[k] = { oldValue: store[k], newValue: undefined };
        delete store[k];
      }
      cb?.();
      emitStorageChanged(changes, areaName);
    },
    onChanged: { addListener() {}, removeListener() {} },
  });

  const chromeMock = {
    i18n: {
      getMessage: (key: string, subs?: string | string[]) =>
        substitute(data.messages?.[key]?.message ?? "", subs),
      getUILanguage: () => "en",
    },
    storage: {
      sync: area("sync"),
      local: area("local"),
      onChanged: {
        addListener(listener: StorageListener) {
          storageListeners.push(listener);
        },
        removeListener(listener: StorageListener) {
          const idx = storageListeners.indexOf(listener);
          if (idx >= 0) storageListeners.splice(idx, 1);
        },
      },
    },
    runtime,
    action: {
      setBadgeText() {},
      setBadgeBackgroundColor() {},
      setBadgeTextColor() {},
      setIcon() {},
    },
    tabs: {
      query(_q: unknown, cb: (tabs: unknown[]) => void) {
        cb([tab]);
      },
      sendMessage(_id: number, msg: { action?: string; speed?: number }, cb?: Cb) {
        switch (msg?.action) {
          case "getSpeed":
            cb?.({
              speed: data.speed?.speed ?? 1,
              live: data.speed?.live ?? false,
              domain: "twitch.tv",
              channel: data.speed?.channel ?? null,
              channelName: data.speed?.channelName,
            });
            break;
          case "setSpeed":
            cb?.({ success: true, speed: msg.speed, live: data.speed?.live ?? false });
            break;
          case "getTarget":
            cb?.({
              target: data.monitor?.target ?? 5,
              scope: "site",
              channel: data.speed?.channel ?? null,
              channelName: data.speed?.channelName,
              live: data.speed?.live ?? false,
            });
            break;
          case "getAutoSlow":
            cb?.({
              enabled: true,
              target: 6,
              scope: "site",
              channel: data.speed?.channel ?? null,
              channelName: data.speed?.channelName,
            });
            break;
          case "getMonitor":
            cb?.(data.monitor ?? null);
            break;
          case "getHistory":
            cb?.(data.history ?? null);
            break;
          case "getViewerAuto":
            cb?.(
              data.viewer
                ? {
                    mode: data.viewer.autoMode ?? "off",
                    scope: data.viewer.scope ?? null,
                    channel: data.speed?.channel ?? null,
                    channelName: data.speed?.channelName,
                  }
                : undefined,
            );
            break;
          case "getViewerState":
            cb?.(data.viewer ? { mode: data.viewer.pageMode ?? "off" } : undefined);
            break;
          case "getViewerFit":
            cb?.(
              data.viewer
                ? {
                    mode: data.viewer.fitMode ?? "contain",
                    scope: data.viewer.scope ?? null,
                    channel: data.speed?.channel ?? null,
                    channelName: data.speed?.channelName,
                  }
                : undefined,
            );
            break;
          default:
            cb?.(undefined);
        }
      },
    },
  };

  return chromeMock as unknown as typeof chrome;
}
