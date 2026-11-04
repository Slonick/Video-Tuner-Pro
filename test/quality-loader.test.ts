// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUALITY_BRIDGE_LOAD_EVENT, QUALITY_BRIDGE_READY_EVENT } from "../src/shared/dom-events.js";

const QUALITY_BRIDGE_VERSION = "2026-11-04-fresh-adapters";

let bridgeRequests = 0;
function countBridgeRequest(): void {
  bridgeRequests++;
}

async function loadLoader(): Promise<void> {
  vi.resetModules();
  await import("../src/content/quality-loader.js");
}

async function flushUntil(done: () => boolean, maxTurns = 20): Promise<void> {
  for (let i = 0; i < maxTurns && !done(); i++) await Promise.resolve();
}

function requestQuality(requestId: string): void {
  document.dispatchEvent(
    new CustomEvent("vtp-quality-request", { detail: { requestId, videoId: "v1" } }),
  );
}

// Stands in for the background injecting the bridge and the content script's ready signal.
function injectBridge(): void {
  (
    window as typeof window & { __vtpQualityBridgeInstalled?: unknown }
  ).__vtpQualityBridgeInstalled = QUALITY_BRIDGE_VERSION;
  document.dispatchEvent(new Event(QUALITY_BRIDGE_READY_EVENT));
}

beforeEach(() => {
  vi.resetModules();
  (
    window as typeof window & { __vtpQualityLoaderCleanup?: () => void }
  ).__vtpQualityLoaderCleanup?.();
  (
    window as typeof window & { __vtpQualityBridgeCleanup?: () => void }
  ).__vtpQualityBridgeCleanup?.();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-vtp-quality-request");
  document.documentElement.removeAttribute("data-vtp-quality-pick");
  delete (window as typeof window & { __vtpQualityBridgeInstalled?: unknown })
    .__vtpQualityBridgeInstalled;
  delete (window as typeof window & { __vtpQualityBridgeCleanup?: () => void })
    .__vtpQualityBridgeCleanup;
  delete (window as typeof window & { __vtpQualityLoaderInstalled?: unknown })
    .__vtpQualityLoaderInstalled;
  delete (window as typeof window & { __vtpQualityLoaderCleanup?: () => void })
    .__vtpQualityLoaderCleanup;
  delete (window as typeof window & { __vtpQualityPlayers?: unknown }).__vtpQualityPlayers;
  delete (window as typeof window & { IVSPlayer?: unknown }).IVSPlayer;
  bridgeRequests = 0;
  document.addEventListener(QUALITY_BRIDGE_LOAD_EVENT, countBridgeRequest);
});

afterEach(() => {
  document.removeEventListener(QUALITY_BRIDGE_LOAD_EVENT, countBridgeRequest);
  vi.useRealTimers();
});

