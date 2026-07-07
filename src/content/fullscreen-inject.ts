// MAIN-world fullscreen bridge. A bare <video> in fullscreen cannot render
// extension overlays as children, so request fullscreen on a temporary wrapper
// instead. The isolated badge/launcher code then appends into that fullscreen
// wrapper like it does for normal player containers.
(function () {
  "use strict";

  const BRIDGE_VERSION = "2026-07-07-fullscreen-wrapper";
  type FullscreenBridgeWindow = typeof window & {
    __vtpFullscreenBridgeInstalled?: boolean | string;
    __vtpFullscreenBridgeCleanup?: () => void;
    __vtpFullscreenNativeRequest?: Element["requestFullscreen"];
  };
  type StyleSnapshot = Pick<
    CSSStyleDeclaration,
    "width" | "height" | "maxWidth" | "maxHeight" | "display" | "objectFit"
  >;

  const win = window as FullscreenBridgeWindow;
  if (win.__vtpFullscreenBridgeInstalled === BRIDGE_VERSION) return;
  try {
    win.__vtpFullscreenBridgeCleanup?.();
  } catch (e) {
    /* stale bridge cleanup must not block the new bridge */
  }
  const videoProto = HTMLVideoElement.prototype;
  const elementProto = Element.prototype;
  const nativeRequest = win.__vtpFullscreenNativeRequest || Element.prototype.requestFullscreen;
  if (typeof nativeRequest !== "function") return;
  win.__vtpFullscreenNativeRequest = nativeRequest;
  win.__vtpFullscreenBridgeInstalled = BRIDGE_VERSION;

  function snapshot(video: HTMLVideoElement): StyleSnapshot {
    return {
      width: video.style.width,
      height: video.style.height,
      maxWidth: video.style.maxWidth,
      maxHeight: video.style.maxHeight,
      display: video.style.display,
      objectFit: video.style.objectFit,
    };
  }

  function restore(video: HTMLVideoElement, style: StyleSnapshot): void {
    video.style.width = style.width;
    video.style.height = style.height;
    video.style.maxWidth = style.maxWidth;
    video.style.maxHeight = style.maxHeight;
    video.style.display = style.display;
    video.style.objectFit = style.objectFit;
  }

  function requestWrappedFullscreen(
    video: HTMLVideoElement,
    options?: FullscreenOptions,
  ): Promise<void> {
    const parent = video.parentNode;
    if (!parent || !video.isConnected || document.fullscreenElement) {
      return nativeRequest.call(video, options);
    }

    const next = video.nextSibling;
    const prevStyle = snapshot(video);
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-vtp-fullscreen-wrapper", "");
    Object.assign(wrapper.style, {
      position: "relative",
      width: "100%",
      height: "100%",
      background: "#000",
      display: "grid",
      placeItems: "center",
      overflow: "hidden",
    } as Partial<CSSStyleDeclaration>);
    Object.assign(video.style, {
      width: "100%",
      height: "100%",
      maxWidth: "100%",
      maxHeight: "100%",
      display: "block",
      objectFit: "contain",
    } as Partial<CSSStyleDeclaration>);

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      document.removeEventListener("fullscreenchange", onFullscreenChange, true);
      restore(video, prevStyle);
      if (wrapper.parentNode) {
        parent.insertBefore(video, next && next.parentNode === parent ? next : null);
        wrapper.remove();
      }
    };
    const onFullscreenChange = () => {
      if (document.fullscreenElement !== wrapper) cleanup();
    };

    parent.insertBefore(wrapper, video);
    wrapper.appendChild(video);
    document.addEventListener("fullscreenchange", onFullscreenChange, true);

    try {
      return nativeRequest.call(wrapper, options).catch((e) => {
        cleanup();
        return nativeRequest.call(video, options).catch(() => {
          throw e;
        });
      });
    } catch (e) {
      cleanup();
      return nativeRequest.call(video, options);
    }
  }

  const hookedRequest = function (
    this: HTMLVideoElement,
    options?: FullscreenOptions,
  ): Promise<void> {
    return requestWrappedFullscreen(this, options);
  };
  const hookedElementRequest = function (
    this: Element,
    options?: FullscreenOptions,
  ): Promise<void> {
    if (this instanceof HTMLVideoElement) return requestWrappedFullscreen(this, options);
    return nativeRequest.call(this, options);
  };

  let elementPatched = false;
  try {
    Object.defineProperty(elementProto, "requestFullscreen", {
      configurable: true,
      writable: true,
      value: hookedElementRequest,
    });
    elementPatched = true;
    Object.defineProperty(videoProto, "requestFullscreen", {
      configurable: true,
      writable: true,
      value: hookedRequest,
    });
  } catch (e) {
    if (elementPatched && elementProto.requestFullscreen === hookedElementRequest) {
      Object.defineProperty(elementProto, "requestFullscreen", {
        configurable: true,
        writable: true,
        value: nativeRequest,
      });
    }
    if (win.__vtpFullscreenBridgeInstalled === BRIDGE_VERSION) {
      delete win.__vtpFullscreenBridgeInstalled;
    }
    return;
  }
  win.__vtpFullscreenBridgeCleanup = () => {
    if (elementProto.requestFullscreen === hookedElementRequest) {
      Object.defineProperty(elementProto, "requestFullscreen", {
        configurable: true,
        writable: true,
        value: nativeRequest,
      });
    }
    if (videoProto.requestFullscreen !== hookedRequest) return;
    Object.defineProperty(videoProto, "requestFullscreen", {
      configurable: true,
      writable: true,
      value: nativeRequest,
    });
    if (win.__vtpFullscreenBridgeInstalled === BRIDGE_VERSION) {
      delete win.__vtpFullscreenBridgeInstalled;
    }
  };
})();
