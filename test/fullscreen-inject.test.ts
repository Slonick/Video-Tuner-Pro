// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalRequest = Element.prototype.requestFullscreen;
const win = window as typeof window & {
  __vtpFullscreenBridgeInstalled?: boolean | string;
  __vtpFullscreenBridgeCleanup?: () => void;
  __vtpFullscreenNativeRequest?: Element["requestFullscreen"];
};
const REQUEST_EVENT = "vtp-request-wrapped-fullscreen";

function setFullscreenElement(el: Element | null): void {
  Object.defineProperty(document, "fullscreenElement", { value: el, configurable: true });
}

function setWebkitFullscreenElement(el: Element | null): void {
  Object.defineProperty(document, "webkitFullscreenElement", { value: el, configurable: true });
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
  setWebkitFullscreenElement(null);
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
  setWebkitFullscreenElement(null);
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

  it("leaves site video fullscreen requests alone", async () => {
    await loadBridge();
    const parent = document.createElement("section");
    const video = document.createElement("video");
    parent.append(video);
    document.body.append(parent);

    await video.requestFullscreen();

    expect(parent.querySelector("[data-vtp-fullscreen-wrapper]")).toBeNull();
    expect(document.fullscreenElement).toBe(video);
    expect(
      (Element.prototype.requestFullscreen as ReturnType<typeof vi.fn>).mock.instances[0],
    ).toBe(video);
  });

  it("wraps a bare video only for the extension fullscreen event", async () => {
    await loadBridge();
    const parent = document.createElement("section");
    const video = document.createElement("video");
    const marker = document.createElement("p");
    video.style.objectFit = "cover";
    parent.append(video, marker);
    document.body.append(parent);

    video.dispatchEvent(new Event(REQUEST_EVENT, { bubbles: true, cancelable: true }));

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

  it("cleans up the wrapper on prefixed fullscreen changes too", async () => {
    await loadBridge();
    const parent = document.createElement("section");
    const video = document.createElement("video");
    parent.append(video);
    document.body.append(parent);

    video.dispatchEvent(new Event(REQUEST_EVENT, { bubbles: true, cancelable: true }));

    const wrapper = parent.querySelector("[data-vtp-fullscreen-wrapper]") as HTMLElement;
    expect(wrapper).toBeTruthy();

    setFullscreenElement(null);
    setWebkitFullscreenElement(null);
    document.dispatchEvent(new Event("webkitfullscreenchange"));

    expect(parent.firstChild).toBe(video);
    expect(wrapper.isConnected).toBe(false);
  });

  it("also leaves Element.requestFullscreen calls with a video receiver alone", async () => {
    await loadBridge();
    const parent = document.createElement("section");
    const video = document.createElement("video");
    parent.append(video);
    document.body.append(parent);

    await Element.prototype.requestFullscreen.call(video);

    expect(parent.querySelector("[data-vtp-fullscreen-wrapper]")).toBeNull();
    expect(document.fullscreenElement).toBe(video);
  });

  it("cleans up the current install flag so the bridge can be reinstalled", async () => {
    await loadBridge();
    win.__vtpFullscreenBridgeCleanup?.();

    expect(win.__vtpFullscreenBridgeInstalled).toBeUndefined();

    await reloadBridgeKeepingState();
    const video = document.createElement("video");
    document.body.append(video);

    video.dispatchEvent(new Event(REQUEST_EVENT, { bubbles: true, cancelable: true }));

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

    video.dispatchEvent(new Event(REQUEST_EVENT, { bubbles: true, cancelable: true }));

    expect(document.querySelector("[data-vtp-fullscreen-wrapper]")).toBeNull();
    expect((win.__vtpFullscreenNativeRequest as ReturnType<typeof vi.fn>).mock.instances[0]).toBe(
      video,
    );
  });
});
