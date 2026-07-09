// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

interface QualityResponse {
  requestId: string;
  current: string;
  options: Array<{ id: string; current?: boolean }>;
}

beforeEach(() => {
  (
    window as typeof window & { __vtpQualityBridgeCleanup?: () => void }
  ).__vtpQualityBridgeCleanup?.();
  vi.resetModules();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-vtp-quality-response");
  document.documentElement.removeAttribute("data-vtp-quality-debug");
  delete (window as typeof window & { Hls?: unknown }).Hls;
  delete (window as typeof window & { IVSPlayer?: unknown }).IVSPlayer;
  window.CSS ||= {} as CSS;
  window.CSS.escape ||= (value: string) => value.replace(/["\\]/g, "\\$&");
  (
    window as typeof window & { __vtpQualityBridgeInstalled?: unknown }
  ).__vtpQualityBridgeInstalled = undefined;
  delete (window as typeof window & { __vtpQualityBridgeCleanup?: () => void })
    .__vtpQualityBridgeCleanup;
});

function waitForResponse(requestId: string): Promise<QualityResponse> {
  return new Promise((resolve) => {
    document.addEventListener(
      "vtp-quality-response",
      (e) => {
        const detail = (e as CustomEvent).detail as QualityResponse;
        if (detail.requestId === requestId) resolve(detail);
      },
      { once: true },
    );
  });
}

function responseWithin(requestId: string, ms: number): Promise<QualityResponse | null> {
  return Promise.race([
    waitForResponse(requestId),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function videoWithRoot(root: HTMLElement): HTMLVideoElement {
  const video = document.createElement("video");
  video.setAttribute("data-vtp-quality-id", "v1");
  root.append(video);
  document.body.append(root);
  return video;
}

async function requestQuality(requestId = "r1"): Promise<QualityResponse> {
  const response = waitForResponse(requestId);
  document.dispatchEvent(
    new CustomEvent("vtp-quality-request", { detail: { requestId, videoId: "v1" } }),
  );
  return response;
}

async function setQuality(qualityId: string, requestId = "set"): Promise<QualityResponse> {
  const response = waitForResponse(requestId);
  document.dispatchEvent(
    new CustomEvent("vtp-quality-set", {
      detail: { requestId, videoId: "v1", qualityId },
    }),
  );
  return response;
}

describe("quality-inject request cost", () => {
  it("calls the previous bridge cleanup before taking ownership", async () => {
    const cleanup = vi.fn();
    (
      window as typeof window & {
        __vtpQualityBridgeInstalled?: unknown;
        __vtpQualityBridgeCleanup?: () => void;
      }
    ).__vtpQualityBridgeInstalled = "older-bridge";
    (
      window as typeof window & {
        __vtpQualityBridgeCleanup?: () => void;
      }
    ).__vtpQualityBridgeCleanup = cleanup;

    await import("../src/content/quality-inject.js");

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("removes request listeners when the bridge is cleaned up", async () => {
    await import("../src/content/quality-inject.js");

    (
      window as typeof window & { __vtpQualityBridgeCleanup?: () => void }
    ).__vtpQualityBridgeCleanup?.();

    const response = responseWithin("after-cleanup", 20);
    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "after-cleanup", videoId: "v1" },
      }),
    );

    expect(await response).toBeNull();
  });

  it("does not clear a newer bridge owner from an old cleanup callback", async () => {
    await import("../src/content/quality-inject.js");
    const cleanup = (window as typeof window & { __vtpQualityBridgeCleanup?: () => void })
      .__vtpQualityBridgeCleanup!;

    (
      window as typeof window & { __vtpQualityBridgeInstalled?: unknown }
    ).__vtpQualityBridgeInstalled = "newer-bridge";
    cleanup();

    expect(
      (window as typeof window & { __vtpQualityBridgeInstalled?: unknown })
        .__vtpQualityBridgeInstalled,
    ).toBe("newer-bridge");
  });

  it("preserves window.Hls across bridge cleanup and reinstall", async () => {
    class FakeHls {
      static isSupported() {
        return true;
      }

      attachMedia() {}
    }

    (window as typeof window & { Hls?: unknown }).Hls = FakeHls;
    await import("../src/content/quality-inject.js");

    (
      window as typeof window & { __vtpQualityBridgeCleanup?: () => void }
    ).__vtpQualityBridgeCleanup?.();
    vi.resetModules();

    await import("../src/content/quality-inject.js");

    expect((window as typeof window & { Hls?: unknown }).Hls).toBe(FakeHls);
  });

  it("uses local player roots first and scans the document only as a fallback", async () => {
    await import("../src/content/quality-inject.js");

    const qualities = [{ height: 360 }, { height: 720 }];
    const player = {
      selected: qualities[0],
      getQualities: vi.fn(() => qualities),
      getQuality: vi.fn(() => player.selected),
      setQuality: vi.fn(),
      isAutoQualityMode: vi.fn(() => false),
      setAutoQualityMode: vi.fn(),
    };

    const host = document.createElement("div") as HTMLDivElement & {
      __reactFiber$vtp?: unknown;
    };
    host.__reactFiber$vtp = {
      child: {
        memoizedProps: {
          mediaPlayerInstance: player,
        },
      },
    };
    const video = document.createElement("video");
    video.setAttribute("data-vtp-quality-id", "v1");
    host.append(video);
    document.body.append(host);
    const queryAll = vi.spyOn(document, "querySelectorAll");

    const response = waitForResponse("r-local");
    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "r-local", videoId: "v1" },
      }),
    );

    const detail = await response;
    expect(detail.options.map((opt) => opt.id)).toEqual(["auto", "::360:::0", "::720:::1"]);
    expect(queryAll.mock.calls.filter(([selector]) => selector === "*")).toHaveLength(0);

    document.body.innerHTML = "";
    queryAll.mockClear();
    const plainVideo = document.createElement("video");
    plainVideo.setAttribute("data-vtp-quality-id", "v2");
    document.body.append(plainVideo);

    const fallbackResponse = waitForResponse("r-scan");
    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", { detail: { requestId: "r-scan", videoId: "v2" } }),
    );

    await fallbackResponse;
    expect(queryAll.mock.calls.filter(([selector]) => selector === "*")).toHaveLength(1);
  });

  it("does not collect debug details on ordinary unsupported requests", async () => {
    await import("../src/content/quality-inject.js");

    const video = document.createElement("video");
    video.setAttribute("data-vtp-quality-id", "v1");
    document.body.append(video);

    const response = waitForResponse("r-no-debug");
    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "r-no-debug", videoId: "v1" },
      }),
    );

    await response;
    expect(document.documentElement.getAttribute("data-vtp-quality-debug")).toBeNull();
  });

  it("does not rescan React roots repeatedly for the same unsupported video", async () => {
    await import("../src/content/quality-inject.js");

    const video = document.createElement("video");
    video.setAttribute("data-vtp-quality-id", "v1");
    document.body.append(video);
    const queryAll = vi.spyOn(document, "querySelectorAll");

    const first = waitForResponse("miss-1");
    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "miss-1", videoId: "v1" },
      }),
    );
    await first;

    queryAll.mockClear();
    const second = waitForResponse("miss-2");
    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "miss-2", videoId: "v1" },
      }),
    );
    await second;

    expect(queryAll.mock.calls.filter(([selector]) => selector === "*")).toHaveLength(0);
  });

  it("refreshes stale player roots after an unsupported adapter miss expires", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      await import("../src/content/quality-inject.js");

      const video = document.createElement("video");
      video.setAttribute("data-vtp-quality-id", "v1");
      document.body.append(video);

      const first = waitForResponse("late-1");
      document.dispatchEvent(
        new CustomEvent("vtp-quality-request", {
          detail: { requestId: "late-1", videoId: "v1" },
        }),
      );
      await first;

      const qualities = [{ height: 360 }, { height: 720 }];
      const player = {
        selected: qualities[1],
        getQualities: vi.fn(() => qualities),
        getQuality: vi.fn(() => player.selected),
        setQuality: vi.fn(),
        isAutoQualityMode: vi.fn(() => false),
        setAutoQualityMode: vi.fn(),
      };
      const host = document.createElement("div") as HTMLDivElement & {
        __reactFiber$vtp?: unknown;
      };
      host.__reactFiber$vtp = {
        child: {
          memoizedProps: {
            mediaPlayerInstance: player,
          },
        },
      };
      host.append(video);
      document.body.append(host);
      now.mockReturnValue(3_500);

      const second = waitForResponse("late-2");
      document.dispatchEvent(
        new CustomEvent("vtp-quality-request", {
          detail: { requestId: "late-2", videoId: "v1" },
        }),
      );

      const detail = await second;
      expect(detail.options.map((opt) => opt.id)).toEqual(["auto", "::360:::0", "::720:::1"]);
    } finally {
      now.mockRestore();
    }
  });

  it("answers a reused request id after the previous request has finished", async () => {
    await import("../src/content/quality-inject.js");

    const video = document.createElement("video");
    video.setAttribute("data-vtp-quality-id", "v1");
    document.body.append(video);

    const first = waitForResponse("repeat");
    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "repeat", videoId: "v1" },
      }),
    );
    await first;

    const second = responseWithin("repeat", 50);
    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "repeat", videoId: "v1" },
      }),
    );

    expect(await second).not.toBeNull();
  });

  it("collects unsupported-player debug details only when explicitly requested", async () => {
    await import("../src/content/quality-inject.js");

    const video = document.createElement("video");
    video.setAttribute("data-vtp-quality-id", "v1");
    document.body.append(video);
    document.documentElement.setAttribute("data-vtp-quality-debug", "1");

    const response = waitForResponse("r-debug");
    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "r-debug", videoId: "v1" },
      }),
    );

    await response;
    expect(
      JSON.parse(document.documentElement.getAttribute("data-vtp-quality-debug") || "{}"),
    ).toMatchObject({
      adapter: false,
    });
  });

  it("caps captured IVS-like players", async () => {
    const players = Array.from({ length: 10 }, () => ({
      attachHTMLVideoElement() {},
      getQualities: () => [{ height: 360 }, { height: 720 }],
      setQuality() {},
    }));
    let next = 0;
    (window as typeof window & { IVSPlayer?: unknown }).IVSPlayer = {
      create: () => players[next++],
    };
    await import("../src/content/quality-inject.js");

    for (let i = 0; i < 10; i++) {
      (window as typeof window & { IVSPlayer: { create: () => unknown } }).IVSPlayer.create();
    }

    expect(
      (window as typeof window & { __vtpQualityPlayers?: unknown[] }).__vtpQualityPlayers,
    ).toHaveLength(8);
  });

  it("prunes IVS players that never attach a video", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      (window as typeof window & { __vtpQualityPlayers?: unknown[] }).__vtpQualityPlayers = [];
      const players = [{}, {}];
      let next = 0;
      (window as typeof window & { IVSPlayer?: unknown }).IVSPlayer = {
        create: () => players[next++],
      };
      await import("../src/content/quality-inject.js");

      (window as typeof window & { IVSPlayer: { create: () => unknown } }).IVSPlayer.create();
      vi.setSystemTime(32_000);
      (window as typeof window & { IVSPlayer: { create: () => unknown } }).IVSPlayer.create();

      expect(
        (
          window as typeof window & { __vtpQualityPlayers?: Array<{ player: unknown }> }
        ).__vtpQualityPlayers?.map((entry) => entry.player),
      ).toEqual([players[1]]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("quality-inject YouTube adapter", () => {
  it("keeps the selected quality current while YouTube reports the old level", async () => {
    await import("../src/content/quality-inject.js");

    const root = document.createElement("div") as HTMLDivElement & {
      getAvailableQualityLevels?: () => string[];
      getPlaybackQuality?: () => string;
      setPlaybackQualityRange?: (min: string, max?: string) => void;
      setPlaybackQuality?: (q: string) => void;
    };
    root.className = "html5-video-player";
    root.getAvailableQualityLevels = () => ["hd1080", "hd720", "large"];
    root.getPlaybackQuality = () => "hd1080";
    root.setPlaybackQualityRange = vi.fn();
    root.setPlaybackQuality = vi.fn();

    const video = document.createElement("video");
    video.setAttribute("data-vtp-quality-id", "yt1");
    root.append(video);
    document.body.append(root);

    const setResponse = waitForResponse("yt-set");
    document.dispatchEvent(
      new CustomEvent("vtp-quality-set", {
        detail: { requestId: "yt-set", videoId: "yt1", qualityId: "hd720" },
      }),
    );

    const setDetail = await setResponse;
    expect(setDetail.current).toBe("hd720");
    expect(setDetail.options.find((opt) => opt.id === "hd720")?.current).toBe(true);

    const refreshResponse = waitForResponse("yt-refresh");
    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", {
        detail: { requestId: "yt-refresh", videoId: "yt1" },
      }),
    );

    const refreshDetail = await refreshResponse;
    expect(refreshDetail.current).toBe("hd720");
    expect(refreshDetail.options.find((opt) => opt.id === "hd720")?.current).toBe(true);
  });
});

