// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const QUALITY_BRIDGE_VERSION = "2026-07-07-local-roots";
const BRIDGE_URL_ATTR = "data-vtp-quality-bridge-url";
const BRIDGE_URL = "chrome-extension://vtp/quality-inject.js";

function bridgeScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll("script")).filter((script) =>
    script.src.endsWith("/quality-inject.js"),
  );
}

async function loadLoader(): Promise<void> {
  vi.resetModules();
  await import("../src/content/quality-loader.js");
}

async function flushUntil(done: () => boolean, maxTurns = 20): Promise<void> {
  for (let i = 0; i < maxTurns && !done(); i++) await Promise.resolve();
}

beforeEach(() => {
  vi.resetModules();
  (
    window as typeof window & { __vtpQualityLoaderCleanup?: () => void }
  ).__vtpQualityLoaderCleanup?.();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.setAttribute(BRIDGE_URL_ATTR, BRIDGE_URL);
  document.documentElement.removeAttribute("data-vtp-quality-request");
  document.documentElement.removeAttribute("data-vtp-quality-pick");
  delete (window as typeof window & { __vtpQualityBridgeInstalled?: unknown })
    .__vtpQualityBridgeInstalled;
  delete (window as typeof window & { __vtpQualityLoaderInstalled?: unknown })
    .__vtpQualityLoaderInstalled;
  delete (window as typeof window & { __vtpQualityLoaderCleanup?: () => void })
    .__vtpQualityLoaderCleanup;
  vi.stubGlobal("chrome", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("quality loader", () => {
  it("does not load the heavy bridge until quality is requested", async () => {
    await loadLoader();

    expect(bridgeScripts()).toHaveLength(0);
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

    expect(bridgeScripts()).toHaveLength(0);
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

    expect(bridgeScripts()).toHaveLength(0);
    expect(
      (
        window as typeof window & {
          __vtpQualityPlayers?: Array<{ player: unknown; video: unknown }>;
        }
      ).__vtpQualityPlayers,
    ).toEqual([{ player, video }]);
  });

  it("loads the bridge once and replays the original request", async () => {
    await loadLoader();
    const replayed: unknown[] = [];
    document.addEventListener("vtp-quality-request", (e) => {
      replayed.push((e as CustomEvent).detail);
    });

    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "q1", videoId: "v1" },
      }),
    );
    expect(replayed).toEqual([]);

    const script = bridgeScripts()[0];
    expect(script).toBeTruthy();
    expect(script.src).toBe(BRIDGE_URL);
    (
      window as typeof window & { __vtpQualityBridgeInstalled?: unknown }
    ).__vtpQualityBridgeInstalled = QUALITY_BRIDGE_VERSION;
    script.onload?.(new Event("load"));
    await flushUntil(() => replayed.length > 0);

    expect(replayed).toEqual([{ requestId: "q1", videoId: "v1" }]);

    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "q2", videoId: "v1" },
      }),
    );
    expect(bridgeScripts()).toHaveLength(0);
    expect(replayed).toEqual([
      { requestId: "q1", videoId: "v1" },
      { requestId: "q2", videoId: "v1" },
    ]);
  });

  it("loads the bridge from the DOM attribute without extension runtime access", async () => {
    await loadLoader();

    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "q1", videoId: "v1" },
      }),
    );

    const [script] = bridgeScripts();
    expect(script.src).toBe(BRIDGE_URL);
  });

  it("reads the bridge URL attribute lazily when quality is requested", async () => {
    document.documentElement.removeAttribute(BRIDGE_URL_ATTR);
    await loadLoader();
    document.documentElement.setAttribute(BRIDGE_URL_ATTR, BRIDGE_URL);

    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "q1", videoId: "v1" },
      }),
    );

    const [script] = bridgeScripts();
    expect(script.src).toBe(BRIDGE_URL);
  });

  it("uses a Trusted Types script URL policy when the page requires it", async () => {
    const createScriptURL = vi.fn((url: string) => url);
    const createPolicy = vi.fn(() => ({ createScriptURL }));
    vi.stubGlobal("trustedTypes", { createPolicy });
    await loadLoader();

    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "q1", videoId: "v1" },
      }),
    );

    expect(createPolicy).toHaveBeenCalledWith("video-tuner-quality-loader", {
      createScriptURL: expect.any(Function),
    });
    expect(createScriptURL).toHaveBeenCalledWith(BRIDGE_URL);
    expect(bridgeScripts()).toHaveLength(1);
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

  it("loads the current bridge when an older bridge owns the page", async () => {
    (
      window as typeof window & { __vtpQualityBridgeInstalled?: unknown }
    ).__vtpQualityBridgeInstalled = "older-bridge";
    await loadLoader();

    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "q1", videoId: "v1" },
      }),
    );

    expect(bridgeScripts()).toHaveLength(1);
  });

  it("does not inject a page-relative bridge when the extension URL is unavailable", async () => {
    document.documentElement.removeAttribute(BRIDGE_URL_ATTR);
    vi.stubGlobal("chrome", {});
    await loadLoader();

    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "q1", videoId: "v1" },
      }),
    );
    await flushUntil(() => bridgeScripts().length === 0);

    expect(bridgeScripts()).toHaveLength(0);
    expect(
      Array.from(document.querySelectorAll("script")).map((script) => script.src),
    ).not.toContain(new URL("quality-inject.js", location.href).href);
  });

  it("rejects a page-controlled non-extension bridge URL", async () => {
    document.documentElement.setAttribute(BRIDGE_URL_ATTR, "https://example.com/quality-inject.js");
    await loadLoader();

    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "q1", videoId: "v1" },
      }),
    );
    await flushUntil(() => bridgeScripts().length === 0);

    expect(bridgeScripts()).toHaveLength(0);
    expect(document.querySelectorAll('script[src^="https://example.com/"]')).toHaveLength(0);
  });

  it("falls back to runtime.getURL when the DOM attribute is absent", async () => {
    document.documentElement.removeAttribute(BRIDGE_URL_ATTR);
    vi.stubGlobal("chrome", { runtime: { getURL: () => BRIDGE_URL } });
    await loadLoader();

    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "q1", videoId: "v1" },
      }),
    );
    await flushUntil(() => bridgeScripts().length > 0);

    const [script] = bridgeScripts();
    expect(script.src).toBe(BRIDGE_URL);
  });
});
