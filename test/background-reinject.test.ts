import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

type InstalledListener = (details: { reason: string }) => void;

// A browser match pattern such as "https://*/*": `*` spans any run of characters.
function matchesPattern(pattern: string, url: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(url);
}

// `reason` fires runtime.onInstalled with it; null fires runtime.onStartup (a browser start).
async function loadBackgroundWithTabs(
  tabs: Array<{ id?: number; url?: string; pendingUrl?: string }>,
  reason: string | null = "install",
) {
  vi.resetModules();
  const installed: InstalledListener[] = [];
  const started: Array<() => void> = [];
  const executed: Array<{
    tabId?: number;
    files: string[];
    world?: string;
    allFrames?: boolean;
  }> = [];
  vi.doMock("../src/shared/store.js", () => ({
    STORE: {
      get(_keys: string[], cb: (items: Record<string, unknown>) => void) {
        cb({ globalSpeed: 1, syncTargetGlobal: 5 });
      },
      set(_obj: Record<string, unknown>, cb?: (ok?: boolean) => void) {
        cb?.(true);
      },
    },
    whenReady(cb: () => void) {
      cb();
    },
  }));
  vi.doMock("../src/shared/update.js", () => ({
    UPDATE_AVAILABLE_KEY: "updateAvailable",
    UPDATE_LATEST_KEY: "updateLatest",
    UPDATE_ALARM: "updateCheck",
    UPDATE_PERIOD_MIN: 360,
    hasUpdateApi: () => true,
    cmpVersion: () => 0,
    currentVersion: () => "0.0.0",
    fetchAmoLatest: () => Promise.resolve(null),
  }));
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      onInstalled: { addListener: (fn: InstalledListener) => installed.push(fn) },
      onStartup: { addListener: (fn: () => void) => started.push(fn) },
      onUpdateAvailable: { addListener() {} },
      requestUpdateCheck() {},
    },
    action: {
      setBadgeText() {},
      setBadgeBackgroundColor() {},
      setBadgeTextColor() {},
      setIcon() {},
    },
    alarms: {
      onAlarm: { addListener() {} },
      create() {},
    },
    storage: {
      sync: {},
      local: {
        get(_keys: string[], cb: (items: Record<string, unknown>) => void) {
          cb({});
        },
        set() {},
      },
    },
    tabs: {
      onUpdated: { addListener() {} },
      // Like Chrome, return only the tabs whose committed or pending URL matches one of
      // the patterns.
      query(query: { url?: string[] }, cb: (items: typeof tabs) => void) {
        const { url: patterns } = query;
        if (!patterns) return cb(tabs);
        cb(
          tabs.filter((tab) =>
            [tab.url, tab.pendingUrl].some(
              (url) => !!url && patterns.some((pattern) => matchesPattern(pattern, url)),
            ),
          ),
        );
      },
    },
    scripting: {
      executeScript(args: {
        target: { tabId: number; allFrames?: boolean };
        files: string[];
        world?: string;
      }) {
        const { target, files, world } = args;
        executed.push({ tabId: target.tabId, files, world, allFrames: target.allFrames });
      },
    },
  };

  await import("../src/background/index.js");
  if (reason == null) started.forEach((fn) => fn());
  else installed.forEach((fn) => fn({ reason }));
  return executed;
}

afterEach(() => {
  vi.doUnmock("../src/shared/store.js");
  vi.doUnmock("../src/shared/update.js");
});

describe("background reinjection", () => {
  it("reinjects the latency bridge only on the same hosts as the manifest", async () => {
    const manifest = JSON.parse(readFileSync("src/manifest.json", "utf8")) as {
      content_scripts: Array<{ matches: string[]; js: string[] }>;
    };
    const hosts = manifest.content_scripts
      .find((entry) => entry.js.includes("inject.js"))!
      .matches.map((pattern) => /^\*:\/\/\*\.([^/]+)\/\*$/.exec(pattern)![1]);
    expect(hosts.length).toBeGreaterThan(0);
    // A `*.host` match pattern covers the bare host and any subdomain, nothing else.
    const matching = hosts.flatMap((host, i) => [
      { id: 100 + 3 * i, url: `https://${host}/watch` },
      { id: 101 + 3 * i, url: `https://www.${host}/watch` },
    ]);
    const others = [
      { id: 1, url: "https://example.com/watch" },
      ...hosts.map((host, i) => ({ id: 102 + 3 * i, url: `https://${host}.example.com/watch` })),
    ];
    const executed = await loadBackgroundWithTabs([...others, ...matching]);

    const latencyTabs = executed
      .filter((x) => x.files.includes("inject.js"))
      .map((x) => x.tabId)
      .sort((a, b) => a - b);

    expect(latencyTabs).toEqual(matching.map((t) => t.id).sort((a, b) => a - b));
    expect(
      executed
        .filter((x) => x.tabId === 1)
        .map((x) => x.files[0])
        .sort(),
    ).toEqual(["content.js", "page-bridge.js"]);
  });

  it("reinjects into open tabs after an install or an update", async () => {
    const tabs = [{ id: 1, url: "https://example.com/" }];
    for (const reason of ["install", "update"]) {
      const files = (await loadBackgroundWithTabs(tabs, reason)).map((x) => x.files[0]);
      expect(files.sort(), reason).toEqual(["content.js", "page-bridge.js"]);
    }
  });

  it("leaves open tabs alone on a browser start or a browser update", async () => {
    const tabs = [{ id: 1, url: "https://www.youtube.com/watch?v=x" }];
    expect(await loadBackgroundWithTabs(tabs, null)).toEqual([]);
    expect(await loadBackgroundWithTabs(tabs, "chrome_update")).toEqual([]);
  });

  it("reinjects into every frame, running the bridges in the page's main world", async () => {
    const executed = await loadBackgroundWithTabs([
      { id: 1, url: "https://www.youtube.com/watch?v=x" },
    ]);

    expect(executed).toEqual([
      { tabId: 1, files: ["content.js"], world: undefined, allFrames: true },
      { tabId: 1, files: ["inject.js"], world: "MAIN", allFrames: true },
      { tabId: 1, files: ["page-bridge.js"], world: "MAIN", allFrames: true },
    ]);
  });

  it("reinjects only into the web pages it can address", async () => {
    const executed = await loadBackgroundWithTabs([
      { id: 1, url: "http://example.com/" },
      { id: 2, url: "https://example.com/" },
      { id: 3, url: "chrome://extensions/" },
      { id: 4, url: "file:///home/user/video.html" },
      { url: "https://example.com/without-id" },
    ]);

    expect([...new Set(executed.map((x) => x.tabId))]).toEqual([1, 2]);
  });

  it("keeps reinjecting past a tab whose current URL the browser withholds", async () => {
    // Chrome also matches a tab by the page it is loading, yet withholds the URL of the
    // page it still shows when that's out of reach, like the new-tab page.
    const executed = await loadBackgroundWithTabs([
      { id: 1, pendingUrl: "https://www.youtube.com/watch?v=x" },
      { id: 2, url: "https://www.youtube.com/watch?v=y" },
    ]);

    expect(executed.map((x) => `${x.tabId}:${x.files[0]}`)).toEqual([
      "1:content.js",
      "1:page-bridge.js",
      "2:content.js",
      "2:inject.js",
      "2:page-bridge.js",
    ]);
  });
});
