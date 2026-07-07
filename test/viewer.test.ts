// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The pop-out viewer either mirrors or adopts the page's <video> into its own
// overlay with our control bar. Mock only the video picker and i18n; the overlay,
// bar and media wiring run against real jsdom DOM.
const h = vi.hoisted(() => ({ primary: null as unknown }));
vi.mock("../src/content/videos.js", () => ({
  primaryVideo: () => h.primary,
  isDrmVideo: (v: HTMLVideoElement | null | undefined) => !!v && v.hasAttribute("data-drm"),
}));
vi.mock("../src/content/platform/i18n.js", () => ({ i18n: () => "" }));

import { S } from "../src/content/state.js";
import {
  toggleViewer,
  exitViewer,
  viewerFormat,
  viewerAnchorVideo,
  ownsViewerNode,
  refreshViewerBackdrop,
  fmtTime,
} from "../src/content/viewer.js";

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
} {
  const stop = vi.fn();
  const stream = {
    getVideoTracks: () => [{}],
    getTracks: () => [{ stop }],
  } as unknown as MediaStream;
  Object.defineProperty(v, "captureStream", { value: () => stream, configurable: true });
  return { stop, stream };
}

// open through a microtask flush so the DOM settles before assertions.
async function openViewer(f: "normal" | "theater") {
  toggleViewer(f);
  await flush();
}
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

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
const viewerBackdrop = () => overlayEl()?.querySelector("div") as HTMLElement | null;
const viewerBackdropVideo = () =>
  overlayEl()?.querySelector("[data-vtp-viewer-backdrop-video]") as HTMLVideoElement | null;

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
  S.viewerAutoEnabled = true;
  S.viewerAuto = "off";
  S.viewerBackdropVideo = false;
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

  it("switching formats keeps a single overlay", async () => {
    const { v } = makeVideo();
    h.primary = v;
    await openViewer("normal");
    await openViewer("theater");
    expect(viewerFormat()).toBe("theater");
    expect(document.querySelectorAll("[data-vtp-viewer-overlay]").length).toBe(1);
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
    document.dispatchEvent(new Event("fullscreenchange"));
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

  it("a live stream hides the seek bar and shows LIVE", async () => {
    const { v } = makeVideo(Infinity);
    h.primary = v;
    await openViewer("normal");
    const [seek] = barInputs();
    expect((seek.parentElement as HTMLElement).style.display).toBe("none");
    expect(seek.style.display).toBe("none");
    expect(barTime()).toBe("LIVE");
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

    const bg = viewerBackdropVideo();
    expect(bg).toBeTruthy();
    expect(bg?.srcObject).toBe(stream);
    expect(bg?.style.filter).toContain("blur");
    const backdrop = viewerBackdrop();
    expect(backdrop?.style.backdropFilter).toBe("");
    toggleViewer("theater");
    await flush();
    expect(viewerBackdropVideo()).toBeNull();
    exitViewer();
    expect(stop).toHaveBeenCalled();
    play.mockRestore();
    pause.mockRestore();
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
      // +48 on each axis: the backdrop box is overscanned by BACKDROP_OVERSCAN
      // (48px) past the viewport so its own blur never vignettes at the screen
      // edge; the animation's translate compensates by that same fixed amount.
      transform: expect.stringContaining("translate(60px, 82px)"),
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
