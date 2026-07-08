// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function defineBox(el: HTMLElement, width: number, height: number): void {
  Object.defineProperty(el, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: height });
}

function makeYoutubePlayer(width: number, height: number, live: boolean): HTMLElement {
  const player = document.createElement("div") as HTMLElement & {
    getVideoData?: () => { isLive: boolean };
    getPlayerState?: () => number;
  };
  player.className = "html5-video-player";
  defineBox(player, width, height);
  player.getVideoData = () => ({ isLive: live });
  player.getPlayerState = () => 1;
  document.body.appendChild(player);
  return player;
}

async function loadInject(): Promise<void> {
  (
    window as typeof window & { __vtpLatencyBridgeCleanup?: () => void }
  ).__vtpLatencyBridgeCleanup?.();
  vi.resetModules();
  delete (window as typeof window & { __vtpLatencyBridgeInstalled?: boolean | string })
    .__vtpLatencyBridgeInstalled;
  delete (window as typeof window & { __vtpLatencyBridgeCleanup?: () => void })
    .__vtpLatencyBridgeCleanup;
  await import("../src/content/inject.js");
}

async function reloadInjectKeepingBridgeState(): Promise<void> {
  vi.resetModules();
  await import("../src/content/inject.js");
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-vtp-live");
  document.documentElement.removeAttribute("data-vtp-latency");
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("MAIN-world live probe", () => {
  it("does not publish a live flag from a hidden stale YouTube player", async () => {
    makeYoutubePlayer(0, 0, true);

    await loadInject();

    expect(document.documentElement.getAttribute("data-vtp-live")).toBeNull();
  });

  it("publishes a live flag from the visible YouTube player", async () => {
    makeYoutubePlayer(640, 360, true);

    await loadInject();

    expect(document.documentElement.getAttribute("data-vtp-live")).toBe("1");
  });

  it("stops publishing after a newer bridge version takes ownership", async () => {
    makeYoutubePlayer(640, 360, true);

    await loadInject();
    expect(document.documentElement.getAttribute("data-vtp-live")).toBe("1");

    (
      window as typeof window & { __vtpLatencyBridgeInstalled?: string }
    ).__vtpLatencyBridgeInstalled = "newer-bridge";
    document.documentElement.removeAttribute("data-vtp-live");
    await vi.advanceTimersByTimeAsync(1000);

    expect(document.documentElement.getAttribute("data-vtp-live")).toBeNull();
  });

  it("cleans up a previous bridge before taking ownership", async () => {
    const cleanup = vi.fn();
    (
      window as typeof window & {
        __vtpLatencyBridgeInstalled?: string;
        __vtpLatencyBridgeCleanup?: () => void;
      }
    ).__vtpLatencyBridgeInstalled = "older-bridge";
    (
      window as typeof window & {
        __vtpLatencyBridgeCleanup?: () => void;
      }
    ).__vtpLatencyBridgeCleanup = cleanup;
    makeYoutubePlayer(640, 360, true);

    await reloadInjectKeepingBridgeState();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(document.documentElement.getAttribute("data-vtp-live")).toBe("1");
  });

  it("stops publishing after cleanup", async () => {
    makeYoutubePlayer(640, 360, true);

    await loadInject();
    expect(document.documentElement.getAttribute("data-vtp-live")).toBe("1");

    (
      window as typeof window & { __vtpLatencyBridgeCleanup?: () => void }
    ).__vtpLatencyBridgeCleanup?.();
    document.documentElement.removeAttribute("data-vtp-live");
    await vi.advanceTimersByTimeAsync(1000);

    expect(document.documentElement.getAttribute("data-vtp-live")).toBeNull();
  });

  it("does not clear a newer bridge owner from an old cleanup callback", async () => {
    await loadInject();
    const cleanup = (window as typeof window & { __vtpLatencyBridgeCleanup?: () => void })
      .__vtpLatencyBridgeCleanup!;

    (
      window as typeof window & { __vtpLatencyBridgeInstalled?: unknown }
    ).__vtpLatencyBridgeInstalled = "newer-bridge";
    cleanup();

    expect(
      (window as typeof window & { __vtpLatencyBridgeInstalled?: unknown })
        .__vtpLatencyBridgeInstalled,
    ).toBe("newer-bridge");
  });

  it("skips detached HLS candidates and clears latency when the cached one detaches", async () => {
    const staleVideo = document.createElement("video") as HTMLVideoElement & { hls?: unknown };
    const liveVideo = document.createElement("video") as HTMLVideoElement & { hls?: unknown };
    staleVideo.hls = { latency: 99, attachMedia() {} };
    liveVideo.hls = { latency: 4, media: liveVideo };
    document.body.append(staleVideo, liveVideo);

    await loadInject();

    expect(document.documentElement.getAttribute("data-vtp-latency")).toBe("4.0");

    liveVideo.remove();
    await vi.advanceTimersByTimeAsync(1000);

    expect(document.documentElement.getAttribute("data-vtp-latency")).toBeNull();
  });

  it("does not rewrite unchanged live probe attributes on every tick", async () => {
    const liveVideo = document.createElement("video") as HTMLVideoElement & { hls?: unknown };
    liveVideo.hls = { latency: 4.04, media: liveVideo };
    document.body.append(liveVideo);
    const setAttribute = vi.spyOn(document.documentElement, "setAttribute");

    await loadInject();
    setAttribute.mockClear();
    await vi.advanceTimersByTimeAsync(1000);

    expect(document.documentElement.getAttribute("data-vtp-latency")).toBe("4.0");
    expect(setAttribute).not.toHaveBeenCalledWith("data-vtp-latency", expect.any(String));
  });

  it("uses the quality bridge HLS registry while full HLS scans are backed off", async () => {
    const liveVideo = document.createElement("video") as HTMLVideoElement & { hls?: unknown };
    liveVideo.hls = { latency: 4, media: liveVideo };
    document.body.append(liveVideo);

    await loadInject();
    expect(document.documentElement.getAttribute("data-vtp-latency")).toBe("4.0");

    liveVideo.remove();
    await vi.advanceTimersByTimeAsync(1000);
    expect(document.documentElement.getAttribute("data-vtp-latency")).toBeNull();

    const nextVideo = document.createElement("video");
    const nextHls = { latency: 7, media: nextVideo };
    (
      window as typeof window & {
        __vtpQualityHls?: Array<{ hls: unknown; video?: HTMLVideoElement | null }>;
      }
    ).__vtpQualityHls = [{ hls: nextHls, video: nextVideo }];
    document.body.append(nextVideo);
    await vi.advanceTimersByTimeAsync(1000);

    expect(document.documentElement.getAttribute("data-vtp-latency")).toBe("7.0");
  });
});