describe("quality-inject HLS adapter", () => {
  it("caps and prunes captured hls.js instances", async () => {
    class FakeHls {
      levels = [{ height: 360 }, { height: 720 }];
      currentLevel = 0;
      media: HTMLMediaElement | null = null;

      attachMedia(media: HTMLMediaElement) {
        this.media = media;
      }
    }

    (window as typeof window & { Hls?: unknown }).Hls = FakeHls;
    await import("../src/content/quality-inject.js");

    const videos: HTMLVideoElement[] = [];
    for (let i = 0; i < 10; i++) {
      const video = document.createElement("video");
      document.body.append(video);
      videos.push(video);
      new (window as typeof window & { Hls: typeof FakeHls }).Hls().attachMedia(video);
    }

    const hlsRegistry = (window as typeof window & { __vtpQualityHls?: unknown[] })
      .__vtpQualityHls!;
    expect(hlsRegistry).toHaveLength(8);

    videos.slice(2, 9).forEach((video) => video.remove());
    new (window as typeof window & { Hls: typeof FakeHls }).Hls().attachMedia(videos[9]);

    expect(
      (
        (window as typeof window & { __vtpQualityHls?: Array<{ video: HTMLVideoElement | null }> })
          .__vtpQualityHls || []
      ).every((entry) => entry.video?.isConnected),
    ).toBe(true);
  });

  it("stops answering after a newer bridge version takes ownership", async () => {
    class FakeHls {
      levels = [{ height: 720 }, { height: 1080 }];
      autoLevelEnabled = true;
      media: HTMLMediaElement | null = null;

      attachMedia(media: HTMLMediaElement) {
        this.media = media;
      }
    }

    (window as typeof window & { Hls?: unknown }).Hls = FakeHls;
    await import("../src/content/quality-inject.js");

    const video = document.createElement("video");
    video.setAttribute("data-vtp-quality-id", "v1");
    document.body.append(video);
    const hls = new (window as typeof window & { Hls: typeof FakeHls }).Hls();
    hls.attachMedia(video);

    (
      window as typeof window & { __vtpQualityBridgeInstalled?: unknown }
    ).__vtpQualityBridgeInstalled = "newer-bridge";

    const response = responseWithin("r-old", 20);
    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", { detail: { requestId: "r-old", videoId: "v1" } }),
    );

    expect(await response).toBeNull();
  });

  it("marks Auto as current when hls.js auto level mode is enabled", async () => {
    class FakeHls {
      levels = [{ height: 720 }, { height: 1080 }];
      autoLevelEnabled = true;
      currentLevel = 1;
      nextLevel = 1;
      media: HTMLMediaElement | null = null;

      attachMedia(media: HTMLMediaElement) {
        this.media = media;
      }
    }

    (window as typeof window & { Hls?: unknown }).Hls = FakeHls;
    await import("../src/content/quality-inject.js");

    const video = document.createElement("video");
    video.setAttribute("data-vtp-quality-id", "v1");
    document.body.append(video);

    const hls = new (window as typeof window & { Hls: typeof FakeHls }).Hls();
    hls.attachMedia(video);

    const response = waitForResponse("r1");
    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", { detail: { requestId: "r1", videoId: "v1" } }),
    );

    const detail = await response;
    expect(detail.current).toBe("auto");
    expect(detail.options.find((opt) => opt.id === "auto")?.current).toBe(true);
  });

  it("keeps Auto current when hls.js reports the playing level separately", async () => {
    class FakeHls {
      levels = [{ height: 720 }, { height: 1080 }];
      currentLevel = 1;
      nextLevel = -1;
      loadLevel = -1;
      media: HTMLMediaElement | null = null;

      attachMedia(media: HTMLMediaElement) {
        this.media = media;
      }
    }

    (window as typeof window & { Hls?: unknown }).Hls = FakeHls;
    await import("../src/content/quality-inject.js");

    const video = document.createElement("video");
    video.setAttribute("data-vtp-quality-id", "v1");
    document.body.append(video);

    const hls = new (window as typeof window & { Hls: typeof FakeHls }).Hls();
    hls.attachMedia(video);

    const response = waitForResponse("r1");
    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", { detail: { requestId: "r1", videoId: "v1" } }),
    );

    const detail = await response;
    expect(detail.current).toBe("auto");
    expect(detail.options.find((opt) => opt.id === "auto")?.current).toBe(true);
  });

  it("keeps a manual HLS selection current while auto-level flags settle", async () => {
    class FakeHls {
      levels = [{ height: 720 }, { height: 1080 }];
      autoLevelEnabled = true;
      currentLevel = -1;
      nextLevel = -1;
      loadLevel = -1;
      media: HTMLMediaElement | null = null;

      attachMedia(media: HTMLMediaElement) {
        this.media = media;
      }
    }

    (window as typeof window & { Hls?: unknown }).Hls = FakeHls;
    await import("../src/content/quality-inject.js");

    const video = document.createElement("video");
    video.setAttribute("data-vtp-quality-id", "v1");
    document.body.append(video);

    const hls = new (window as typeof window & { Hls: typeof FakeHls }).Hls();
    hls.attachMedia(video);

    const detail = await setQuality("1");

    expect(detail.current).toBe("1");
    expect(detail.options.find((opt) => opt.id === "1")?.current).toBe(true);
  });
});

