// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalRequest = Element.prototype.requestFullscreen;
const win = window as typeof window & {
  __vtpFullscreenBridgeInstalled?: boolean | string;
  __vtpFullscreenBridgeCleanup?: () => void;
  __vtpFullscreenNativeRequest?: Element["requestFullscreen"];
};

function setFullscreenElement(el: Element | null): void {
  Object.defineProperty(document, "fullscreenElement", { value: el, configurable: true });
}

async function loadBridge(): Promise<void> {
  vi.resetModules();
  delete win.__vtpFullscreenBridgeInstalled;
  delete win.__vtpFullscreenBridgeCleanup;
  delete win.__vtpFullscreenNativeRequest;
  await import("../src/content/fullscreen-inject.js");
}

async function reloadBridgeKeepingState(): Promise<void> {
  vi.resetModules();
  await import("../src/content/fullscreen-inject.js");
}

beforeEach(() => {
  document.body.innerHTML = "";
  setFullscreenElement(null);
  Object.defineProperty(Element.prototype, "requestFullscreen", {
    configurable: true,
    value: vi.fn(function (this: Element) {
      setFullscreenElement(this);
      return Promise.resolve();
    }),
  });
});

afterEach(() => {
  win.__vtpFullscreenBridgeCleanup?.();
  delete win.__vtpFullscreenBridgeInstalled;
  delete win.__vtpFullscreenBridgeCleanup;
  delete win.__vtpFullscreenNativeRequest;
  Object.defineProperty(Element.prototype, "requestFullscreen", {
    configurable: true,
    value: originalRequest,
  });
  setFullscreenElement(null);
});

describe("fullscreen-inject", () => {
  it("does not leave an installed flag when fullscreen is unavailable", async () => {
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });

    await loadBridge();

    expect(win.__vtpFullscreenBridgeInstalled).toBeUndefined();
  });

  it("fullscreen-wraps a bare video so overlays can render in fullscreen", async () => {
    await loadBridge();
    const parent = document.createElement("section");
    const video = document.createElement("video");
    const marker = document.createElement("p");
    video.style.objectFit = "cover";
    parent.append(video, marker);
    document.body.append(parent);

    await video.requestFullscreen();

    const nativeRequest = win.__vtpFullscreenNativeRequest as ReturnType<typeof vi.fn>;
    const wrapper = parent.querySelector("[data-vtp-fullscreen-wrapper]") as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.contains(video)).toBe(true);
    expect(document.fullscreenElement).toBe(wrapper);
    expect(nativeRequest).toHaveBeenCalledTimes(1);
    expect(nativeRequest.mock.instances[0]).toBe(wrapper);
    expect(video.style.objectFit).toBe("contain");

    setFullscreenElement(null);
    document.dispatchEvent(new Event("fullscreenchange"));

    expect(parent.firstChild).toBe(video);
    expect(video.nextSibling).toBe(marker);
    expect(wrapper.isConnected).toBe(false);
    expect(video.style.objectFit).toBe("cover");
  });

  it("also wraps when a site calls Element.requestFullscreen with a video receiver", async () => {
    await loadBridge();
    const parent = document.createElement("section");
    const video = document.createElement("video");
    parent.append(video);
    document.body.append(parent);

    await Element.prototype.requestFullscreen.call(video);

    const nativeRequest = win.__vtpFullscreenNativeRequest as ReturnType<typeof vi.fn>;
    const wrapper = parent.querySelector("[data-vtp-fullscreen-wrapper]") as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.contains(video)).toBe(true);
    expect(document.fullscreenElement).toBe(wrapper);
    expect(nativeRequest.mock.instances[0]).toBe(wrapper);
  });

  it("cleans up the current install flag so the bridge can be reinstalled", async () => {
    await loadBridge();
    win.__vtpFullscreenBridgeCleanup?.();

    expect(win.__vtpFullscreenBridgeInstalled).toBeUndefined();

    await reloadBridgeKeepingState();
    const video = document.createElement("video");
    document.body.append(video);

    await video.requestFullscreen();

    expect(document.querySelector("[data-vtp-fullscreen-wrapper]")).toBeTruthy();
  });

  it("does not clear a newer bridge owner from an old cleanup callback", async () => {
    await loadBridge();
    const cleanup = win.__vtpFullscreenBridgeCleanup!;

    win.__vtpFullscreenBridgeInstalled = "newer-bridge";
    cleanup();

    expect(win.__vtpFullscreenBridgeInstalled).toBe("newer-bridge");
  });

  it("does not wrap while another element is already fullscreen", async () => {
    await loadBridge();
    const video = document.createElement("video");
    const alreadyFullscreen = document.createElement("div");
    document.body.append(video, alreadyFullscreen);
    setFullscreenElement(alreadyFullscreen);

    await video.requestFullscreen();

    expect(document.querySelector("[data-vtp-fullscreen-wrapper]")).toBeNull();
    expect((win.__vtpFullscreenNativeRequest as ReturnType<typeof vi.fn>).mock.instances[0]).toBe(
      video,
    );
  });
});
