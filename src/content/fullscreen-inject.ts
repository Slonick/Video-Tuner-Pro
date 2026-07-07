// MAIN-world helper for extension-owned fullscreen requests. Sites keep their
// native fullscreen behavior; only our explicit event wraps a bare video so
// overlays can render inside the fullscreen element.
(function () {
  "use strict";

  const BRIDGE_VERSION = "2026-07-07-fullscreen-wrapper";
  const REQUEST_EVENT = "vtp-request-wrapped-fullscreen";
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
  const nativeRequest = win.__vtpFullscreenNativeRequest || Element.prototype.requestFullscreen;
  if (typeof nativeRequest !== "function") return;
  win.__vtpFullscreenNativeRequest = nativeRequest;
  win.__vtpFullscreenBridgeInstalled = BRIDGE_VERSION;

  let activeCleanup: (() => void) | null = null;

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

  function requestWrappedFullscreen(video: HTMLVideoElement): Promise<void> {
    const parent = video.parentNode;
    if (!parent || !video.isConnected || document.fullscreenElement) {
      return nativeRequest.call(video);
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
      if (activeCleanup === cleanup) activeCleanup = null;
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
    activeCleanup = cleanup;

    try {
      return nativeRequest.call(wrapper).catch((e) => {
        cleanup();
        return nativeRequest.call(video).catch(() => {
          throw e;
        });
      });
    } catch (e) {
      cleanup();
      return nativeRequest.call(video);
    }
  }

  const onRequest = (e: Event) => {
    const target = e.target;
    if (!(target instanceof HTMLVideoElement)) return;
    e.preventDefault();
    void requestWrappedFullscreen(target);
  };

  document.addEventListener(REQUEST_EVENT, onRequest, true);

  win.__vtpFullscreenBridgeCleanup = () => {
    document.removeEventListener(REQUEST_EVENT, onRequest, true);
    activeCleanup?.();
    if (win.__vtpFullscreenBridgeInstalled === BRIDGE_VERSION) {
      delete win.__vtpFullscreenBridgeInstalled;
    }
  };
})();