describe("quality-inject React-hosted player adapter", () => {
  it("finds an IVS-like mediaPlayerInstance in React internals near the video", async () => {
    await import("../src/content/quality-inject.js");

    const qualities = [{ height: 360 }, { height: 720 }];
    const player = {
      selected: qualities[0],
      getQualities: vi.fn(() => qualities),
      getQuality: vi.fn(() => player.selected),
      setQuality: vi.fn((quality: (typeof qualities)[number]) => {
        player.selected = quality;
      }),
      isAutoQualityMode: vi.fn(() => false),
      setAutoQualityMode: vi.fn(),
    };

    const host = document.createElement("div") as HTMLDivElement & {
      __reactFiber$vtp?: unknown;
    };
    host.__reactFiber$vtp = {
      child: {
        pendingProps: {
          mediaPlayerInstance: player,
        },
      },
    };
    const video = document.createElement("video");
    video.setAttribute("data-vtp-quality-id", "v1");
    host.append(video);
    document.body.append(host);

    const response = waitForResponse("r1");
    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", { detail: { requestId: "r1", videoId: "v1" } }),
    );

    const detail = await response;
    expect(detail.current).toContain("360");
    expect(detail.options.map((opt) => opt.id)).toEqual(["auto", "::360:::0", "::720:::1"]);

    const setResponse = waitForResponse("r2");
    document.dispatchEvent(
      new CustomEvent("vtp-quality-set", {
        detail: { requestId: "r2", videoId: "v1", qualityId: "::720:::1" },
      }),
    );

    await setResponse;
    expect(player.setAutoQualityMode).toHaveBeenCalledWith(false);
    expect(player.setQuality).toHaveBeenCalledWith(qualities[1], false);
  });

  it("reaches deeply nested React player internals", async () => {
    await import("../src/content/quality-inject.js");

    const qualities = [
      { name: "480p", height: 480 },
      { name: "1080p", height: 1080 },
    ];
    const player = {
      getQualities: vi.fn(() => qualities),
      getQuality: vi.fn(() => qualities[0]),
      setQuality: vi.fn(),
      isAutoQualityMode: vi.fn(() => false),
      setAutoQualityMode: vi.fn(),
    };

    const host = document.createElement("div") as HTMLDivElement & {
      __reactFiber$vtp?: unknown;
    };
    host.__reactFiber$vtp = {
      return: {
        return: {
          return: {
            child: {
              child: {
                child: {
                  memoizedProps: {
                    mediaPlayerInstance: player,
                  },
                },
              },
            },
          },
        },
      },
    };
    const video = document.createElement("video");
    video.setAttribute("data-vtp-quality-id", "v1");
    host.append(video);
    document.body.append(host);

    const response = waitForResponse("r1");
    document.dispatchEvent(
      new CustomEvent("vtp-quality-request", { detail: { requestId: "r1", videoId: "v1" } }),
    );

    const detail = await response;
    expect(detail.options.map((opt) => opt.label)).toEqual(["Auto", "480p", "1080p"]);
  });
});