describe("quality loader", () => {
  it("does not ask for the heavy bridge until quality is requested", async () => {
    await loadLoader();

    expect(bridgeRequests).toBe(0);
  });

  it("captures HLS media before the heavy bridge is loaded", async () => {
    await loadLoader();
    class FakeHls {
      media: HTMLMediaElement | null = null;

      attachMedia(media: HTMLMediaElement) {
        this.media = media;
      }
    }
    (window as typeof window & { Hls?: unknown }).Hls = FakeHls;
    const video = document.createElement("video");
    document.body.append(video);

    const hls = new FakeHls();
    hls.attachMedia(video);

    expect(bridgeRequests).toBe(0);
    expect(
      (window as typeof window & { __vtpQualityHls?: Array<{ hls: unknown; video: unknown }> })
        .__vtpQualityHls,
    ).toEqual([{ hls, video }]);
  });

  it("captures IVS players before the heavy bridge is loaded", async () => {
    await loadLoader();
    const video = document.createElement("video");
    const player = {
      attachHTMLVideoElement(target: HTMLVideoElement) {
        return target;
      },
    };
    (window as typeof window & { IVSPlayer?: unknown }).IVSPlayer = {
      create: () => player,
    };

    const created = (
      window as typeof window & { IVSPlayer?: { create: () => typeof player } }
    ).IVSPlayer!.create();
    created.attachHTMLVideoElement(video);

    expect(bridgeRequests).toBe(0);
    expect(
      (
        window as typeof window & {
          __vtpQualityPlayers?: Array<{ player: unknown; video: unknown }>;
        }
      ).__vtpQualityPlayers,
    ).toEqual([{ player, video }]);
  });

  it("keeps IVSPlayer readable through an accessor left by an older loader", async () => {
    const lib = { create: () => ({}) };
    Object.defineProperty(window, "IVSPlayer", { configurable: true, get: () => lib, set() {} });

    await loadLoader();

    expect((window as typeof window & { IVSPlayer?: unknown }).IVSPlayer).toBe(lib);
  });

  it("keeps a page-assigned IVSPlayer when the bridge installs its own hook", async () => {
    await loadLoader();
    const player = {};
    const lib = { create: () => player };
    (window as typeof window & { IVSPlayer?: unknown }).IVSPlayer = lib;

    // Evaluated only now: the bridge must install after the page used the loader's hook.
    await import("../src/content/quality-inject.js");

    const ivs = (window as typeof window & { IVSPlayer?: typeof lib }).IVSPlayer;
    expect(ivs).toBe(lib);
    expect(ivs?.create()).toBe(player);
  });

  it("asks for the bridge once and replays the original request after injection", async () => {
    await loadLoader();
    const replayed: unknown[] = [];
    document.addEventListener("vtp-quality-request", (e) => {
      replayed.push((e as CustomEvent).detail);
    });

    requestQuality("q1");
    expect(replayed).toEqual([]);
    expect(bridgeRequests).toBe(1);
    expect(document.querySelectorAll("script")).toHaveLength(0);

    injectBridge();
    await flushUntil(() => replayed.length > 0);

    expect(replayed).toEqual([{ requestId: "q1", videoId: "v1" }]);

    requestQuality("q2");
    expect(bridgeRequests).toBe(1);
    expect(replayed).toEqual([
      { requestId: "q1", videoId: "v1" },
      { requestId: "q2", videoId: "v1" },
    ]);
  });

  it("keeps waiting when a ready signal arrives before the bridge is installed", async () => {
    await loadLoader();
    const replayed: unknown[] = [];
    document.addEventListener("vtp-quality-request", (e) => {
      replayed.push((e as CustomEvent).detail);
    });

    requestQuality("q1");
    document.dispatchEvent(new Event(QUALITY_BRIDGE_READY_EVENT));
    await flushUntil(() => replayed.length > 0);
    expect(replayed).toEqual([]);

    injectBridge();
    await flushUntil(() => replayed.length > 0);
    expect(replayed).toEqual([{ requestId: "q1", videoId: "v1" }]);
  });

  it("drops requests behind an unanswered bridge load and asks again afterwards", async () => {
    vi.useFakeTimers();
    await loadLoader();
    const replayed: unknown[] = [];
    document.addEventListener("vtp-quality-request", (e) => {
      replayed.push((e as CustomEvent).detail);
    });

    requestQuality("q1");
    requestQuality("q2");
    expect(bridgeRequests).toBe(1);

    await vi.advanceTimersByTimeAsync(4000);
    requestQuality("q3");
    expect(bridgeRequests).toBe(2);

    injectBridge();
    await flushUntil(() => replayed.length > 0);
    expect(replayed).toEqual([{ requestId: "q3", videoId: "v1" }]);
  });

  it("cleans up an older loader before taking ownership", async () => {
    const cleanup = vi.fn();
    (
      window as typeof window & {
        __vtpQualityLoaderInstalled?: string;
        __vtpQualityLoaderCleanup?: () => void;
      }
    ).__vtpQualityLoaderInstalled = "older-loader";
    (
      window as typeof window & { __vtpQualityLoaderCleanup?: () => void }
    ).__vtpQualityLoaderCleanup = cleanup;

    await loadLoader();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("asks for the current bridge when an older bridge owns the page", async () => {
    (
      window as typeof window & { __vtpQualityBridgeInstalled?: unknown }
    ).__vtpQualityBridgeInstalled = "older-bridge";
    await loadLoader();

    requestQuality("q1");

    expect(bridgeRequests).toBe(1);
  });
});
