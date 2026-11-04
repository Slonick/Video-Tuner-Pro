import { afterEach, describe, expect, it, vi } from "vitest";
import type * as MapMutation from "../src/shared/map-mutation.js";

type Response = { success?: boolean } | undefined;
type SendMessage = (message: unknown, callback: (response?: Response) => void) => unknown;

async function loadWith(sendMessage: SendMessage) {
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { lastError: null, sendMessage },
  };
  vi.resetModules();
  return import("../src/shared/map-mutation.js");
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("atomic stored-map mutation messaging", () => {
  it("sends a merge/removal request and reports callback success", async () => {
    const sent: unknown[] = [];
    const { mutateStoredMap } = await loadWith((message, callback) => {
      sent.push(message);
      callback({ success: true });
    });
    const done = vi.fn();

    mutateStoredMap("viewerAutoSites", { example: "normal" }, ["legacy"], done);

    expect(sent).toEqual([
      {
        action: "mutateStoredMap",
        map: "viewerAutoSites",
        set: { example: "normal" },
        remove: ["legacy"],
      },
    ]);
    expect(done).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledWith(true);
  });

  it("settles once when an API supplies both callback and Promise responses", async () => {
    const { mutateStoredMap } = await loadWith((_message, callback) => {
      callback({ success: true });
      return Promise.resolve({ success: false });
    });
    const done = vi.fn();

    mutateStoredMap("domains", { example: 2 }, [], done);
    await Promise.resolve();

    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(true);
  });

  it("reports Promise rejection and synchronous extension failures", async () => {
    const rejected = await loadWith(() => Promise.reject(new Error("port closed")));
    const rejectedDone = vi.fn();
    rejected.mutateStoredMap("channels", {}, ["old"], rejectedDone);
    await Promise.resolve();
    await Promise.resolve();
    expect(rejectedDone).toHaveBeenCalledWith(false);

    const thrown = await loadWith(() => {
      throw new Error("context invalidated");
    });
    const thrownDone = vi.fn();
    thrown.mutateStoredMap("channels", {}, [], thrownDone);
    expect(thrownDone).toHaveBeenCalledWith(false);
  });

  it("clears a whole map through the same atomic background action", async () => {
    const sent: unknown[] = [];
    const { clearStoredMap } = await loadWith((message, callback) => {
      sent.push(message);
      callback({ success: true });
    });
    const done = vi.fn();

    clearStoredMap("overlayPanelPos", done);

    expect(sent).toEqual([{ action: "mutateStoredMap", map: "overlayPanelPos", clear: true }]);
    expect(done).toHaveBeenCalledWith(true);
  });
});

type Sender = (api: typeof MapMutation, done?: (ok?: boolean) => void) => void;

// Both entry points share one reply contract: whichever of the sendMessage callback
// and its returned Promise answers first settles `done`, exactly once.
const senders: Array<{ name: string; send: Sender }> = [
  {
    name: "mutateStoredMap",
    send: (api, done) => api.mutateStoredMap("domains", { example: 2 }, [], done),
  },
  { name: "clearStoredMap", send: (api, done) => api.clearStoredMap("domains", done) },
];

const failedReplies: Array<[string, SendMessage]> = [
  ["an unsuccessful reply", (_message, callback) => callback({ success: false })],
  ["an empty reply", (_message, callback) => callback()],
  ["a rejected Promise", () => Promise.reject(new Error("port closed"))],
  [
    "a throwing sendMessage",
    () => {
      throw new Error("context invalidated");
    },
  ],
];