describe("quality-inject generic player adapters", () => {
  it("reads and sets DASH quality levels", async () => {
    await import("../src/content/quality-inject.js");
    const dash = {
      getBitrateInfoListFor: vi.fn(() => [
        { height: 360, bitrate: 800_000 },
        { height: 720, bitrate: 2_400_000 },
      ]),
      getQualityFor: vi.fn(() => 0),
      updateSettings: vi.fn(),
      setQualityFor: vi.fn(),
    };
    const root = document.createElement("div") as HTMLDivElement & { __reactFiber$vtp?: unknown };
    root.__reactFiber$vtp = { memoizedProps: { dashPlayer: dash } };
    videoWithRoot(root);

    const detail = await requestQuality();
    expect(detail.options.map((opt) => opt.id)).toEqual(["auto", "0", "1"]);

    await setQuality("1");
    expect(dash.updateSettings).toHaveBeenCalledWith({
      streaming: { abr: { autoSwitchBitrate: { video: false } } },
    });
    expect(dash.setQualityFor).toHaveBeenCalledWith("video", 1);
  });

  it("reads and sets Shaka variant tracks", async () => {
    await import("../src/content/quality-inject.js");
    const tracks = [
      { id: 1, height: 360, bandwidth: 800_000, active: true },
      { id: 2, height: 1080, bandwidth: 4_000_000 },
      { id: 99, type: "audio" },
    ];
    const shaka = {
      getVariantTracks: vi.fn(() => tracks),
      configure: vi.fn(),
      selectVariantTrack: vi.fn(),
    };
    const root = document.createElement("div") as HTMLDivElement & { __reactFiber$vtp?: unknown };
    root.__reactFiber$vtp = { memoizedProps: { shakaPlayer: shaka } };
    videoWithRoot(root);

    const detail = await requestQuality();
    expect(detail.options.map((opt) => opt.id)).toEqual(["auto", "1", "2"]);
    expect(detail.current).toBe("1");

    await setQuality("2");
    expect(shaka.configure).toHaveBeenCalledWith({ abr: { enabled: false } });
    expect(shaka.selectVariantTrack).toHaveBeenCalledWith(tracks[1], true);
  });

  it("reads and sets Vidstack qualities", async () => {
    await import("../src/content/quality-inject.js");
    const qualities = [
      { height: 360, label: "360p", selected: true },
      { height: 720, label: "720p" },
    ] as Array<{ height: number; label: string; selected?: boolean }> & {
      auto?: boolean;
      autoSelect?: () => void;
    };
    qualities.auto = false;
    qualities.autoSelect = vi.fn();
    const root = document.createElement("media-player") as HTMLElement & {
      qualities?: typeof qualities;
    };
    root.qualities = qualities;
    videoWithRoot(root);

    const detail = await requestQuality();
    expect(detail.options.map((opt) => opt.id)).toEqual(["auto", "h360", "h720"]);
    expect(detail.current).toBe("h360");

    await setQuality("h720");
    expect(qualities.auto).toBe(false);
    expect(qualities[1].selected).toBe(true);
  });

  it("reads and sets Video.js quality levels", async () => {
    await import("../src/content/quality-inject.js");
    const levels = [
      { height: 360, enabled: vi.fn() },
      { height: 720, enabled: vi.fn() },
    ] as Array<{ height: number; enabled: ReturnType<typeof vi.fn> }> & {
      length: number;
      selectedIndex?: number;
    };
    levels.selectedIndex = 0;
    const player = {
      qualityLevels: vi.fn(() => levels),
    };
    const root = document.createElement("div") as HTMLDivElement & { __reactFiber$vtp?: unknown };
    root.__reactFiber$vtp = { memoizedProps: { videoJsPlayer: player } };
    videoWithRoot(root);

    const detail = await requestQuality();
    expect(detail.options.map((opt) => opt.id)).toEqual(["auto", "0", "1"]);
    expect(detail.current).toBe("0");

    await setQuality("1");
    expect(levels[0].enabled).toHaveBeenCalledWith(false);
    expect(levels[1].enabled).toHaveBeenCalledWith(true);
  });

  it("reads and sets VK video-player quality", async () => {
    await import("../src/content/quality-inject.js");
    const store = <T>(value: T) => ({
      subscribe(fn: (next: T) => void) {
        fn(value);
        return () => {};
      },
    });
    const player = {
      info: {
        availableQualities$: store(["360p", "720p"]),
        currentQuality$: store("360p"),
        isAutoQualityEnabled$: store(false),
      },
      setQuality: vi.fn(),
      setAutoQuality: vi.fn(),
    };
    const root = document.createElement("vk-video-player") as HTMLElement & {
      store?: { getPlayer: () => typeof player };
    };
    root.store = { getPlayer: () => player };
    videoWithRoot(root);

    const detail = await requestQuality();
    expect(detail.options.map((opt) => opt.id)).toEqual(["auto", "360p", "720p"]);
    expect(detail.current).toBe("360p");

    await setQuality("720p");
    expect(player.setAutoQuality).toHaveBeenCalledWith(false);
    expect(player.setQuality).toHaveBeenCalledWith("720p");
  });
});
