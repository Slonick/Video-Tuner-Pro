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

function setYoutubePlayerResponse(
  player: HTMLElement,
  details: { videoId: string; isLive?: boolean; isLiveContent?: boolean },
  isLiveNow?: boolean,
): void {
  (player as HTMLElement & { getPlayerResponse?: () => unknown }).getPlayerResponse = () => ({
    videoDetails: details,
    ...(typeof isLiveNow === "boolean"
      ? {
          microformat: {
            playerMicroformatRenderer: { liveBroadcastDetails: { isLiveNow } },
          },
        }
      : {}),
  });
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
  vi.stubGlobal("location", { hostname: "www.youtube.com" });
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-vtp-live");
  document.documentElement.removeAttribute("data-vtp-latency");
  delete (window as typeof window & { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
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

  it("uses the current YouTube player response when getVideoData reports false", async () => {
    const player = makeYoutubePlayer(640, 360, false);
    (player as HTMLElement & { getVideoData: () => unknown }).getVideoData = () => ({
      isLive: false,
      video_id: "jCV9cOM77iE",
    });
    setYoutubePlayerResponse(player, {
      videoId: "jCV9cOM77iE",
      isLive: true,
      isLiveContent: true,
    });

    await loadInject();

    expect(document.documentElement.getAttribute("data-vtp-live")).toBe("1");
  });

  it("uses liveBroadcastDetails for an active stream whose video flags are false", async () => {
    vi.stubGlobal("location", {
      hostname: "www.youtube.com",
      href: "https://www.youtube.com/watch?v=jCV9cOM77iE",
    });
    const player = makeYoutubePlayer(640, 360, false);
    (player as HTMLElement & { getVideoData: () => unknown }).getVideoData = () => ({
      isLive: false,
      video_id: "jCV9cOM77iE",
    });
    setYoutubePlayerResponse(
      player,
      { videoId: "jCV9cOM77iE", isLive: false, isLiveContent: false },
      true,
    );

    await loadInject();

    expect(document.documentElement.getAttribute("data-vtp-live")).toBe("1");
  });

  it("treats a finished live broadcast as a VOD", async () => {
    const player = makeYoutubePlayer(640, 360, false);
    (player as HTMLElement & { getVideoData: () => unknown }).getVideoData = () => ({
      isLive: false,
      video_id: "finished-stream",
    });
    setYoutubePlayerResponse(player, { videoId: "finished-stream", isLiveContent: true }, false);

    await loadInject();

    expect(document.documentElement.getAttribute("data-vtp-live")).toBe("0");
  });

  it("selects the visible player that matches the current YouTube URL", async () => {
    vi.stubGlobal("location", {
      hostname: "www.youtube.com",
      href: "https://www.youtube.com/watch?v=current-live",
    });
    const stale = makeYoutubePlayer(640, 360, false);
    (stale as HTMLElement & { getVideoData: () => unknown }).getVideoData = () => ({
      isLive: false,
      video_id: "stale-vod",
    });
    setYoutubePlayerResponse(stale, { videoId: "stale-vod", isLive: false });

    const current = makeYoutubePlayer(640, 360, false);
    (current as HTMLElement & { getVideoData: () => unknown }).getVideoData = () => ({
      isLive: false,
      video_id: "current-live",
    });
    setYoutubePlayerResponse(current, { videoId: "current-live", isLiveContent: true }, true);

    await loadInject();

    expect(document.documentElement.getAttribute("data-vtp-live")).toBe("1");
  });

  it("uses a matching YouTube initial response when the player response API is absent", async () => {
    const player = makeYoutubePlayer(640, 360, false);
    (player as HTMLElement & { getVideoData: () => unknown }).getVideoData = () => ({
      isLive: false,
      video_id: "jCV9cOM77iE",
    });
    (
      window as typeof window & {
        ytInitialPlayerResponse?: unknown;
      }
    ).ytInitialPlayerResponse = {
      videoDetails: {
        videoId: "jCV9cOM77iE",
        isLive: true,
        isLiveContent: true,
      },
    };

    await loadInject();

    expect(document.documentElement.getAttribute("data-vtp-live")).toBe("1");
  });

  it("ignores a stale YouTube response from a different video", async () => {
    const player = makeYoutubePlayer(640, 360, false);
    (player as HTMLElement & { getVideoData: () => unknown }).getVideoData = () => ({
      isLive: false,
      video_id: "current-video",
    });
    setYoutubePlayerResponse(player, {
      videoId: "stale-live-video",
      isLive: true,
      isLiveContent: true,
    });

    await loadInject();

    expect(document.documentElement.getAttribute("data-vtp-live")).toBe("0");
  });

  it("does not publish YouTube live state outside YouTube hosts", async () => {
    vi.stubGlobal("location", { hostname: "example.com" });
    makeYoutubePlayer(640, 360, true);

    await loadInject();

    expect(document.documentElement.getAttribute("data-vtp-live")).toBeNull();
  });

  it("does not scan generic HLS internals on a confirmed YouTube VOD", async () => {
    makeYoutubePlayer(640, 360, false);
    const video = document.createElement("video") as HTMLVideoElement & { hls?: unknown };
    const hlsReads = vi.fn(() => null);
    Object.defineProperty(video, "hls", { get: hlsReads, configurable: true, enumerable: true });
    document.body.append(video);

    await loadInject();

    expect(document.documentElement.getAttribute("data-vtp-live")).toBe("0");
    expect(document.documentElement.getAttribute("data-vtp-latency")).toBeNull();
    expect(hlsReads).not.toHaveBeenCalled();
  });

  it("does not scan generic HLS internals on YouTube while live state is unknown", async () => {
    const player = document.createElement("div");
    player.className = "html5-video-player";
    defineBox(player, 640, 360);
    document.body.append(player);
    const video = document.createElement("video") as HTMLVideoElement & { hls?: unknown };
    const hlsReads = vi.fn(() => null);
    Object.defineProperty(video, "hls", { get: hlsReads, configurable: true, enumerable: true });
    document.body.append(video);

    await loadInject();

    expect(document.documentElement.getAttribute("data-vtp-live")).toBeNull();
    expect(document.documentElement.getAttribute("data-vtp-latency")).toBeNull();
    expect(hlsReads).not.toHaveBeenCalled();
  });

  it("does not scan Twitch fiber players outside Twitch hosts", async () => {
    vi.stubGlobal("location", { hostname: "example.com" });
    const getLiveLatency = vi.fn(() => 2.5);
    const video = document.createElement("video") as HTMLVideoElement & {
      __reactFiber$vtp?: unknown;
    };
    video.__reactFiber$vtp = {
      memoizedProps: { mediaPlayerInstance: { getLiveLatency } },
    };
    document.body.append(video);

    await loadInject();

    expect(getLiveLatency).not.toHaveBeenCalled();
    expect(document.documentElement.getAttribute("data-vtp-latency")).toBeNull();
  });

  it("reads Twitch latency on Twitch hosts", async () => {
    vi.stubGlobal("location", { hostname: "www.twitch.tv" });
    const video = document.createElement("video") as HTMLVideoElement & {
      __reactFiber$vtp?: unknown;
    };
    video.__reactFiber$vtp = {
      memoizedProps: { mediaPlayerInstance: { getLiveLatency: () => 2.54 } },
    };
    document.body.append(video);

    await loadInject();

    expect(document.documentElement.getAttribute("data-vtp-latency")).toBe("2.5");
  });

  it("backs off repeated Twitch fiber scans when no player instance is found", async () => {
    vi.stubGlobal("location", { hostname: "www.twitch.tv" });
    const fiberReads = vi.fn(() => null);
    const video = document.createElement("video") as HTMLVideoElement & {
      __reactFiber$vtp?: unknown;
    };
    Object.defineProperty(video, "__reactFiber$vtp", {
      get: fiberReads,
      configurable: true,
      enumerable: true,
    });
    document.body.append(video);

    await loadInject();
    const firstScanReads = fiberReads.mock.calls.length;
    expect(firstScanReads).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(4000);
    expect(fiberReads).toHaveBeenCalledTimes(firstScanReads);

    await vi.advanceTimersByTimeAsync(1000);
    const secondScanReads = fiberReads.mock.calls.length;
    expect(secondScanReads).toBeGreaterThan(firstScanReads);

    await vi.advanceTimersByTimeAsync(9000);
    expect(fiberReads).toHaveBeenCalledTimes(secondScanReads);
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
    vi.stubGlobal("location", { hostname: "kick.com" });
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
    vi.stubGlobal("location", { hostname: "kick.com" });
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
    vi.stubGlobal("location", { hostname: "kick.com" });
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

  it("backs off repeated full HLS scans when no active instance is found", async () => {
    vi.stubGlobal("location", { hostname: "kick.com" });
    const video = document.createElement("video") as HTMLVideoElement & { hls?: unknown };
    const hlsReads = vi.fn(() => null);
    Object.defineProperty(video, "hls", { get: hlsReads, configurable: true, enumerable: true });
    document.body.append(video);

    await loadInject();
    const firstScanReads = hlsReads.mock.calls.length;
    expect(firstScanReads).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(4000);
    expect(hlsReads).toHaveBeenCalledTimes(firstScanReads);

    await vi.advanceTimersByTimeAsync(1000);
    const secondScanReads = hlsReads.mock.calls.length;
    expect(secondScanReads).toBeGreaterThan(firstScanReads);

    await vi.advanceTimersByTimeAsync(9000);
    expect(hlsReads).toHaveBeenCalledTimes(secondScanReads);

    await vi.advanceTimersByTimeAsync(1000);
    expect(hlsReads.mock.calls.length).toBeGreaterThan(secondScanReads);
  });
});