describe.each(senders)("$name reply handling", ({ send }) => {
  it.each([undefined, true])(
    "waits for the callback reply when sendMessage returns %s",
    async (returned) => {
      let reply: ((response?: Response) => void) | undefined;
      const api = await loadWith((_message, callback) => {
        reply = callback;
        return returned;
      });
      const done = vi.fn();

      send(api, done);
      expect(done).not.toHaveBeenCalled();
      reply?.({ success: true });

      expect(done).toHaveBeenCalledOnce();
      expect(done).toHaveBeenCalledWith(true);
    },
  );

  it("settles from a Promise reply when the callback never fires", async () => {
    const api = await loadWith(() => Promise.resolve({ success: true }));
    const done = vi.fn();

    send(api, done);
    await Promise.resolve();
    await Promise.resolve();

    expect(done).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledWith(true);
  });

  it("settles once when both the callback and the Promise reply", async () => {
    const api = await loadWith((_message, callback) => {
      callback({ success: true });
      return Promise.resolve({ success: false });
    });
    const done = vi.fn();

    send(api, done);
    await Promise.resolve();
    await Promise.resolve();

    expect(done).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledWith(true);
  });

  it.each(failedReplies)("reports %s as failure", async (_label, sendMessage) => {
    const api = await loadWith(sendMessage);
    const done = vi.fn();

    send(api, done);
    await Promise.resolve();
    await Promise.resolve();

    expect(done).toHaveBeenCalledOnce();
    expect(done).toHaveBeenCalledWith(false);
  });

  it("lets a fire-and-forget caller omit done when the reply arrives later", async () => {
    let reply: ((response?: Response) => void) | undefined;
    const api = await loadWith((_message, callback) => {
      reply = callback;
    });

    send(api);

    expect(reply).toBeTypeOf("function");
    expect(() => reply?.({ success: true })).not.toThrow();
  });
});

