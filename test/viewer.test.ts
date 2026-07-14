// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The pop-out viewer either mirrors or adopts the page's <video> into its own
// overlay with our control bar. Mock only the video picker and i18n; the overlay,
// bar and media wiring run against real jsdom DOM.
const h = vi.hoisted(() => ({
  primary: null as unknown,
  videos: [] as HTMLVideoElement[],
}));
vi.mock("../src/content/videos.js", () => ({
  primaryVideo: () => h.primary,
  collectVideos: () =>
    h.videos.length ? h.videos : h.primary ? [h.primary as HTMLVideoElement] : [],
  isDrmVideo: (v: HTMLVideoElement | null | undefined) => !!v && v.hasAttribute("data-drm"),
}));
vi.mock("../src/content/platform/i18n.js", () => ({ i18n: () => "" }));

import { S } from "../src/content/state.js";
import {
  toggleViewer,
  setViewerState,
  exitViewer,
  viewerFormat,
  viewerAnchorVideo,
  ownsViewerNode,
  refreshViewerBackdrop,
  fmtTime,
  VIEWER_LAYOUT_EVENT,
} from "../src/content/viewer.js";
import { LAUNCHER_TOP_LAYER_ATTR } from "../src/content/lifecycle.js";
import { onStreamPage, probeLive } from "../src/content/live/detection.js";

// A controllable media element: play/pause flip `paused` and fire the real
// events; currentTime/duration/videoWidth behave like a loaded 720p video.
function makeVideo(duration = 100) {
  const wrap = document.createElement("div");
  const v = document.createElement("video");
  v.style.cssText = "width: 640px; height: 360px;";
  Object.defineProperty(v, "videoWidth", { value: 1280, configurable: true });
  Object.defineProperty(v, "videoHeight", { value: 720, configurable: true });
  Object.defineProperty(v, "duration", { value: duration, configurable: true });
  let ct = 0;
  Object.defineProperty(v, "currentTime", {
    get: () => ct,
    set: (x: number) => (ct = x),
    configurable: true,
  });
  let paused = true;
  Object.defineProperty(v, "paused", { get: () => paused, configurable: true });
  let volume = 1;
  Object.defineProperty(v, "volume", {
    get: () => volume,
    set: (x: number) => {
      volume = x;
      v.dispatchEvent(new Event("volumechange"));
    },
    configurable: true,
  });
  let muted = false;
  Object.defineProperty(v, "muted", {
    get: () => muted,
    set: (x: boolean) => {
      muted = x;
      v.dispatchEvent(new Event("volumechange"));
    },
    configurable: true,
  });
  v.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 }) as DOMRect;
  v.play = () => {
    paused = false;
    v.dispatchEvent(new Event("play"));
    return Promise.resolve();
  };
  v.pause = () => {
    paused = true;
    v.dispatchEvent(new Event("pause"));
  };
  wrap.appendChild(v);
  document.body.appendChild(wrap);
  return { wrap, v };
}

function setSeekable(v: HTMLVideoElement, start: number, end: number): void {
  Object.defineProperty(v, "seekable", {
    value: {
      length: 1,
      start: () => start,
      end: () => end,
    },
    configurable: true,
  });
}

function installCapture(v: HTMLVideoElement): {
  stop: ReturnType<typeof vi.fn>;
  stream: MediaStream;
  capture: ReturnType<typeof vi.fn>;
} {
  const stop = vi.fn();
  const stream = {
    getVideoTracks: () => [{}],
    getTracks: () => [{ stop }],
  } as unknown as MediaStream;
  const capture = vi.fn(() => stream);
  Object.defineProperty(v, "captureStream", { value: capture, configurable: true });
  return { stop, stream, capture };
}

