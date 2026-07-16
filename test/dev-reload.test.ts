import { describe, it, expect, vi, beforeEach } from "vitest";

// Dev hot-reload for unpacked installs: the module registers its alarm listener
// synchronously at import (MV3 requirement), initDevReload() gates on
// installType, and a stamp change triggers runtime.reload().
const h = vi.hoisted(() => ({
  alarmListener: null as ((a: { name: string }) => void) | null,
  alarmsCreated: [] as unknown[],
  session: {} as Record<string, unknown>,
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
        get: (_keys: string[], cb: (items: Record<string, unknown>) => void) =>
          cb({ ...h.session }),
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
vi.stubGlobal("fetch", (() =>
  Promise.resolve({ text: () => Promise.resolve(stamp) })) as unknown as typeof fetch);

import { initDevReload } from "../src/background/dev-reload.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("dev hot-reload", () => {
  beforeEach(() => {
    h.alarmsCreated = [];
    h.session = {};
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
    expect(h.alarmsCreated).toHaveLength(1);
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
});
