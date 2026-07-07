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
  vi.resetModules();
  delete (window as typeof window & { __vtpLatencyBridgeInstalled?: boolean | string })
    .__vtpLatencyBridgeInstalled;
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
});