// open through a microtask flush so the DOM settles before assertions.
async function openViewer(f: "normal" | "theater") {
  toggleViewer(f);
  await flush();
}
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const overlayEl = () => document.querySelector("[data-vtp-viewer-overlay]") as HTMLElement | null;
const barEl = () => {
  const host = Array.from(overlayEl()?.children ?? []).find(
    (c) => (c as HTMLElement).shadowRoot,
  ) as HTMLElement | undefined;
  return (host?.shadowRoot?.querySelector(".bar") as HTMLElement | null) ?? null;
};
const barButtons = () => Array.from(barEl()?.querySelectorAll("button") ?? []); // play, mute, fmt, close
const barInputs = () => Array.from(barEl()?.querySelectorAll("input") ?? []) as HTMLInputElement[]; // seek, vol
const barTime = () => barEl()?.querySelector(".time")?.textContent ?? null;
const qwraps = () => Array.from(barEl()?.querySelectorAll(".qwrap") ?? []) as HTMLElement[];
const shadowActive = (el: Element) => (el.getRootNode() as ShadowRoot).activeElement;
const key = (el: EventTarget, value: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
const viewerBackdrop = () => overlayEl()?.querySelector("div") as HTMLElement | null;
const viewerBackdropVisual = () =>
  overlayEl()?.querySelector("[data-vtp-viewer-backdrop-video]") as HTMLElement | null;
const viewerBackdropVideo = () =>
  overlayEl()?.querySelector("[data-vtp-viewer-backdrop-video]") as HTMLVideoElement | null;
const chapterMarks = () => Array.from(barEl()?.querySelectorAll(".mark-chapter") ?? []);
const loadingEl = () =>
  overlayEl()?.querySelector("[data-vtp-viewer-loading]") as HTMLElement | null;

function setFullscreen(el: Element | null): void {
  Object.defineProperty(document, "fullscreenElement", { value: el, configurable: true });
}

function setWebkitFullscreen(el: Element | null): void {
  Object.defineProperty(document, "webkitFullscreenElement", { value: el, configurable: true });
}

beforeEach(() => {
  exitViewer();
  document.body.innerHTML = "";
  document.documentElement.style.overflow = "";
  h.primary = null;
  h.videos = [];
  S.viewerAutoEnabled = true;
  S.viewerAuto = "off";
  S.viewerBackdropVideo = false;
  S.keyboardEnabled = true;
  setFullscreen(null);
  setWebkitFullscreen(null);
});

afterEach(() => {
  vi.useRealTimers();
});

function installQualityBridge(
  options = [
    { id: "auto", label: "Auto", current: true },
    { id: "0", label: "360p" },
    { id: "1", label: "720p" },
  ],
) {
  const picks: string[] = [];
  document.addEventListener("vtp-quality-request", (e) => {
    const d = (e as CustomEvent).detail;
    document.dispatchEvent(
      new CustomEvent("vtp-quality-response", {
        detail: { requestId: d.requestId, options, current: "auto" },
      }),
    );
  });
  document.addEventListener("vtp-quality-set", (e) => {
    const d = (e as CustomEvent).detail;
    picks.push(d.qualityId);
    document.dispatchEvent(
      new CustomEvent("vtp-quality-response", {
        detail: {
          requestId: d.requestId,
          options: options.map((o) => ({ ...o, current: o.id === d.qualityId })),
          current: d.qualityId,
        },
      }),
    );
  });
  return picks;
}

function installDelayedQualityBridge() {
  document.addEventListener("vtp-quality-request", (e) => {
    const d = (e as CustomEvent).detail;
    document.dispatchEvent(
      new CustomEvent("vtp-quality-response", {
        detail: {
          requestId: d.requestId,
          options: [
            { id: "auto", label: "Auto", current: true },
            { id: "1", label: "720p" },
          ],
          current: "auto",
        },
      }),
    );
  });
  document.addEventListener("vtp-quality-set", (e) => {
    const d = (e as CustomEvent).detail;
    setTimeout(() => {
      document.dispatchEvent(
        new CustomEvent("vtp-quality-response", {
          detail: {
            requestId: d.requestId,
            options: [
              { id: "auto", label: "Auto" },
              { id: "1", label: "720p", current: true },
            ],
            current: "1",
          },
        }),
      );
    }, 20);
  });
}

function installBackdropMirror(v: HTMLVideoElement) {
  const stop = vi.fn();
  const stream = {
    getVideoTracks: () => [{}],
    getTracks: () => [{ stop }],
  } as unknown as MediaStream;
  Object.defineProperty(v, "captureStream", { value: () => stream, configurable: true });
  return { stop, stream };
}

describe("fmtTime", () => {
  it("formats sub-hour and over-hour times", async () => {
    expect(fmtTime(0)).toBe("0:00");
    expect(fmtTime(61)).toBe("1:01");
    expect(fmtTime(3661)).toBe("1:01:01");
    expect(fmtTime(Infinity)).toBe("0:00");
    expect(fmtTime(-5)).toBe("0:00");
  });
});

describe("toggleViewer — lifecycle", () => {
  it("ignores stale viewer state when the overlay is gone", () => {
    document.documentElement.setAttribute("data-vtp-viewer", "normal");
    expect(viewerFormat()).toBeNull();
  });

  it("can read viewer state left by another content-script instance", () => {
    const overlay = document.createElement("div");
    overlay.setAttribute("data-vtp-viewer-overlay", "");
    document.body.appendChild(overlay);
    document.documentElement.setAttribute("data-vtp-viewer", "normal");
    expect(viewerFormat()).toBe("normal");
  });

  it("does nothing without a video, or while the page is fullscreen", async () => {
    await openViewer("normal");
    expect(viewerFormat()).toBeNull();
    const { v } = makeVideo();
    h.primary = v;
    setFullscreen(document.body);
    await openViewer("normal");
    expect(viewerFormat()).toBeNull();
  });

  it("does nothing while the page is in prefixed fullscreen", async () => {
    const { v } = makeVideo();
    h.primary = v;
    setWebkitFullscreen(document.body);
    await openViewer("normal");
    expect(viewerFormat()).toBeNull();
  });

  it("does not open on protected video", async () => {
    const { v } = makeVideo();
    v.setAttribute("data-drm", "");
    h.primary = v;
    await openViewer("normal");
    expect(viewerFormat()).toBeNull();
    expect(overlayEl()).toBeNull();
  });

  it("does not open while viewer modes are disabled", async () => {
    const { v } = makeVideo();
    h.primary = v;
    S.viewerAutoEnabled = false;
    await openViewer("normal");
    expect(viewerFormat()).toBeNull();
    expect(overlayEl()).toBeNull();
  });

  it("adopts the video into the overlay and marks its old spot", async () => {
    const { wrap, v } = makeVideo();
    v.controls = true;
    h.primary = v;
    await openViewer("normal");
    expect(viewerFormat()).toBe("normal");
    expect(document.documentElement.getAttribute("data-vtp-viewer")).toBe("normal");
    expect(overlayEl()?.contains(v)).toBe(true);
    expect(v.controls).toBe(false); // our bar replaces any native/site controls
    // A comment holds the video's exact return spot.
    expect(Array.from(wrap.childNodes).some((n) => n.nodeType === Node.COMMENT_NODE)).toBe(true);
    expect(document.documentElement.style.overflow).toBe("hidden");
    // Normal format: a centred aspect box in px.
    expect((v.parentElement as HTMLElement).style.width).toMatch(/px$/);
    expect(barEl()).not.toBeNull();
  });

  it("mirrors through captureStream when available and leaves the source in place", async () => {
    const { wrap, v } = makeVideo();
    const mirrorPlay = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    v.controls = true;
    const { stop, stream } = installCapture(v);
    h.primary = v;
    await openViewer("normal");
    const mirror = overlayEl()!.querySelector("video") as HTMLVideoElement;
    expect(v.parentElement).toBe(wrap);
    expect(v.controls).toBe(true);
    expect(mirror).toBeInstanceOf(HTMLVideoElement);
    expect(mirror).not.toBe(v);
    expect(mirror.srcObject).toBe(stream);
    mirror.dispatchEvent(new MouseEvent("click"));
    expect(v.paused).toBe(false);
    exitViewer();
    expect(stop).toHaveBeenCalledOnce();
    expect(v.parentElement).toBe(wrap);
    expect(v.controls).toBe(true);
    mirrorPlay.mockRestore();
  });

  it("theater stretches the video to the whole overlay", async () => {
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("theater");
    expect(v.style.width).toBe("100%");
    expect(v.style.objectFit).toBe("contain");
  });

  it("restores adopted video styles on the next frame", async () => {
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("normal");
    const cssBefore = v.style.cssText;

    v.style.width = "12px";
    await flush();
    expect(v.style.cssText).not.toBe(cssBefore);

    await frame();
    expect(v.style.cssText).toBe(cssBefore);
  });

  it("switching formats keeps a single overlay", async () => {
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("normal");
    await openViewer("theater");
    expect(viewerFormat()).toBe("theater");
    expect(document.querySelectorAll("[data-vtp-viewer-overlay]").length).toBe(1);
  });

  it("interrupts in-flight format animations from the current surface frame", async () => {
    vi.useFakeTimers();
    const { v } = makeVideo();
    h.primary = v;
    const originalAnimate = Element.prototype.animate;
    const originalRect = Element.prototype.getBoundingClientRect;
    const cancels: ReturnType<typeof vi.fn>[] = [];
    const animate = vi.fn(function () {
      const cancel = vi.fn(function (this: Animation) {
        const done = this.oncancel;
        if (typeof done === "function")
          done.call(this, new Event("cancel") as AnimationPlaybackEvent);
      });
      cancels.push(cancel);
      return { onfinish: null, oncancel: null, cancel } as unknown as Animation;
    });
    Object.defineProperty(Element.prototype, "animate", { value: animate, configurable: true });
    Object.defineProperty(Element.prototype, "getBoundingClientRect", {
      value: function (this: Element) {
        if (
          this instanceof HTMLElement &&
          this.parentElement?.hasAttribute("data-vtp-viewer-overlay")
        )
          return {
            left: 80,
            top: 40,
            width: 480,
            height: 270,
            right: 560,
            bottom: 310,
          } as DOMRect;
        return originalRect.call(this);
      },
      configurable: true,
    });

    try {
      await openViewer("normal");
      await openViewer("theater");
      await openViewer("normal");
      await vi.advanceTimersByTimeAsync(600);
      await flush();
      expect(viewerFormat()).toBe("normal");
      expect(document.querySelectorAll("[data-vtp-viewer-overlay]").length).toBe(1);
      expect(cancels.some((cancel) => cancel.mock.calls.length > 0)).toBe(true);
    } finally {
      if (originalAnimate) {
        Object.defineProperty(Element.prototype, "animate", {
          value: originalAnimate,
          configurable: true,
        });
      } else {
        delete (Element.prototype as { animate?: Element["animate"] }).animate;
      }
      Object.defineProperty(Element.prototype, "getBoundingClientRect", {
        value: originalRect,
        configurable: true,
      });
      exitViewer();
      vi.useRealTimers();
    }
  });

  it("does not dispatch an extra layout event on the next animation frame", async () => {
    vi.useFakeTimers();
    const { v } = makeVideo();
    h.primary = v;
    const originalAnimate = Element.prototype.animate;
    Object.defineProperty(Element.prototype, "animate", {
      value: vi.fn(() => ({ onfinish: null, oncancel: null }) as unknown as Animation),
      configurable: true,
    });
    const onLayout = vi.fn();
    document.addEventListener(VIEWER_LAYOUT_EVENT, onLayout);

    try {
      toggleViewer("normal");
      await flush();
      const beforeFrame = onLayout.mock.calls.length;
      expect(beforeFrame).toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(16);
      expect(onLayout).toHaveBeenCalledTimes(beforeFrame);
    } finally {
      document.removeEventListener(VIEWER_LAYOUT_EVENT, onLayout);
      if (originalAnimate) {
        Object.defineProperty(Element.prototype, "animate", {
          value: originalAnimate,
          configurable: true,
        });
      } else {
        delete (Element.prototype as { animate?: Element["animate"] }).animate;
      }
      exitViewer();
      vi.useRealTimers();
    }
  });

  it("cancels a previous close's delayed layout pass when reopening", async () => {
    vi.useFakeTimers();
    const onLayout = vi.fn();
    document.addEventListener(VIEWER_LAYOUT_EVENT, onLayout);

    try {
      const first = makeVideo();
      h.primary = first.v;
      await openViewer("normal");
      exitViewer();
      await flush();

      const second = makeVideo();
      h.primary = second.v;
      await openViewer("normal");
      const afterReopen = onLayout.mock.calls.length;

      await vi.advanceTimersByTimeAsync(300);
      expect(onLayout).toHaveBeenCalledTimes(afterReopen);
    } finally {
      document.removeEventListener(VIEWER_LAYOUT_EVENT, onLayout);
      exitViewer();
      vi.useRealTimers();
    }
  });

  it("re-toggling the active format exits and restores the video exactly", async () => {
    const { wrap, v } = makeVideo();
    v.controls = true;
    const cssBefore = v.style.cssText;
    h.primary = v;
    await openViewer("theater");
    await openViewer("theater");
    expect(viewerFormat()).toBeNull();
    expect(v.parentElement).toBe(wrap);
    expect(v.style.cssText).toBe(cssBefore);
    expect(v.controls).toBe(true);
    expect(overlayEl()).toBeNull();
    expect(Array.from(wrap.childNodes).some((n) => n.nodeType === Node.COMMENT_NODE)).toBe(false);
    expect(document.documentElement.hasAttribute("data-vtp-viewer")).toBe(false);
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("does not reopen while the close animation is restoring the video", async () => {
    vi.useFakeTimers();
    const { wrap, v } = makeVideo();
    h.primary = v;
    await openViewer("normal");

    const originalAnimate = Element.prototype.animate;
    const animate = vi.fn(function () {
      const anim = { onfinish: null, oncancel: null } as unknown as Animation;
      setTimeout(() => {
        const done = anim.onfinish;
        if (typeof done === "function")
          done.call(anim, new Event("finish") as AnimationPlaybackEvent);
      }, 100);
      return anim;
    });
    Object.defineProperty(Element.prototype, "animate", { value: animate, configurable: true });

    exitViewer();
    expect(overlayEl()).not.toBeNull();
    toggleViewer("normal");
    expect(document.querySelectorAll("[data-vtp-viewer-overlay]").length).toBe(1);
    await vi.advanceTimersByTimeAsync(120);
    await flush();
    expect(overlayEl()).toBeNull();
    expect(v.parentElement).toBe(wrap);

    if (originalAnimate) {
      Object.defineProperty(Element.prototype, "animate", {
        value: originalAnimate,
        configurable: true,
      });
    } else {
      delete (Element.prototype as { animate?: Element["animate"] }).animate;
    }
  });

  it("still closes if a Web Animation never reports finish or cancel", async () => {
    vi.useFakeTimers();
    const { wrap, v } = makeVideo();
    h.primary = v;
    await openViewer("normal");

    const originalAnimate = Element.prototype.animate;
    const animate = vi.fn(
      () =>
        ({
          onfinish: null,
          oncancel: null,
        }) as unknown as Animation,
    );
    Object.defineProperty(Element.prototype, "animate", { value: animate, configurable: true });

    exitViewer();
    expect(overlayEl()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(900);
    await flush();
    expect(overlayEl()).toBeNull();
    expect(v.parentElement).toBe(wrap);

    if (originalAnimate) {
      Object.defineProperty(Element.prototype, "animate", {
        value: originalAnimate,
        configurable: true,
      });
    } else {
      delete (Element.prototype as { animate?: Element["animate"] }).animate;
    }
    vi.useRealTimers();
  });

  it("Escape exits; a press on the dim exits; a press on the video does not", async () => {
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("normal");
    v.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(viewerFormat()).toBe("normal");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(viewerFormat()).toBeNull();
    await openViewer("normal");
    overlayEl()!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(viewerFormat()).toBeNull();
  });

  it("exposes the viewer as a dialog and traps Tab into its controls", async () => {
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("normal");
    const overlay = overlayEl()!;

    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    expect(overlay.getAttribute("aria-label")).toBeTruthy();

    overlay.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }));
    expect(barButtons()[0].matches(":focus")).toBe(true);
  });

  it("lets the launcher top layer handle Escape before the viewer", async () => {
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("normal");
    document.documentElement.setAttribute(LAUNCHER_TOP_LAYER_ATTR, "");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(viewerFormat()).toBe("normal");

    document.documentElement.removeAttribute(LAUNCHER_TOP_LAYER_ATTR);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(viewerFormat()).toBeNull();
  });

  it("entering real fullscreen exits the viewer", async () => {
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("theater");
    setFullscreen(document.body);
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(viewerFormat()).toBeNull();
  });

  it("entering prefixed fullscreen exits the viewer", async () => {
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("theater");
    setWebkitFullscreen(document.body);
    document.dispatchEvent(new Event("webkitfullscreenchange"));
    expect(viewerFormat()).toBeNull();
  });

  it("owns its overlay nodes, nothing else", async () => {
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("normal");
    expect(ownsViewerNode(overlayEl())).toBe(true);
    expect(ownsViewerNode(barEl())).toBe(false); // shadow content isn't reachable, the host is
    expect(ownsViewerNode(overlayEl()!.children[1])).toBe(true);
    expect(ownsViewerNode(document.body)).toBe(false);
    expect(ownsViewerNode(null)).toBe(false);
  });
});

describe("control bar", () => {
  it("play button drives the media element and mirrors its state", async () => {
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("normal");
    const [play] = barButtons();
    expect(play.getAttribute("aria-pressed")).toBe("false");
    play.click();
    expect(v.paused).toBe(false);
    expect(play.getAttribute("aria-pressed")).toBe("true");
    play.click();
    expect(v.paused).toBe(true);
    expect(play.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking the video itself toggles playback", async () => {
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("normal");
    v.dispatchEvent(new MouseEvent("click"));
    expect(v.paused).toBe(false);
  });

  it("seek maps the slider onto currentTime and the time label follows", async () => {
    const { v } = makeVideo(100);
    h.primary = v;
    await openViewer("normal");
    const [seek] = barInputs();
    seek.value = "500";
    seek.dispatchEvent(new Event("input"));
    expect(v.currentTime).toBe(50);
    v.dispatchEvent(new Event("timeupdate"));
    expect(barTime()).toBe("0:50 / 1:40");
  });

  it("resumes seek syncing after a cancelled pointer seek", async () => {
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("normal");
    const [seek] = barInputs();

    v.currentTime = 50;
    v.dispatchEvent(new Event("timeupdate"));
    expect(seek.value).toBe("500");

    seek.dispatchEvent(new Event("pointerdown"));
    seek.value = "123";
    v.currentTime = 80;
    v.dispatchEvent(new Event("timeupdate"));
    expect(seek.value).toBe("123");

    seek.dispatchEvent(new Event("pointercancel"));
    v.dispatchEvent(new Event("timeupdate"));
    expect(seek.value).toBe("800");
  });

  it("arrow keys seek and adjust volume while the viewer is open", async () => {
    const { v } = makeVideo(100);
    h.primary = v;
    await openViewer("normal");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }));
    expect(v.currentTime).toBe(5);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, cancelable: true }),
    );
    expect(v.currentTime).toBe(0);

    v.volume = 0.5;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true }));
    expect(v.volume).toBeCloseTo(0.55);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, cancelable: true }),
    );
    expect(v.volume).toBeCloseTo(0.45);
    expect(v.muted).toBe(false);
  });

  it("keeps arrow controls active after the viewer seek slider has focus", async () => {
    const { v } = makeVideo(100);
    h.primary = v;
    await openViewer("normal");
    const [seek] = barInputs();

    seek.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );

    expect(v.currentTime).toBe(5);
  });

  it("leaves arrow keys alone when keyboard shortcuts are disabled", async () => {
    const { v } = makeVideo(100);
    h.primary = v;
    await openViewer("normal");
    S.keyboardEnabled = false;

    const e = new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true });
    document.dispatchEvent(e);

    expect(v.currentTime).toBe(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it("shows the control bar and spinner while the viewer video is buffering", async () => {
    const { v } = makeVideo(100);
    h.primary = v;
    await openViewer("normal");
    await v.play();
    barEl()!.style.visibility = "hidden";
    barEl()!.style.opacity = "0";

    v.dispatchEvent(new Event("waiting"));

    expect(barEl()!.style.visibility).toBe("visible");
    expect(barEl()!.style.opacity).toBe("1");
    expect(loadingEl()?.style.opacity).toBe("1");

    v.dispatchEvent(new Event("playing"));

    expect(loadingEl()?.style.opacity).toBe("0");
  });

  it("reloads seek markers when a SPA swaps the source on the same video", async () => {
    vi.stubGlobal("location", { hostname: "www.youtube.com" });
    try {
      let src = "blob:first";
      const { v } = makeVideo(100);
      Object.defineProperty(v, "currentSrc", { get: () => src, configurable: true });
      const bar = document.createElement("div");
      bar.className = "ytp-chapters-container";
      const first = document.createElement("div");
      const second = document.createElement("div");
      first.getBoundingClientRect = () => ({ width: 50 }) as DOMRect;
      second.getBoundingClientRect = () => ({ width: 50 }) as DOMRect;
      bar.append(first, second);
      document.body.append(bar);
      h.primary = v;

      await openViewer("normal");
      expect((chapterMarks()[0] as HTMLElement).style.width).toBe("50%");

      src = "blob:second";
      first.getBoundingClientRect = () => ({ width: 25 }) as DOMRect;
      second.getBoundingClientRect = () => ({ width: 75 }) as DOMRect;
      v.dispatchEvent(new Event("durationchange"));
      await flush();

      expect(chapterMarks()).toHaveLength(2);
      expect((chapterMarks()[0] as HTMLElement).style.width).toBe("25%");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("volume and mute drive the media element", async () => {
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("normal");
    const [, vol] = barInputs();
    vol.value = "40";
    vol.dispatchEvent(new Event("input"));
    expect(v.volume).toBeCloseTo(0.4);
    expect(v.muted).toBe(false);
    const [, mute] = barButtons();
    mute.click();
    expect(v.muted).toBe(true);
    expect(mute.getAttribute("aria-pressed")).toBe("true");
  });

  it.each(["normal", "theater"] as const)(
    "hides the cursor with the control bar while playing in %s mode",
    async (mode) => {
      vi.useFakeTimers();
      try {
        const { v } = makeVideo();
        h.primary = v;
        await openViewer(mode);
        v.play();
        overlayEl()?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        expect(overlayEl()?.style.cursor).toBe("");
        expect(viewerAnchorVideo()?.style.cursor).toBe("");
        await vi.advanceTimersByTimeAsync(2700);
        expect(overlayEl()?.style.cursor).toBe("none");
        expect(viewerAnchorVideo()?.style.cursor).toBe("none");
        overlayEl()?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        expect(overlayEl()?.style.cursor).toBe("");
        expect(viewerAnchorVideo()?.style.cursor).toBe("");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("stops updating hidden control-bar widgets until the bar is shown again", async () => {
    vi.useFakeTimers();
    try {
      const { v } = makeVideo(100);
      h.primary = v;
      await openViewer("normal");
      v.play();
      overlayEl()?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      expect(barEl()?.style.visibility).toBe("visible");
      expect(barTime()).toBe("0:00 / 1:40");

      await vi.advanceTimersByTimeAsync(2900);
      expect(barEl()?.style.visibility).toBe("hidden");

      v.currentTime = 40;
      v.dispatchEvent(new Event("timeupdate"));
      expect(barTime()).toBe("0:00 / 1:40");

      overlayEl()?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      expect(barEl()?.style.visibility).toBe("visible");
      expect(barTime()).toBe("0:40 / 1:40");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a live stream hides the seek bar and shows LIVE", async () => {
    const { v } = makeVideo(Infinity);
    h.primary = v;
    await openViewer("normal");
    const [seek] = barInputs();
    expect((seek.parentElement as HTMLElement).style.display).toBe("none");
    expect(seek.style.display).toBe("none");
    expect(barTime()).toBe("LIVE");
  });

  it("a finite-duration YouTube live stream still shows the live layout", async () => {
    document.documentElement.setAttribute("data-vtp-live", "1");
    const { v } = makeVideo(3922);
    h.primary = v;
    try {
      await openViewer("normal");
      const [seek] = barInputs();
      expect((seek.parentElement as HTMLElement).style.display).toBe("none");
      expect(seek.style.display).toBe("none");
      expect(barTime()).toBe("LIVE");
    } finally {
      document.documentElement.removeAttribute("data-vtp-live");
    }
  });

  it("a segmented finite-duration live stream keeps the live layout between segments", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    let duration = 7900;
    const { v } = makeVideo();
    Object.defineProperty(v, "duration", {
      configurable: true,
      get: () => duration,
    });
    h.primary = v;
    probeLive(v);
    for (let i = 1; i <= 3; i++) {
      vi.setSystemTime(1000 + i * 2000);
      duration += 2;
      probeLive(v);
      vi.setSystemTime(1500 + i * 2000);
      probeLive(v);
    }

    await openViewer("normal");

    const [seek] = barInputs();
    expect((seek.parentElement as HTMLElement).style.display).toBe("none");
    expect(seek.style.display).toBe("none");
    expect(barTime()).toBe("LIVE");
  });

  it("keeps the live layout when a mirrored MSE player drops its timeline on entry", async () => {
    let duration = Infinity;
    const { v } = makeVideo();
    Object.defineProperty(v, "duration", {
      configurable: true,
      get: () => duration,
    });
    const { stream, capture } = installCapture(v);
    capture.mockImplementation(() => {
      duration = Number.NaN;
      return stream;
    });
    h.primary = v;

    await openViewer("normal");

    const [seek] = barInputs();
    expect((seek.parentElement as HTMLElement).style.display).toBe("none");
    expect(seek.style.display).toBe("none");
    expect(barTime()).toBe("LIVE");
  });

  it("keeps a confirmed mirrored live stream live beyond the edge grace", async () => {
    let duration = Infinity;
    const { v } = makeVideo();
    v.currentTime = 9_970;
    Object.defineProperty(v, "duration", {
      configurable: true,
      get: () => duration,
    });
    const { stream, capture } = installCapture(v);
    capture.mockImplementation(() => {
      duration = 10_000;
      return stream;
    });
    h.primary = v;

    await openViewer("normal");

    const [seek] = barInputs();
    expect((seek.parentElement as HTMLElement).style.display).toBe("none");
    expect(seek.style.display).toBe("none");
    expect(barTime()).toBe("LIVE");
  });

  it("uses an explicit popup live verdict for a finite primary timeline", async () => {
    const { v } = makeVideo(10_000);
    v.currentTime = 9_970;
    h.primary = v;

    setViewerState("normal", true);
    await flush();

    const [seek] = barInputs();
    expect((seek.parentElement as HTMLElement).style.display).toBe("none");
    expect(seek.style.display).toBe("none");
    expect(barTime()).toBe("LIVE");
  });

  it("keeps an unbounded VK-style live stream live when it also exposes a seekable range", async () => {
    const { v } = makeVideo(Infinity);
    v.currentTime = 30_196;
    setSeekable(v, 0, 30_202);
    h.primary = v;

    setViewerState("normal", true);
    await flush();

    const [seek] = barInputs();
    expect((seek.parentElement as HTMLElement).style.display).toBe("none");
    expect(seek.style.display).toBe("none");
    expect(barTime()).toBe("LIVE");
  });

  it("uses the VK channel route for a finite player at the live edge", async () => {
    vi.stubGlobal("location", {
      hostname: "live.vkvideo.ru",
      pathname: "/4cb",
      search: "",
    });
    const { v } = makeVideo(10_000);
    v.currentTime = 9_994;
    h.primary = v;
    try {
      await openViewer("normal");

      const [seek] = barInputs();
      expect((seek.parentElement as HTMLElement).style.display).toBe("none");
      expect(seek.style.display).toBe("none");
      expect(barTime()).toBe("LIVE");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("switches a VK channel Viewer to LIVE when the player reaches the edge later", async () => {
    vi.stubGlobal("location", {
      hostname: "live.vkvideo.ru",
      pathname: "/4cb",
      search: "",
    });
    const { v } = makeVideo(10_000);
    v.currentTime = 9_900;
    h.primary = v;
    try {
      await openViewer("normal");
      expect(barTime()).toBe("2:45:00 / 2:46:40");

      v.currentTime = 9_994;
      v.dispatchEvent(new Event("timeupdate"));

      const [seek] = barInputs();
      expect((seek.parentElement as HTMLElement).style.display).toBe("none");
      expect(seek.style.display).toBe("none");
      expect(barTime()).toBe("LIVE");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps a VK recording seekable near the end instead of treating it as live", async () => {
    vi.stubGlobal("location", {
      hostname: "live.vkvideo.ru",
      pathname: "/have_contact/record/record-id",
      search: "",
    });
    const { v } = makeVideo(8_157);
    v.currentTime = 8_153;
    setSeekable(v, 0, 8_157);
    h.primary = v;
    try {
      setViewerState("normal", false);
      await flush();

      const [seek] = barInputs();
      expect((seek.parentElement as HTMLElement).style.display).toBe("flex");
      expect(seek.style.display).toBe("");
      expect(barTime()).toBe("2:15:53 / 2:15:57");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the confirmed page live state for a finite shadow-player video at the live edge", async () => {
    const { v } = makeVideo(10_000);
    v.currentTime = 9_994;
    h.primary = v;
    const { v: liveSibling } = makeVideo(Infinity);
    h.videos = [v, liveSibling];
    try {
      await openViewer("normal");

      const [seek] = barInputs();
      expect((seek.parentElement as HTMLElement).style.display).toBe("none");
      expect(seek.style.display).toBe("none");
      expect(barTime()).toBe("LIVE");
    } finally {
      liveSibling.remove();
      document.documentElement.setAttribute("data-vtp-live", "0");
      onStreamPage();
      document.documentElement.removeAttribute("data-vtp-live");
    }
  });

  it("keeps LIVE while the selected player has not exposed its timeline yet", async () => {
    const { v } = makeVideo(0);
    h.primary = v;
    const { v: liveSibling } = makeVideo(Infinity);
    h.videos = [v, liveSibling];
    try {
      await openViewer("normal");

      const [seek] = barInputs();
      expect((seek.parentElement as HTMLElement).style.display).toBe("none");
      expect(seek.style.display).toBe("none");
      expect(barTime()).toBe("LIVE");
    } finally {
      liveSibling.remove();
      document.documentElement.setAttribute("data-vtp-live", "0");
      onStreamPage();
      document.documentElement.removeAttribute("data-vtp-live");
    }
  });

  it("keeps a finite video seekable when it is away from a confirmed page live edge", async () => {
    const { v } = makeVideo(10_000);
    v.currentTime = 9_900;
    h.primary = v;
    const { v: liveSibling } = makeVideo(Infinity);
    h.videos = [v, liveSibling];
    try {
      await openViewer("normal");

      const [seek] = barInputs();
      expect((seek.parentElement as HTMLElement).style.display).toBe("flex");
      expect(seek.style.display).toBe("");
      expect(barTime()).toBe("2:45:00 / 2:46:40");
    } finally {
      liveSibling.remove();
      document.documentElement.setAttribute("data-vtp-live", "0");
      onStreamPage();
      document.documentElement.removeAttribute("data-vtp-live");
    }
  });

  it("a finite-duration live stream ignores YouTube's seekable archive window at the live edge", async () => {
    document.documentElement.setAttribute("data-vtp-live", "1");
    const { v } = makeVideo(3922);
    v.currentTime = 368;
    setSeekable(v, 0, 480);
    h.primary = v;
    try {
      await openViewer("normal");
      const [seek] = barInputs();
      expect((seek.parentElement as HTMLElement).style.display).toBe("none");
      expect(seek.style.display).toBe("none");
      expect(barTime()).toBe("LIVE");
    } finally {
      document.documentElement.removeAttribute("data-vtp-live");
    }
  });

  it("does not measure control children when switching to live layout", async () => {
    const { v } = makeVideo(100);
    h.primary = v;
    await openViewer("normal");
    Object.defineProperty(v, "duration", { value: Infinity, configurable: true });
    const originalRect = Element.prototype.getBoundingClientRect;
    const rect = vi.fn(function (this: Element) {
      if (barEl()?.contains(this)) throw new Error("measured control child");
      return originalRect.call(this);
    });
    Object.defineProperty(Element.prototype, "getBoundingClientRect", {
      value: rect,
      configurable: true,
    });
    try {
      v.dispatchEvent(new Event("durationchange"));
      expect(barEl()?.style.width).toBe("max-content");
    } finally {
      Object.defineProperty(Element.prototype, "getBoundingClientRect", {
        value: originalRect,
        configurable: true,
      });
    }
  });

  it("a live DVR stream uses the seekable window instead of the sentinel duration", async () => {
    const { v } = makeVideo(9_223_372_036);
    v.currentTime = 1_090;
    setSeekable(v, 1_000, 1_120);
    h.primary = v;
    await openViewer("normal");
    const [seek] = barInputs();
    expect((seek.parentElement as HTMLElement).style.display).toBe("flex");
    expect(Number(seek.value)).toBe(750);
    expect(barTime()).toBe("1:30 / 2:00");
    seek.value = "500";
    seek.dispatchEvent(new Event("input"));
    expect(v.currentTime).toBe(1_060);
  });

  it("the fit menu switches object-fit", async () => {
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("theater");
    const fwrap = qwraps()[1];
    const fit = fwrap.querySelector("button") as HTMLButtonElement;
    fit.click();
    const items = Array.from(fwrap.querySelectorAll(".qitem")) as HTMLButtonElement[];
    expect(items.map((i) => i.textContent)).toEqual(["Fit", "Crop", "Stretch"]);
    items[2].click();
    expect(v.style.objectFit).toBe("fill");
    // sticky within the tab — reset for the other tests
    fit.click();
    (fwrap.querySelectorAll(".qitem")[0] as HTMLButtonElement).click();
    expect(v.style.objectFit).toBe("contain");
  });

  it("can mirror the video under the normal viewer glass", async () => {
    const { v } = makeVideo();
    const { stop, stream } = installBackdropMirror(v);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    S.viewerBackdropVideo = true;
    h.primary = v;

    await openViewer("normal");

    expect(v.style.getPropertyValue("visibility")).toBe("hidden");
    expect(v.style.getPropertyPriority("visibility")).toBe("important");
    const bg = viewerBackdropVideo();
    expect(bg).toBeTruthy();
    expect(bg?.srcObject).toBe(stream);
    expect(bg?.style.filter).toBe("blur(28px) saturate(150%) brightness(0.72) contrast(1.16)");
    const backdrop = viewerBackdrop();
    expect(backdrop?.style.backdropFilter).toBe("");
    expect(backdrop?.style.background).toContain("radial-gradient");
    const surface = overlayEl()?.querySelector(
      "video:not([data-vtp-viewer-backdrop-video])",
    ) as HTMLVideoElement | null;
    expect(surface?.parentElement?.style.boxShadow).toContain("rgba(255,255,255,0.2)");
    expect(surface?.parentElement?.style.boxShadow).toContain("0 40px 120px rgba(0,0,0,0.74)");
    toggleViewer("theater");
    await flush();
    expect(viewerBackdropVideo()).toBeNull();
    exitViewer();
    expect(v.style.getPropertyValue("visibility")).toBe("");
    expect(stop).toHaveBeenCalled();
    play.mockRestore();
    pause.mockRestore();
  });

  it("restores the source video's previous inline visibility after mirror mode", async () => {
    const { v } = makeVideo();
    installBackdropMirror(v);
    v.style.setProperty("visibility", "collapse");
    h.primary = v;

    await openViewer("normal");
    expect(v.style.getPropertyValue("visibility")).toBe("hidden");

    exitViewer();
    expect(v.style.getPropertyValue("visibility")).toBe("collapse");
  });

  it("does not hide the page video when it is adopted into the viewer", async () => {
    const { v } = makeVideo();
    S.viewerBackdropVideo = false;
    h.primary = v;

    await openViewer("normal");

    expect(v.style.getPropertyValue("visibility")).toBe("");
    exitViewer();
  });

  it("uses a downscaled canvas for the mirrored background when canvas drawing is available", async () => {
    const { v } = makeVideo();
    installBackdropMirror(v);
    const drawImage = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    try {
      S.viewerBackdropVideo = true;
      h.primary = v;

      await openViewer("normal");

      const bg = viewerBackdropVisual() as HTMLCanvasElement | null;
      expect(bg?.tagName).toBe("CANVAS");
      expect(bg?.width).toBeLessThan(window.innerWidth);
      expect(bg?.height).toBeLessThan(window.innerHeight);
      expect(drawImage).toHaveBeenCalled();
      expect(viewerBackdrop()?.style.backdropFilter).toBe("");
      exitViewer();
    } finally {
      getContext.mockRestore();
    }
  });

  it("pauses the mirrored background canvas loop while the tab is hidden", async () => {
    vi.useFakeTimers();
    const { v } = makeVideo();
    installBackdropMirror(v);
    await v.play();
    const drawImage = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    try {
      S.viewerBackdropVideo = true;
      h.primary = v;

      await openViewer("normal");
      expect(drawImage).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(200);
      expect(drawImage).toHaveBeenCalledTimes(1);

      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(66);

      expect(drawImage).toHaveBeenCalledTimes(2);
      exitViewer();
    } finally {
      Object.defineProperty(document, "hidden", { value: false, configurable: true });
      getContext.mockRestore();
    }
  });

  it("keeps the glass blur when background video is disabled before opening", async () => {
    const { v } = makeVideo();
    installBackdropMirror(v);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    S.viewerBackdropVideo = false;
    h.primary = v;

    await openViewer("normal");

    expect(viewerBackdropVideo()).toBeNull();
    expect(viewerBackdrop()?.style.backdropFilter).toContain("blur(14px)");
    expect(viewerBackdrop()?.style.backdropFilter).not.toContain("url(");
    exitViewer();
    play.mockRestore();
    pause.mockRestore();
  });

  it("falls back to the glass blur when background video is enabled but mirroring is unavailable", async () => {
    const { v } = makeVideo();
    S.viewerBackdropVideo = true;
    h.primary = v;

    await openViewer("normal");

    expect(viewerBackdropVideo()).toBeNull();
    expect(viewerBackdrop()?.style.backdropFilter).toContain("blur(14px)");
    exitViewer();
  });

  it("switches background video on and off while the normal viewer is open", async () => {
    const { v } = makeVideo();
    const { stream } = installBackdropMirror(v);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    S.viewerBackdropVideo = false;
    h.primary = v;

    await openViewer("normal");
    expect(viewerBackdropVideo()).toBeNull();
    expect(viewerBackdrop()?.style.backdropFilter).toContain("blur(14px)");

    S.viewerBackdropVideo = true;
    refreshViewerBackdrop();

    expect(viewerBackdropVideo()?.srcObject).toBe(stream);
    expect(viewerBackdrop()?.style.backdropFilter).toBe("");

    S.viewerBackdropVideo = false;
    refreshViewerBackdrop();

    expect(viewerBackdropVideo()).toBeNull();
    expect(viewerBackdrop()?.style.backdropFilter).toContain("blur(14px)");
    exitViewer();
    play.mockRestore();
    pause.mockRestore();
  });

  it("restores the configured background mode when switching between normal and theater", async () => {
    const { v } = makeVideo();
    const { stream } = installBackdropMirror(v);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    S.viewerBackdropVideo = true;
    h.primary = v;

    await openViewer("normal");
    expect(viewerBackdropVideo()?.srcObject).toBe(stream);
    expect(viewerBackdrop()?.style.backdropFilter).toBe("");

    toggleViewer("theater");
    await flush();
    expect(viewerBackdropVideo()).toBeNull();
    expect(viewerBackdrop()?.style.backdropFilter).toBe("");

    toggleViewer("normal");
    await flush();
    expect(viewerBackdropVideo()?.srcObject).toBe(stream);
    expect(viewerBackdrop()?.style.backdropFilter).toBe("");
    exitViewer();
    play.mockRestore();
    pause.mockRestore();
  });

  it("animates the background video from the source frame slower than the viewer video", async () => {
    const { v } = makeVideo();
    v.getBoundingClientRect = () =>
      ({ left: 12, top: 34, width: 640, height: 360, right: 652, bottom: 394 }) as DOMRect;
    const stream = {
      getVideoTracks: () => [{}],
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;
    Object.defineProperty(v, "captureStream", { value: () => stream, configurable: true });
    S.viewerBackdropVideo = true;
    h.primary = v;
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const originalAnimate = Element.prototype.animate;
    const animate = vi.fn(function (
      this: Element,
      _keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      _options?: number | KeyframeAnimationOptions,
    ) {
      const anim = { onfinish: null, oncancel: null } as unknown as Animation;
      setTimeout(() => {
        const done = anim.onfinish;
        if (typeof done === "function")
          done.call(anim, new Event("finish") as AnimationPlaybackEvent);
      }, 0);
      return anim;
    });
    Object.defineProperty(Element.prototype, "animate", { value: animate, configurable: true });

    await openViewer("normal");

    const bgCall = animate.mock.calls.find((_, i) =>
      (animate.mock.contexts[i] as Element).hasAttribute("data-vtp-viewer-backdrop-video"),
    );
    expect(bgCall).toBeTruthy();
    expect((bgCall?.[0] as Keyframe[])[0]).toMatchObject({
      // +64 on each axis: the backdrop box is overscanned by BACKDROP_OVERSCAN
      // (64px) past the viewport so its own blur never vignettes at the screen
      // edge; the animation's translate compensates by that same fixed amount.
      transform: expect.stringContaining("translate(76px, 98px)"),
    });
    expect((bgCall?.[0] as Keyframe[])[1]).toMatchObject({
      transform: "none",
    });
    expect((bgCall?.[1] as KeyframeAnimationOptions).duration).toBeGreaterThan(420);
    await flush();
    if (originalAnimate) {
      Object.defineProperty(Element.prototype, "animate", {
        value: originalAnimate,
        configurable: true,
      });
    } else {
      delete (Element.prototype as { animate?: Element["animate"] }).animate;
    }
    exitViewer();
    await flush();
    play.mockRestore();
    pause.mockRestore();
  });

  it("shows quality options from the bridge and sends the selected level", async () => {
    const picks = installQualityBridge();
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("theater");
    await flush();
    const quality = qwraps()[0];
    expect(quality.style.display).toBe("block");
    const btn = quality.querySelector("button") as HTMLButtonElement;
    expect(btn.textContent).toContain("Auto");
    btn.click();
    await flush();
    const items = Array.from(quality.querySelectorAll(".qitem")) as HTMLButtonElement[];
    expect(items.map((i) => i.textContent)).toEqual(["Auto", "360p", "720p"]);
    items[2].click();
    await flush();
    expect(picks).toEqual(["1"]);
    expect(btn.textContent).toContain("720p");
  });

  it("exposes viewer menus to assistive tech and closes them with Escape", async () => {
    installQualityBridge();
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("theater");
    await flush();

    const quality = qwraps()[0];
    const qualityBtn = quality.querySelector("button") as HTMLButtonElement;
    expect(qualityBtn.getAttribute("aria-haspopup")).toBe("menu");
    expect(qualityBtn.getAttribute("aria-expanded")).toBe("false");
    qualityBtn.click();
    await flush();
    const qualityMenu = quality.querySelector(".qmenu") as HTMLElement;
    expect(qualityBtn.getAttribute("aria-expanded")).toBe("true");
    expect(qualityMenu.getAttribute("role")).toBe("menu");
    const qualityItems = Array.from(qualityMenu.querySelectorAll(".qitem")) as HTMLButtonElement[];
    expect(qualityItems[0]?.getAttribute("role")).toBe("menuitemradio");
    expect(shadowActive(qualityMenu)).toBe(qualityItems[0]);
    key(qualityItems[0], "ArrowDown");
    expect(shadowActive(qualityMenu)).toBe(qualityItems[1]);
    key(qualityItems[1], "Tab");
    expect(qualityBtn.getAttribute("aria-expanded")).toBe("false");

    qualityBtn.click();
    await flush();
    const reopenedQualityItems = Array.from(
      qualityMenu.querySelectorAll(".qitem"),
    ) as HTMLButtonElement[];
    key(reopenedQualityItems[1], "Escape");

    expect(viewerFormat()).toBe("theater");
    expect(qualityBtn.getAttribute("aria-expanded")).toBe("false");
    expect(shadowActive(qualityMenu)).toBe(qualityBtn);

    const fit = qwraps()[1];
    const fitBtn = fit.querySelector("button") as HTMLButtonElement;
    fitBtn.click();
    const fitMenu = fit.querySelector(".qmenu") as HTMLElement;
    expect(fitBtn.getAttribute("aria-expanded")).toBe("true");
    expect(fitMenu.getAttribute("role")).toBe("menu");
    const fitItems = Array.from(fitMenu.querySelectorAll(".qitem")) as HTMLButtonElement[];
    expect(fitItems[0]?.getAttribute("role")).toBe("menuitemradio");
    expect(shadowActive(fitMenu)).toBe(fitItems[0]);
    key(fitItems[0], "End");
    expect(shadowActive(fitMenu)).toBe(fitItems[2]);
  });

  it("ignores a quality response that arrives after the viewer closed", async () => {
    vi.useFakeTimers();
    installDelayedQualityBridge();
    const { v } = makeVideo();
    const { capture } = installCapture(v);
    h.primary = v;
    await openViewer("theater");
    await flush();

    const quality = qwraps()[0];
    const btn = quality.querySelector("button") as HTMLButtonElement;
    btn.click();
    await flush();
    const items = Array.from(quality.querySelectorAll(".qitem")) as HTMLButtonElement[];
    items[1].click();
    exitViewer();

    await vi.advanceTimersByTimeAsync(800);
    await flush();

    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("the format button switches and the close button exits", async () => {
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("normal");
    const buttons = barButtons();
    const fmtB = buttons.find((b) => b.title === "Pop out in theater format")!;
    const closeB = buttons.find((b) => b.title === "Close the pop-out viewer")!;
    fmtB.click();
    expect(viewerFormat()).toBe("theater");
    expect(fmtB.getAttribute("aria-pressed")).toBe("true");
    closeB.click();
    expect(viewerFormat()).toBeNull();
  });

  it("can anchor to a viewer left by another content-script instance", () => {
    document.documentElement.setAttribute("data-vtp-viewer", "normal");
    const overlay = document.createElement("div");
    overlay.setAttribute("data-vtp-viewer-overlay", "");
    const backdrop = document.createElement("video");
    backdrop.setAttribute("data-vtp-viewer-backdrop-video", "");
    const shell = document.createElement("div");
    shell.appendChild(document.createElement("video"));
    overlay.append(backdrop, shell);
    document.body.appendChild(overlay);
    expect(viewerFormat()).toBe("normal");
    expect(viewerAnchorVideo()).toBe(shell);
  });
});

describe("auto pop-out on play", () => {
  it("opens in the configured format when a video starts", async () => {
    S.viewerAuto = "theater";
    const { wrap, v } = makeVideo();
    installCapture(v);
    v.play();
    await flush();
    expect(viewerFormat()).toBe("theater");
    expect(v.parentElement).toBe(wrap);
    expect(overlayEl()?.querySelector("video")).not.toBe(v);
  });

  it("fires once per video — a manual close wins over the next play", async () => {
    S.viewerAuto = "normal";
    const { v } = makeVideo();
    installCapture(v);
    v.play();
    await flush();
    expect(viewerFormat()).toBe("normal");
    exitViewer(); // the user closed it
    v.pause();
    v.play();
    await flush();
    expect(viewerFormat()).toBeNull();
  });

  it("does not auto-adopt the page video when mirroring is unavailable", async () => {
    S.viewerAuto = "theater";
    const { wrap, v } = makeVideo();
    v.play();
    await flush();
    expect(viewerFormat()).toBeNull();
    expect(v.parentElement).toBe(wrap);
    expect(overlayEl()).toBeNull();
  });

  it("ignores play events from inside our own overlay", async () => {
    // The mirror/backdrop videos live inside the overlay and are started via
    // .play() during enter() — their own play event bubbles to this same
    // document-level listener. If fmt has already reverted to null by the
    // time that (async) event arrives — e.g. something else exited the
    // viewer first — nothing but this check stops it from being mistaken for
    // a fresh user video and re-opening the viewer off the overlay's own
    // element, repeating forever (reproduced live: 43 stacked overlays within
    // 500ms without this guard).
    S.viewerAuto = "normal";
    const overlay = document.createElement("div");
    overlay.setAttribute("data-vtp-viewer-overlay", "");
    const insideVideo = document.createElement("video");
    Object.defineProperty(insideVideo, "duration", { value: 10, configurable: true });
    overlay.appendChild(insideVideo);
    document.body.appendChild(overlay);
    insideVideo.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360 }) as DOMRect;
    insideVideo.dispatchEvent(new Event("play", { bubbles: true }));
    await flush();
    expect(viewerFormat()).toBeNull();
    expect(document.querySelectorAll("[data-vtp-viewer-overlay]").length).toBe(1); // still just the fixture's
  });

  it("ignores small players and stays off when disabled", async () => {
    S.viewerAuto = "theater";
    const { v } = makeVideo();
    v.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 160, height: 90, right: 160, bottom: 90 }) as DOMRect;
    v.play();
    await flush();
    expect(viewerFormat()).toBeNull();
    S.viewerAuto = "off";
    const { v: v2 } = makeVideo();
    v2.play();
    await flush();
    expect(viewerFormat()).toBeNull();
    S.viewerAuto = "theater";
    S.viewerAutoEnabled = false;
    const { v: v3 } = makeVideo();
    v3.play();
    await flush();
    expect(viewerFormat()).toBeNull();
  });
});

describe("guard", () => {
  it("exits when the site yanks the video back", async () => {
    vi.useFakeTimers();
    const { wrap, v } = makeVideo();
    h.primary = v;
    await openViewer("theater");
    wrap.appendChild(v); // the site's player reclaims its element
    await vi.advanceTimersByTimeAsync(600);
    expect(viewerFormat()).toBeNull();
    expect(overlayEl()).toBeNull();
  });

  it("restores the adopted video if the return marker was removed", async () => {
    const { wrap, v } = makeVideo();
    h.primary = v;
    await openViewer("theater");
    Array.from(wrap.childNodes)
      .filter((n) => n.nodeType === Node.COMMENT_NODE)
      .forEach((n) => n.remove());
    exitViewer();
    await flush();
    expect(overlayEl()).toBeNull();
    expect(v.parentElement).toBe(wrap);
    expect(v.isConnected).toBe(true);
  });

  it("exits when the video's home is torn down (layer closed)", async () => {
    vi.useFakeTimers();
    const { wrap, v } = makeVideo();
    h.primary = v;
    await openViewer("theater");
    wrap.remove(); // the marker comment goes with it
    await vi.advanceTimersByTimeAsync(600);
    expect(viewerFormat()).toBeNull();
    // Nowhere to return to — the orphaned video left with the overlay.
    expect(overlayEl()).toBeNull();
    expect(v.isConnected).toBe(false);
  });
});