describe("stored-map entry validation", () => {
  it("checks per-site viewer chat entries by shape (the registry clamps their numbers)", async () => {
    const { validStoredMapValue } = await loadWith(() => undefined);

    const spot = { opacity: 0.5, width: 300, height: 400, h: "left", v: "bottom", dx: -20, dy: 96 };
    expect(validStoredMapValue("viewerChatPanelSites", spot)).toBe(true);
    expect(validStoredMapValue("viewerChatPanelSites", { opacity: 0.5 })).toBe(true);
    expect(validStoredMapValue("viewerChatPanelSites", {})).toBe(false);
    expect(validStoredMapValue("viewerChatPanelSites", { h: "middle" })).toBe(false);
    expect(validStoredMapValue("viewerChatPanelSites", { width: "wide" })).toBe(false);
    expect(validStoredMapValue("viewerChatPanelSites", { fx: 0.5, fy: 0.5 })).toBe(false);

    expect(validStoredMapValue("viewerChatSideWidths", { normal: 260, theater: 420 })).toBe(true);
    expect(validStoredMapValue("viewerChatSideWidths", { theater: 420 })).toBe(true);
    expect(validStoredMapValue("viewerChatSideWidths", {})).toBe(false);
    expect(validStoredMapValue("viewerChatSideWidths", { theater: Infinity })).toBe(false);
    expect(validStoredMapValue("viewerChatSideWidths", 340)).toBe(false);
  });

  it("accepts any single chat field and rejects a malformed one beside good ones", async () => {
    const { validStoredMapValue } = await loadWith(() => undefined);

    expect(validStoredMapValue("viewerChatPanelSites", { width: 300 })).toBe(true);
    expect(validStoredMapValue("viewerChatPanelSites", { height: 400 })).toBe(true);
    expect(validStoredMapValue("viewerChatPanelSites", { dx: -20 })).toBe(true);
    expect(validStoredMapValue("viewerChatPanelSites", { dy: 96 })).toBe(true);
    expect(validStoredMapValue("viewerChatPanelSites", { h: "right" })).toBe(true);
    expect(validStoredMapValue("viewerChatPanelSites", { v: "top" })).toBe(true);
    expect(validStoredMapValue("viewerChatPanelSites", { opacity: 0.5, dx: "20" })).toBe(false);
    expect(validStoredMapValue("viewerChatPanelSites", { v: "middle" })).toBe(false);
    expect(validStoredMapValue("viewerChatPanelSites", null)).toBe(false);

    expect(validStoredMapValue("viewerChatSideWidths", { normal: 260, theater: NaN })).toBe(false);
    expect(validStoredMapValue("viewerChatSideWidths", null)).toBe(false);
  });

  it("bounds saved speeds to 0.1–16 on both the site and channel maps", async () => {
    const { validStoredMapValue } = await loadWith(() => undefined);

    expect(validStoredMapValue("domains", 0.1)).toBe(true);
    expect(validStoredMapValue("domains", 16)).toBe(true);
    expect(validStoredMapValue("channels", 2)).toBe(true);
    expect(validStoredMapValue("domains", 0.09)).toBe(false);
    expect(validStoredMapValue("channels", 16.5)).toBe(false);
    expect(validStoredMapValue("domains", "2")).toBe(false);
  });

  it("bounds saved live-sync delays to 1–30 s on both the site and channel maps", async () => {
    const { validStoredMapValue } = await loadWith(() => undefined);

    expect(validStoredMapValue("syncTargets", 1)).toBe(true);
    expect(validStoredMapValue("syncTargets", 30)).toBe(true);
    expect(validStoredMapValue("syncTargetChannels", 5)).toBe(true);
    expect(validStoredMapValue("syncTargets", 0.5)).toBe(false);
    expect(validStoredMapValue("syncTargetChannels", 31)).toBe(false);
    expect(validStoredMapValue("syncTargets", "5")).toBe(false);
  });

  it("bounds auto-slow targets to 3–12 on both the site and channel maps", async () => {
    const { validStoredMapValue } = await loadWith(() => undefined);

    expect(validStoredMapValue("autoSlowSites", { target: 3 })).toBe(true);
    expect(validStoredMapValue("autoSlowSites", { target: 12 })).toBe(true);
    expect(validStoredMapValue("autoSlowChannels", { target: 6 })).toBe(true);
    expect(validStoredMapValue("autoSlowSites", { target: 2.9 })).toBe(false);
    expect(validStoredMapValue("autoSlowChannels", { target: 12.1 })).toBe(false);
    expect(validStoredMapValue("autoSlowSites", { target: "6" })).toBe(false);
  });

  it("accepts only the known viewer auto and fit modes", async () => {
    const { validStoredMapValue } = await loadWith(() => undefined);

    expect(validStoredMapValue("viewerAutoSites", "off")).toBe(true);
    expect(validStoredMapValue("viewerAutoSites", "normal")).toBe(true);
    expect(validStoredMapValue("viewerAutoChannels", "theater")).toBe(true);
    expect(validStoredMapValue("viewerAutoSites", "fullscreen")).toBe(false);

    expect(validStoredMapValue("viewerFitSites", "contain")).toBe(true);
    expect(validStoredMapValue("viewerFitSites", "cover")).toBe(true);
    expect(validStoredMapValue("viewerFitChannels", "fill")).toBe(true);
    expect(validStoredMapValue("viewerFitSites", "stretch")).toBe(false);
  });

  it("accepts only booleans for pinned badges", async () => {
    const { validStoredMapValue } = await loadWith(() => undefined);

    expect(validStoredMapValue("badgePinned", true)).toBe(true);
    expect(validStoredMapValue("badgePinned", "true")).toBe(false);
  });

  it("keeps saved positions inside the unit square, edges included", async () => {
    const { validPosition } = await loadWith(() => undefined);

    expect(validPosition({ fx: 0, fy: 0 })).toBe(true);
    expect(validPosition({ fx: 1, fy: 1 })).toBe(true);
    expect(validPosition({ fx: -0.01, fy: 0.5 })).toBe(false);
    expect(validPosition({ fx: 1.01, fy: 0.5 })).toBe(false);
    expect(validPosition({ fx: 0.5, fy: -0.01 })).toBe(false);
    expect(validPosition({ fx: 0.5, fy: 1.01 })).toBe(false);
    // Comparisons alone would coerce these into range.
    expect(validPosition({ fx: "0.5", fy: 0.5 })).toBe(false);
    expect(validPosition({ fx: 0.5, fy: null })).toBe(false);
    expect(validPosition(null)).toBe(false);
  });

  it("rejects empty keys and keys that would reach the object prototype", async () => {
    const { safeKey } = await loadWith(() => undefined);

    expect(safeKey("twitch.tv")).toBe(true);
    expect(safeKey("")).toBe(false);
    expect(safeKey("__proto__")).toBe(false);
    expect(safeKey("constructor")).toBe(false);
    expect(safeKey("prototype")).toBe(false);
  });
});
