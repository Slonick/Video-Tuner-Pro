import { describe, it, expect, vi, beforeEach } from "vitest";

// Dev hot-reload for unpacked installs: the module registers its alarm listener
// synchronously at import (MV3 requirement), initDevReload() gates on
// installType, and a stamp change triggers runtime.reload().
const h = vi.hoisted(() => ({
  alarmListener: null as ((a: { name: string }) => void) | null,
  alarmsCreated: [] as unknown[],
  session: {} as Record<string, unknown>,
  sessionUnreadable: false,
  installType: "development",
  reloads: 0,
}));

vi.mock("../src/shared/extension-api.js", () => ({
  getExtensionApi: () => ({
    runtime: {
      getURL: (p: string) => `chrome-extension://x/${p}`,
      reload: () => h.reloads++,
    },
    storage: {
      session: {
        // Only the requested keys come back; a failed read calls back without items.
        get: (keys: string[], cb: (items?: Record<string, unknown>) => void) => {
          if (h.sessionUnreadable) return cb(undefined);
          cb(Object.fromEntries(keys.filter((k) => k in h.session).map((k) => [k, h.session[k]])));
        },
        set: (obj: Record<string, unknown>, cb?: () => void) => {
          Object.assign(h.session, obj);
          cb?.();
        },
      },
    },
    alarms: {
      onAlarm: {
        addListener: (fn: (a: { name: string }) => void) => (h.alarmListener = fn),
      },
      create: (...args: unknown[]) => h.alarmsCreated.push(args),
    },
    management: {
      getSelf: () => Promise.resolve({ installType: h.installType }),
    },
  }),
}));

let stamp = "build-1";
// Serves the packaged stamp. A request that doesn't bypass the HTTP cache gets the
// copy the browser cached from the first build.
function fetchStamp(url: string, init?: RequestInit) {
  if (url !== "chrome-extension://x/build-stamp.txt") {
    return Promise.reject(new TypeError("Failed to fetch"));
  }
  const body = init?.cache === "no-store" ? stamp : "build-1";
  return Promise.resolve({ text: () => Promise.resolve(body) });
}
vi.stubGlobal("fetch", fetchStamp as unknown as typeof fetch);

import { initDevReload } from "../src/background/dev-reload.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("dev hot-reload", () => {
  beforeEach(() => {
    h.alarmsCreated = [];
    h.session = {};
    h.sessionUnreadable = false;
    h.reloads = 0;
    stamp = "build-1";
  });

  it("registers the alarm listener synchronously at import", () => {
    expect(h.alarmListener).toBeTypeOf("function");
  });

  it("does nothing for a store install", async () => {
    h.installType = "normal";
    await initDevReload();
    expect(h.alarmsCreated).toHaveLength(0);
  });

  it("seeds the loaded stamp, then reloads only when a new build lands", async () => {
    h.installType = "development";
    await initDevReload();
    expect(h.alarmsCreated).toEqual([["vtp-dev-reload", { periodInMinutes: 0.5 }]]);
    await flush();
    expect(h.session.vtpDevBuildStamp).toBe("build-1");
    expect(h.reloads).toBe(0);

    h.alarmListener!({ name: "vtp-dev-reload" });
    await flush();
    expect(h.reloads).toBe(0); // same stamp — no reload

    stamp = "build-2";
    h.alarmListener!({ name: "vtp-dev-reload" });
    await flush();
    expect(h.reloads).toBe(1);
  });

  it("ignores foreign alarms", async () => {
    h.installType = "development";
    await initDevReload();
    await flush();
    stamp = "build-9";
    h.alarmListener!({ name: "some-other-alarm" });
    await flush();
    expect(h.reloads).toBe(0);
  });

  it("seeds the stamp when the session read comes back without items", async () => {
    h.installType = "development";
    h.sessionUnreadable = true;
    await initDevReload();
    await flush();

    expect(h.session.vtpDevBuildStamp).toBe("build-1");
    expect(h.reloads).toBe(0);
  });
});
