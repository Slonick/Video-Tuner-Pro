// Pop-out video viewer. It prefers a non-invasive mirror: capture the page's
// <video> into our own overlay video, while the original player stays in its
// DOM. That avoids most framework/player fights during quality changes and SPA
// layer swaps. If captureStream() is unavailable, it falls back to adopting the
// bare <video> and restoring it on exit.
import { S } from "./state.js";
import { isDrmVideo, primaryVideo } from "./videos.js";
import {
  isYouTube,
  youTubeVideoId,
  readYouTubeChapters,
  fetchSponsorSegments,
  hasNativeSponsorBlock,
  SPONSOR_COLORS,
} from "./markers.js";
import { api } from "./platform/browser.js";
import { addFullscreenChangeListener, currentFullscreenElement } from "./platform/fullscreen.js";
import { i18n } from "./platform/i18n.js";
import { ensureGlassFilter, GLASS_REFRACTION } from "../shared/glass.js";
import { isLive } from "./live/detection.js";
import { normalizeViewerFit, type ViewerFitMode } from "./core/resolve.js";
import { showBadgeNotice } from "./badge/overlay.js";

export type ViewerFormat = "normal" | "theater";
export const VIEWER_LAYOUT_EVENT = "vtp-viewer-layout";

const ATTR = "data-vtp-viewer"; // on <html>: "normal" | "theater" — state marker
const OVERLAY = "data-vtp-viewer-overlay";
const ADOPTED_VIDEO = "data-vtp-viewer-adopted-video";
const FRACTION = 0.86; // the normal box's share of the viewport
const BAR_HIDE_MS = 2600; // control-bar auto-hide, mirrors the launcher FAB
const CLOSE_EVENT = "vtp-viewer-close";
const VIEWER_ANIM_MS = 420;
const VIEWER_BACKDROP_VIDEO_ANIM_MS = 680;
const BACKDROP_CANVAS_SCALE = 0.125;
const BACKDROP_CANVAS_MS = 66;
// A CSS/backdrop-filter blur can't invent pixels past its own box, so an element
// blurred exactly at the viewport edge fades toward whatever's behind it there —
// a visible vignette right at the screen border. Overscanning the box (then
// letting the overlay's overflow:hidden crop it back to the viewport) hides that
// fade off-screen instead. Comfortably more than 2× the largest blur radius used
// (14/22px) so the fade-out never reaches the visible edge.
const BACKDROP_OVERSCAN = 48;

// The overlay sits under the speed badge (…646) and the launcher FAB with its
// radial menu (…647), so both remain usable over the popped-out video.
const Z_OVERLAY = "2147483643";

let fmt: ViewerFormat | null = null;
let video: HTMLVideoElement | null = null; // the page media element we control
let surfaceVideo: HTMLVideoElement | null = null; // the overlay video we render/style
let overlay: HTMLDivElement | null = null;
let backdropEl: HTMLDivElement | null = null;
let backdropVideo: HTMLVideoElement | HTMLCanvasElement | null = null;
let backdropCanvasTimer: ReturnType<typeof setTimeout> | null = null;
let surfaceShell: HTMLDivElement | null = null;
let holder: Comment | null = null; // marks the video's original DOM spot
let sourceParent: Node | null = null;
let sourceNextSibling: Node | null = null;
let prevCss = ""; // the video's inline style before we took over
let prevSourceVisibility = "";
let prevSourceVisibilityPriority = "";
let prevControls = false;
let prevOverflow = ""; // <html>'s inline overflow (scroll lock restore)
let hooked = false;
let guardTimer: ReturnType<typeof setInterval> | null = null;

// Control bar (in a shadow root so page CSS can't touch it).
let bar: HTMLDivElement | null = null;
let playBtn: HTMLButtonElement | null = null;
let muteBtn: HTMLButtonElement | null = null;
let fmtBtn: HTMLButtonElement | null = null;
let seekEl: HTMLInputElement | null = null;
let seekWrapEl: HTMLSpanElement | null = null;
let volEl: HTMLInputElement | null = null;
let timeEl: HTMLSpanElement | null = null;
let barTimer: ReturnType<typeof setTimeout> | undefined;
let barVisibilityTimer: ReturnType<typeof setTimeout> | undefined;
let seeking = false; // mid-drag on the seek slider — don't fight the user
let media: AbortController | null = null; // per-session media/UI listeners
let marksEl: HTMLDivElement | null = null; // chapter ticks + sponsor bands layer
let markerTipEl: HTMLDivElement | null = null;
let marksLoaded = false; // duration arrived and the layer was populated
let marksSourceKey = "";
let markerRanges: MarkerRange[] = [];
let activeMarker: MarkerRange | null = null;
// Chapters are read from the site player's own progress bar BEFORE the video
// is adopted — YouTube tears its player UI down once the element leaves.
let pendingChapters: { start: number; title: string }[] = [];
// Sites (YouTube) keep rewriting their video's inline style, clobbering ours —
// a plain style write drops even !important declarations. Re-assert on sight.
let styleGuard: MutationObserver | null = null;
let desiredCss = "";
let desiredShellCss = "";
let normalBox: { w: number; h: number; vw: number; vh: number; fromMetadata: boolean } | null =
  null;
let surfaceTransition: Animation | null = null;
let surfaceTransitionTimer: ReturnType<typeof setTimeout> | null = null;
let surfaceTransitionToken = 0;
let mirrored = false;
let mirrorStream: MediaStream | null = null;
let sourceRect: DOMRect | null = null;
let layoutPaused = false;
let exiting = false;

let fitMenu: HTMLDivElement | null = null;
let qualityWrap: HTMLSpanElement | null = null;
let qualityBtn: HTMLButtonElement | null = null;
let qualityLabelEl: HTMLSpanElement | null = null;
let qualityMenu: HTMLDivElement | null = null;
let qualityReq = 0;
let qualityVideoId = "";
let pendingQuality: QualityOption | null = null;
let pendingQualityUntil = 0;
let lastTimelineKind: Timeline["kind"] | null = null;

interface QualityOption {
  id: string;
  label: string;
  current?: boolean;
}
interface QualityState {
  options: QualityOption[];
  current: string;
}
interface MarkerRange {
  start: number;
  end: number;
  label: string;
  el: HTMLElement;
}
const QUALITY_REQ_ATTR = "data-vtp-quality-request";
const QUALITY_VIDEO_ATTR = "data-vtp-quality-video";
const QUALITY_PICK_ATTR = "data-vtp-quality-pick";
const QUALITY_RESP_ATTR = "data-vtp-quality-response";

// A previous instance (extension reload re-injects us) may have left its
// overlay up — drop it. (Its adopted video can't be returned — the old
// instance lost the spot; the site's player recreates one on demand.)
try {
  document.querySelectorAll(`[${OVERLAY}]`).forEach((n) => n.remove());
  document.documentElement.removeAttribute(ATTR);
} catch (e) {
  /* ignore */
}

document.addEventListener(CLOSE_EVENT, () => exitViewer());
document.addEventListener(
  "keydown",
  (e) => {
    if (!fmt) return;
    const target = ((typeof e.composedPath === "function" && e.composedPath()[0]) ||
      e.target) as HTMLElement | null;
    if (
      target &&
      ((target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range") ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    )
      return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      exitViewer();
      return;
    }
    if (!video) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const timeline = mediaTimeline(video);
      if (timeline.kind !== "vod" && timeline.kind !== "dvr") return;
      const step = e.shiftKey ? 10 : 5;
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next = Math.min(
        timeline.start + timeline.len,
        Math.max(timeline.start, video.currentTime + dir * step),
      );
      const delta = next - video.currentTime;
      if (Math.abs(delta) < 0.001) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      video.currentTime = next;
      syncTime();
      showBadgeNotice(`${delta > 0 ? "+" : "-"}${fmtTime(Math.abs(delta))}`);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const step = e.shiftKey ? 0.1 : 0.05;
      const dir = e.key === "ArrowUp" ? 1 : -1;
      const next = Math.min(1, Math.max(0, video.volume + dir * step));
      if (Math.abs(next - video.volume) < 0.001 && video.muted === (next === 0)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      video.volume = next;
      video.muted = next === 0;
      syncVolume();
      showBadgeNotice(video.muted ? "Muted" : `Volume ${Math.round(next * 100)}%`);
    }
  },
  true,
);

export function viewerFormat(): ViewerFormat | null {
  const dom = document.documentElement.getAttribute(ATTR);
  if (fmt) return fmt;
  if ((dom === "normal" || dom === "theater") && document.querySelector(`[${OVERLAY}]`)) return dom;
  return null;
}

export function setViewerState(format: ViewerFormat | "off"): void {
  if (format === "off") {
    if (fmt) exitViewer();
    else document.dispatchEvent(new Event(CLOSE_EVENT));
    return;
  }
  if (!S.viewerAutoEnabled) return;
  if (viewerFormat() === format) return;
  if (fmt) setFormat(format);
  else {
    document.dispatchEvent(new Event(CLOSE_EVENT));
    void enter(format);
  }
}

export function viewerAnchorVideo(): HTMLElement | null {
  if (!viewerFormat()) return null;
  if (surfaceShell?.isConnected) return surfaceShell;
  if (surfaceVideo?.isConnected) return surfaceVideo;
  const overlayEl = document.querySelector(`[${OVERLAY}]`);
  const fallback = Array.from(overlayEl?.children ?? []).find(
    (el) =>
      el instanceof HTMLElement && el.querySelector("video:not([data-vtp-viewer-backdrop-video])"),
  );
  return fallback instanceof HTMLElement ? fallback : null;
}

export function viewerLayoutPaused(): boolean {
  return layoutPaused;
}

function notifyViewerState(): void {
  try {
    void api.runtime.sendMessage({ action: "viewerStateChanged", mode: fmt ?? "off" });
  } catch (e) {}
}

function dispatchViewerLayout(): void {
  document.dispatchEvent(new Event(VIEWER_LAYOUT_EVENT));
}

function notifyViewerLayout(): void {
  if (layoutPaused) return;
  dispatchViewerLayout();
}

function applyOverlayBackdrop(): void {
  if (!backdropEl || !fmt) return;
  if (fmt !== "normal" || !S.viewerBackdropVideo || !mirrorStream) removeBackdropVideo();
  backdropEl.style.setProperty("--glass-opacity", String(S.glassOpacity));
  if (fmt === "theater") {
    backdropEl.style.background = "rgba(0, 0, 0, 0.92)";
    backdropEl.style.removeProperty("-webkit-backdrop-filter");
    backdropEl.style.backdropFilter = "";
  } else {
    backdropEl.style.background = "rgb(28 28 32 / calc(0.24 * var(--glass-opacity,1)))";
    if (S.viewerBackdropVideo && mirrorStream) {
      backdropEl.style.removeProperty("-webkit-backdrop-filter");
      backdropEl.style.backdropFilter = "";
    } else {
      backdropEl.style.setProperty(
        "-webkit-backdrop-filter",
        "blur(14px) saturate(180%) brightness(1.04)",
      );
      backdropEl.style.backdropFilter = "blur(14px) saturate(180%) brightness(1.04)";
    }
  }
  syncViewerBackdropVideo();
}

export function refreshViewerBackdrop(): void {
  applyOverlayBackdrop();
}

function removeBackdropVideo(): void {
  if (backdropCanvasTimer != null) {
    clearTimeout(backdropCanvasTimer);
    backdropCanvasTimer = null;
  }
  if (backdropVideo instanceof HTMLVideoElement) {
    backdropVideo.pause();
    backdropVideo.srcObject = null;
  }
  backdropVideo?.remove();
  backdropVideo = null;
}

function styleBackdropVideo(el: HTMLElement): void {
  Object.assign(el.style, {
    position: "absolute",
    // Replaced media elements keep their intrinsic size unless explicitly sized.
    top: `-${BACKDROP_OVERSCAN}px`,
    left: `-${BACKDROP_OVERSCAN}px`,
    width: `calc(100% + ${BACKDROP_OVERSCAN * 2}px)`,
    height: `calc(100% + ${BACKDROP_OVERSCAN * 2}px)`,
    transform: "none",
    transformOrigin: "0 0",
    borderRadius: "0",
    objectFit: "cover",
    filter: "blur(22px) saturate(135%) brightness(0.9)",
    opacity: backdropEl?.style.opacity === "0" ? "0" : "1",
    pointerEvents: "none",
    willChange: "transform, opacity",
    zIndex: "0",
  } as Partial<CSSStyleDeclaration>);
}

function backdropCanvasSize(): { w: number; h: number } {
  return {
    w: Math.max(1, Math.ceil((window.innerWidth + BACKDROP_OVERSCAN * 2) * BACKDROP_CANVAS_SCALE)),
    h: Math.max(1, Math.ceil((window.innerHeight + BACKDROP_OVERSCAN * 2) * BACKDROP_CANVAS_SCALE)),
  };
}

function drawBackdropCanvas(): boolean {
  if (!(backdropVideo instanceof HTMLCanvasElement)) return false;
  const source = surfaceVideo ?? video;
  if (!source) return false;
  const ctx = backdropVideo.getContext("2d");
  if (!ctx) return false;
  const { w, h } = backdropCanvasSize();
  if (backdropVideo.width !== w) backdropVideo.width = w;
  if (backdropVideo.height !== h) backdropVideo.height = h;
  try {
    ctx.drawImage(source, 0, 0, w, h);
    return true;
  } catch (e) {
    return false;
  }
}

function scheduleBackdropCanvas(): void {
  if (!(backdropVideo instanceof HTMLCanvasElement) || backdropCanvasTimer != null) return;
  if (document.hidden) return;
  if (video?.paused) return;
  backdropCanvasTimer = setTimeout(() => {
    backdropCanvasTimer = null;
    if (!drawBackdropCanvas()) {
      createBackdropVideoFallback();
      return;
    }
    scheduleBackdropCanvas();
  }, BACKDROP_CANVAS_MS);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (backdropCanvasTimer != null) {
      clearTimeout(backdropCanvasTimer);
      backdropCanvasTimer = null;
    }
  } else {
    scheduleBackdropCanvas();
  }
});

function createBackdropVideoFallback(): HTMLVideoElement | null {
  if (!overlay || !backdropEl || !mirrorStream) return null;
  const videoEl = document.createElement("video");
  videoEl.srcObject = mirrorStream;
  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.autoplay = true;
  videoEl.controls = false;
  videoEl.setAttribute("aria-hidden", "true");
  videoEl.setAttribute("data-vtp-viewer-backdrop-video", "");
  styleBackdropVideo(videoEl);
  backdropVideo?.remove();
  backdropVideo = videoEl;
  overlay.insertBefore(videoEl, backdropEl);
  videoEl.play()?.catch(() => {});
  return videoEl;
}

export function syncViewerBackdropVideo(): void {
  if (!overlay || !backdropEl || fmt !== "normal" || !S.viewerBackdropVideo || !mirrorStream) {
    removeBackdropVideo();
    return;
  }
  if (!backdropVideo) {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.setAttribute("data-vtp-viewer-backdrop-video", "");
    styleBackdropVideo(canvas);
    backdropVideo = canvas;
    if (!drawBackdropCanvas()) {
      createBackdropVideoFallback();
    } else {
      overlay.insertBefore(canvas, backdropEl);
      scheduleBackdropCanvas();
    }
  } else if (backdropVideo instanceof HTMLCanvasElement) {
    if (!drawBackdropCanvas()) createBackdropVideoFallback();
    else scheduleBackdropCanvas();
  } else {
    backdropVideo.play()?.catch(() => {});
  }
}

function canAnimate(el: Element | null): el is Element & { animate: Element["animate"] } {
  return !!el && typeof el.animate === "function";
}

function visibleRect(r: DOMRect | null): r is DOMRect {
  return !!r && r.width > 1 && r.height > 1;
}

function animateBackdropLayer(
  el: HTMLElement | null,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  finalOpacity: string,
): Animation | null {
  if (!el) return null;
  if (!canAnimate(el)) {
    (el as HTMLElement).style.opacity = finalOpacity;
    return null;
  }
  const anim = el.animate(keyframes, options);
  anim.onfinish = () => {
    if (el.isConnected) el.style.opacity = finalOpacity;
  };
  return anim;
}

function backdropVideoTransformFrame(r: DOMRect, opacity: number): Keyframe {
  // The box is overscanned by BACKDROP_OVERSCAN on every side (see its inset), so
  // scale/translate must target that larger box, not the viewport itself, for the
  // transform to still land exactly on `r`. transform-origin ("0 0") is the box's
  // own top-left, which already sits BACKDROP_OVERSCAN above/left of the viewport
  // — scale leaves that origin point fixed, so translate only needs to shift it by
  // the plain (unscaled) overscan, not overscan*scale.
  const vw = Math.max(window.innerWidth, 1) + BACKDROP_OVERSCAN * 2;
  const vh = Math.max(window.innerHeight, 1) + BACKDROP_OVERSCAN * 2;
  const sx = r.width / vw;
  const sy = r.height / vh;
  return {
    transform: `translate(${r.left + BACKDROP_OVERSCAN}px, ${r.top + BACKDROP_OVERSCAN}px) scale(${sx}, ${sy})`,
    borderRadius: "0px",
    opacity,
  };
}

function viewportFrame(opacity: number): Keyframe {
  return {
    transform: "none",
    borderRadius: "0px",
    opacity,
  };
}

function setBackdropVideoViewport(opacity = "1"): void {
  if (!backdropVideo) return;
  Object.assign(backdropVideo.style, {
    transform: "none",
    borderRadius: "0",
    opacity,
  } as Partial<CSSStyleDeclaration>);
}

function animateBackdropVideoIn(first: DOMRect | null): Animation | null {
  if (!canAnimate(backdropVideo) || !visibleRect(first)) {
    setBackdropVideoViewport("1");
    return null;
  }
  backdropVideo.style.transform = backdropVideoTransformFrame(first, 0).transform as string;
  backdropVideo.style.opacity = "0";
  backdropVideo.getBoundingClientRect();
  const anim = backdropVideo.animate([backdropVideoTransformFrame(first, 0), viewportFrame(1)], {
    duration: VIEWER_BACKDROP_VIDEO_ANIM_MS,
    easing: "cubic-bezier(0.2, 0, 0, 1)",
    fill: "forwards",
  });
  anim.onfinish = () => setBackdropVideoViewport("1");
  anim.oncancel = () => setBackdropVideoViewport("1");
  return anim;
}

function animateBackdropVideoOut(target: DOMRect | null): Animation | null {
  if (!canAnimate(backdropVideo)) return null;
  if (!visibleRect(target)) {
    return backdropVideo.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: VIEWER_BACKDROP_VIDEO_ANIM_MS,
      easing: "cubic-bezier(0.4, 0, 1, 1)",
      fill: "forwards",
    });
  }
  setBackdropVideoViewport("1");
  backdropVideo.getBoundingClientRect();
  const anim = backdropVideo.animate([viewportFrame(1), backdropVideoTransformFrame(target, 0)], {
    duration: VIEWER_BACKDROP_VIDEO_ANIM_MS,
    easing: "cubic-bezier(0.4, 0, 1, 1)",
    fill: "forwards",
  });
  anim.onfinish = () => {
    if (backdropVideo) backdropVideo.style.opacity = "0";
  };
  return anim;
}

function animateBackdropIn(delay = 190): void {
  const keyframes: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
  const options: KeyframeAnimationOptions = {
    delay,
    duration: VIEWER_ANIM_MS - Math.min(delay, VIEWER_ANIM_MS - 80),
    easing: "cubic-bezier(0.2, 0, 0, 1)",
    fill: "forwards",
  };
  backdropEl?.style.setProperty("opacity", "0");
  animateBackdropLayer(backdropEl, keyframes, options, "1");
  animateBackdropVideoIn(sourceRect);
}

function animateBackdropOut(target: DOMRect | null): Animation | null {
  const keyframes: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];
  const options: KeyframeAnimationOptions = {
    duration: VIEWER_ANIM_MS,
    easing: "cubic-bezier(0.4, 0, 1, 1)",
    fill: "forwards",
  };
  const bgAnim = animateBackdropVideoOut(target);
  return animateBackdropLayer(backdropEl, keyframes, options, "0") ?? bgAnim;
}

function rectFrame(r: DOMRect, radius = "0px"): Keyframe {
  return {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    transform: "none",
    borderRadius: radius,
  };
}

interface SurfaceFrame {
  rect: DOMRect;
  radius: string;
}

function frameFromRect(rect: DOMRect | null, radius = "0px"): SurfaceFrame | null {
  return visibleRect(rect) ? { rect, radius } : null;
}

function currentSurfaceFrame(): SurfaceFrame | null {
  const shell = surfaceShell;
  if (!shell) return null;
  const rect = shell.getBoundingClientRect();
  if (!visibleRect(rect)) return null;
  return {
    rect,
    radius: getComputedStyle(shell).borderRadius || shell.style.borderRadius || "0px",
  };
}

function cancelSurfaceTransition(): void {
  surfaceTransitionToken++;
  if (surfaceTransitionTimer != null) {
    clearTimeout(surfaceTransitionTimer);
    surfaceTransitionTimer = null;
  }
  const anim = surfaceTransition;
  surfaceTransition = null;
  if (!anim) return;
  anim.onfinish = null;
  anim.oncancel = null;
  try {
    anim.cancel();
  } catch (e) {}
}

function interruptSurfaceTransition(): SurfaceFrame | null {
  const frame = currentSurfaceFrame();
  cancelSurfaceTransition();
  return frame;
}

function animateSurfaceFrom(first: SurfaceFrame | null): Animation | null {
  const shell = surfaceShell;
  if (!canAnimate(shell) || !first) return null;
  const last = shell.getBoundingClientRect();
  if (!visibleRect(last)) return null;
  const finalCss = desiredShellCss;
  const finalRadius = shell.style.borderRadius || "0px";
  const token = ++surfaceTransitionToken;
  layoutPaused = true;
  if (bar) {
    bar.style.opacity = "0";
    bar.style.pointerEvents = "none";
  }
  Object.assign(shell.style, {
    left: `${first.rect.left}px`,
    top: `${first.rect.top}px`,
    width: `${first.rect.width}px`,
    height: `${first.rect.height}px`,
    transform: "none",
    borderRadius: first.radius,
  } as Partial<CSSStyleDeclaration>);
  shell.getBoundingClientRect();
  const anim = shell.animate([rectFrame(first.rect, first.radius), rectFrame(last, finalRadius)], {
    duration: VIEWER_ANIM_MS,
    easing: "cubic-bezier(0.2, 0, 0, 1)",
  });
  surfaceTransition = anim;
  let settled = false;
  const settle = () => {
    if (settled || surfaceShell !== shell || surfaceTransitionToken !== token) return;
    settled = true;
    if (surfaceTransitionTimer != null) {
      clearTimeout(surfaceTransitionTimer);
      surfaceTransitionTimer = null;
    }
    if (surfaceTransition === anim) surfaceTransition = null;
    shell.style.cssText = finalCss;
    layoutPaused = false;
    layoutBar();
    notifyViewerLayout();
    showBar();
  };
  anim.onfinish = settle;
  anim.oncancel = () => {
    if (surfaceTransition === anim) surfaceTransition = null;
  };
  surfaceTransitionTimer = window.setTimeout(settle, VIEWER_ANIM_MS + 80);
  return anim;
}

function animateSurfaceTo(target: DOMRect | null): Animation | null {
  const shell = surfaceShell;
  if (!canAnimate(shell)) return null;
  const firstFrame = interruptSurfaceTransition();
  const first = firstFrame?.rect ?? shell.getBoundingClientRect();
  if (!visibleRect(first) || !visibleRect(target)) {
    return shell.animate(
      [
        { opacity: 1, transform: shell.style.transform || "none" },
        { opacity: 0, transform: `${shell.style.transform || "none"} scale(.96)` },
      ],
      {
        duration: VIEWER_ANIM_MS,
        easing: "cubic-bezier(0.4, 0, 1, 1)",
        fill: "forwards",
      },
    );
  }
  const startRadius = firstFrame?.radius || shell.style.borderRadius || "0px";
  Object.assign(shell.style, {
    left: `${first.left}px`,
    top: `${first.top}px`,
    width: `${first.width}px`,
    height: `${first.height}px`,
    transform: "none",
    borderRadius: startRadius,
    boxShadow: shell.style.boxShadow,
    overflow: "hidden",
    background: "#000",
    zIndex: "1",
  } as Partial<CSSStyleDeclaration>);
  shell.getBoundingClientRect();
  const anim = shell.animate([rectFrame(first, startRadius), rectFrame(target, "0px")], {
    duration: VIEWER_ANIM_MS,
    easing: "cubic-bezier(0.4, 0, 1, 1)",
    fill: "forwards",
  });
  return anim;
}

function waitAnimation(anim: Animation | null): Promise<void> {
  if (!anim) return Promise.resolve();
  const finish = anim.onfinish;
  const cancel = anim.oncancel;
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(complete, VIEWER_ANIM_MS + 180);
    function complete() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    }
    anim.onfinish = (e) => {
      if (typeof finish === "function") finish.call(anim, e);
      complete();
    };
    anim.oncancel = (e) => {
      if (typeof cancel === "function") cancel.call(anim, e);
      complete();
    };
  });
}

// True if a node belongs to the viewer's own DOM — the media observer ignores
// our writes, mirroring ownsBadgeNode/ownsLauncherNode.
export function ownsViewerNode(node: Node | null): boolean {
  if (!node) return false;
  return !!(overlay && (overlay === node || overlay.contains(node)));
}

// mm:ss below an hour, h:mm:ss above.
export function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const t = Math.floor(s);
  const ss = String(t % 60).padStart(2, "0");
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

type Timeline =
  | { kind: "vod"; start: 0; pos: number; len: number }
  | { kind: "dvr"; start: number; pos: number; len: number }
  | { kind: "live" }
  | { kind: "loading"; pos: number };

const MAX_REAL_DURATION = 60 * 60 * 24 * 30;

function mediaTimeline(v: HTMLVideoElement): Timeline {
  const dur = v.duration;
  if (Number.isFinite(dur) && dur > 0 && dur < MAX_REAL_DURATION) {
    return { kind: "vod", start: 0, pos: v.currentTime, len: dur };
  }
  const ranges = v.seekable;
  if (ranges && ranges.length > 0) {
    const start = ranges.start(ranges.length - 1);
    const end = ranges.end(ranges.length - 1);
    const len = end - start;
    if (Number.isFinite(start) && Number.isFinite(end) && len > 5 && len < MAX_REAL_DURATION) {
      const pos = Math.min(Math.max(v.currentTime, start), end) - start;
      return { kind: "dvr", start, pos, len };
    }
  }
  if (isLive(v)) return { kind: "live" };
  return { kind: "loading", pos: v.currentTime };
}

// Size the video for the current format. Theater fills the overlay; normal is
// a centred box at the video's aspect within FRACTION of the viewport —
// computed in px (and re-computed on resize/metadata) so the box tracks the
// real aspect once it's known.
// Everything the site's own stylesheets could leak onto the element (padding,
// rounded corners, borders, size clamps) is reset with !important — in theater
// the only bars left are the letterbox from the fit mode itself.
const VIDEO_RESET =
  "margin:0 !important;padding:0 !important;border:0 !important;" +
  "max-width:none !important;max-height:none !important;" +
  "min-width:0 !important;min-height:0 !important;background:#000 !important;" +
  "z-index:1 !important;";

// How the picture fills its box: letterboxed, cropped to the edges, or
// stretched (for squeezing 4:3 out to the borders). Picked from a bar menu,
// sticky for the tab's lifetime.
const FIT_MODES = ["contain", "cover", "fill"] as const;
const FIT_LABEL: Record<ViewerFitMode, [string, string]> = {
  contain: ["viewerFitContain", "Fit"],
  cover: ["viewerFitCover", "Crop"],
  fill: ["viewerFitFill", "Stretch"],
};
const fitLabel = (m: ViewerFitMode) => i18n(FIT_LABEL[m][0]) || FIT_LABEL[m][1];

export function viewerFitMode(): ViewerFitMode {
  return S.viewerFit;
}

export function setViewerFitMode(mode: unknown): ViewerFitMode {
  S.viewerFit = normalizeViewerFit(mode);
  sizeVideo();
  showBadgeNotice(`Fit: ${fitLabel(S.viewerFit)}`);
  return S.viewerFit;
}

function sizeVideo(): void {
  const surface = surfaceVideo ?? video;
  const shell = surfaceShell;
  if (!fmt || !surface || !shell) return;
  const fit = `object-fit:${S.viewerFit} !important;`;
  surface.style.cssText =
    "position:absolute !important;inset:0 !important;" +
    "width:100% !important;height:100% !important;" +
    "transform:none !important;border-radius:inherit !important;box-shadow:none !important;" +
    fit +
    VIDEO_RESET;
  if (fmt === "theater") {
    normalBox = null;
    shell.style.cssText =
      "position:absolute !important;inset:0 !important;" +
      "width:100% !important;height:100% !important;" +
      "transform:none !important;border-radius:0 !important;box-shadow:none !important;" +
      "overflow:hidden !important;background:#000 !important;z-index:1 !important;" +
      "will-change:transform,width,height,left,top,opacity !important;contain:paint !important;";
  } else {
    const mediaWidth = surface.videoWidth || video?.videoWidth || 0;
    const mediaHeight = surface.videoHeight || video?.videoHeight || 0;
    const hasMetadata = !!(mediaWidth && mediaHeight);
    const ar = hasMetadata ? mediaWidth / mediaHeight : 16 / 9;
    const viewportChanged =
      !normalBox || normalBox.vw !== window.innerWidth || normalBox.vh !== window.innerHeight;
    const metadataArrived = !!normalBox && !normalBox.fromMetadata && hasMetadata;
    if (viewportChanged || metadataArrived) {
      const w = Math.round(
        Math.min(window.innerWidth * FRACTION, window.innerHeight * FRACTION * ar),
      );
      normalBox = {
        w,
        h: Math.round(w / ar),
        vw: window.innerWidth,
        vh: window.innerHeight,
        fromMetadata: hasMetadata,
      };
    }
    if (!normalBox) return;
    const box = normalBox;
    shell.style.cssText =
      "position:absolute !important;left:50% !important;top:50% !important;" +
      "transform:translate(-50%,-50%) !important;" +
      `width:${box.w}px !important;height:${box.h}px !important;` +
      "border-radius:12px !important;box-shadow:0 32px 104px rgba(0,0,0,0.62),0 8px 28px rgba(0,0,0,0.35) !important;" +
      "overflow:hidden !important;background:#000 !important;z-index:1 !important;" +
      "will-change:transform,width,height,left,top,opacity !important;contain:paint !important;";
  }
  // The browser normalizes cssText on write — keep the normalized form, so the
  // style guard's comparison (and re-assert) converges instead of looping.
  desiredCss = surface.style.cssText;
  desiredShellCss = shell.style.cssText;
  layoutBar();
}

// The bar hugs the video's bottom edge, clamped to a sane width.
function layoutBar(): void {
  const surface = surfaceShell ?? surfaceVideo ?? video;
  if (!bar || !surface) return;
  const r = surface.getBoundingClientRect();
  const timeline = video ? mediaTimeline(video) : null;
  const live = timeline?.kind === "live";
  bar.classList.toggle("live", live);
  let w = Math.min(Math.max(r.width - 32, 280), 760);
  if (live) {
    const visible = Array.from(bar.children).filter((el) => {
      return getComputedStyle(el).display !== "none";
    });
    const gap = 6;
    const padding = 20;
    const content = visible.reduce((sum, el) => sum + el.getBoundingClientRect().width, 0);
    const max = qualityWrap?.style.display === "none" ? 320 : 380;
    w = Math.min(
      Math.max(Math.ceil(content + gap * Math.max(visible.length - 1, 0) + padding), 260),
      max,
    );
  }
  bar.style.width = Math.round(w) + "px";
  bar.style.left = Math.round(r.left + r.width / 2) + "px";
  bar.style.bottom = Math.max(Math.round(window.innerHeight - r.bottom + 14), 14) + "px";
}

function setFormat(f: ViewerFormat): void {
  const switchingFormat = !!fmt && fmt !== f;
  const firstFrame = switchingFormat ? interruptSurfaceTransition() : null;
  fmt = f;
  document.documentElement.setAttribute(ATTR, f);
  fmtBtn?.setAttribute("aria-pressed", f === "theater" ? "true" : "false");
  applyOverlayBackdrop();
  sizeVideo();
  const transition = firstFrame ? animateSurfaceFrom(firstFrame) : null;
  if (switchingFormat && !transition) {
    layoutPaused = false;
    layoutBar();
    showBar();
  }
  overlay?.focus({ preventScroll: true });
  notifyViewerState();
  notifyViewerLayout();
  showBadgeNotice(f === "theater" ? "Theater" : "Viewer");
}

function setViewerCursor(hidden: boolean): void {
  const value = hidden ? "none" : "";
  if (overlay) overlay.style.cursor = value;
  if (surfaceShell) surfaceShell.style.cursor = value;
  if (surfaceVideo) surfaceVideo.style.cursor = value;
  if (backdropVideo) backdropVideo.style.cursor = value;
  if (bar) bar.style.cursor = value;
}

function showBar(): void {
  if (!bar) return;
  const wasHidden = bar.style.visibility === "hidden";
  setViewerCursor(false);
  clearTimeout(barVisibilityTimer);
  bar.style.visibility = "visible";
  bar.style.opacity = "1";
  bar.style.pointerEvents = "auto";
  if (wasHidden) syncTime();
  clearTimeout(barTimer);
  if (video?.paused) return; // paused → controls stay up, like every player
  barTimer = setTimeout(() => {
    if (!bar || video?.paused) return;
    setViewerCursor(true);
    bar.style.opacity = "0";
    bar.style.pointerEvents = "none";
    clearTimeout(barVisibilityTimer);
    barVisibilityTimer = setTimeout(() => {
      if (bar?.style.opacity === "0") bar.style.visibility = "hidden";
    }, 260);
  }, BAR_HIDE_MS);
}

// Keep the bar's widgets honest against the media element's state.
function syncPlay(): void {
  playBtn?.setAttribute("aria-pressed", video && !video.paused ? "true" : "false");
  if (video?.paused) showBar();
  else scheduleBackdropCanvas();
}
function syncVolume(): void {
  if (!video) return;
  muteBtn?.setAttribute("aria-pressed", video.muted ? "true" : "false");
  if (volEl && !video.muted) volEl.value = String(Math.round(video.volume * 100));
}
function syncTime(): void {
  if (!video) return;
  if (bar?.style.visibility === "hidden" && !seeking) return;
  const timeline = mediaTimeline(video);
  const prevTimelineKind = lastTimelineKind;
  lastTimelineKind = timeline.kind;
  bar?.classList.toggle("live", timeline.kind === "live");
  const prevSeekDisplay = seekWrapEl?.style.display;
  if (seekEl) {
    const seekable = timeline.kind === "vod" || timeline.kind === "dvr";
    if (seekWrapEl) seekWrapEl.style.display = seekable ? "flex" : "none";
    seekEl.style.display = seekable ? "" : "none";
    if (seekable && !seeking && timeline.len > 0) {
      seekEl.value = String((timeline.pos / timeline.len) * 1000);
    }
  }
  if (timeEl) {
    timeEl.textContent =
      timeline.kind === "live"
        ? "LIVE"
        : timeline.kind === "loading"
          ? fmtTime(timeline.pos)
          : `${fmtTime(timeline.pos)} / ${fmtTime(timeline.len)}`;
  }
  if (timeline.kind !== prevTimelineKind || seekWrapEl?.style.display !== prevSeekDisplay) {
    layoutBar();
  }
}

// One glass button. Static, trusted markup via DOMParser (the AMO linter flags
// innerHTML), matching the launcher's construction. With `alt` markup, the two
// icons swap on aria-pressed (play⇄pause, sound⇄muted, expand⇄shrink).
function barButton(svg: string, alt: string | null, label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.title = label;
  if (alt) b.setAttribute("aria-pressed", "false");
  const body = new DOMParser().parseFromString(
    `<span class="ico ico-a">${svg}</span>` + (alt ? `<span class="ico ico-b">${alt}</span>` : ""),
    "text/html",
  ).body;
  while (body.firstChild) b.appendChild(body.firstChild);
  return b;
}

const I_PLAY =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const I_PAUSE =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
const I_SOUND =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const I_MUTED =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const I_GROW =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
const I_SHRINK =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>';
const I_CLOSE =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
const I_FIT =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 12h8M8 12l2-2M8 12l2 2M16 12l-2-2M16 12l-2 2"/></svg>';
const I_QUALITY =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4"/></svg>';

function ensureQualityVideoId(): string {
  if (!video) return "";
  if (!qualityVideoId) {
    qualityVideoId = `vtp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
  video.setAttribute("data-vtp-quality-id", qualityVideoId);
  return qualityVideoId;
}

function qualityRequest(
  type: "vtp-quality-request" | "vtp-quality-set",
  qualityId?: string,
): Promise<QualityState> {
  const videoId = ensureQualityVideoId();
  if (!videoId) return Promise.resolve({ options: [], current: "auto" });
  const requestId = `q${++qualityReq}`;
  return new Promise((resolve) => {
    let obs: MutationObserver | null = null;
    const done = (state: QualityState) => {
      obs?.disconnect();
      document.removeEventListener("vtp-quality-response", onResponse);
      clearTimeout(timer);
      resolve(state);
    };
    const onResponse = (e: Event) => {
      let d = (e as CustomEvent).detail || {};
      const raw = document.documentElement.getAttribute(QUALITY_RESP_ATTR);
      if (raw) {
        try {
          d = JSON.parse(raw);
        } catch (err) {
          /* keep detail fallback */
        }
      }
      if (d.requestId !== requestId) return;
      done({
        options: Array.isArray(d.options) ? d.options : [],
        current: typeof d.current === "string" ? d.current : "auto",
      });
    };
    const timer = setTimeout(() => done({ options: [], current: "auto" }), 4000);
    document.addEventListener("vtp-quality-response", onResponse);
    const root = document.documentElement;
    obs = new MutationObserver(() => onResponse(new Event("vtp-quality-response")));
    obs.observe(root, { attributes: true, attributeFilter: [QUALITY_RESP_ATTR] });
    root.setAttribute(QUALITY_REQ_ATTR, requestId);
    root.setAttribute(QUALITY_VIDEO_ATTR, videoId);
    if (qualityId) root.setAttribute(QUALITY_PICK_ATTR, qualityId);
    else root.removeAttribute(QUALITY_PICK_ATTR);
    video?.dispatchEvent(
      new CustomEvent(type, {
        bubbles: true,
        composed: true,
        detail: { requestId, videoId, qualityId },
      }),
    );
  });
}

function setQualityVisible(visible: boolean): void {
  if (!qualityWrap) return;
  qualityWrap.style.display = visible ? "block" : "none";
  layoutBar();
}

function qualityButtonLabel(label: string): string {
  const clean = label.trim();
  const paren = clean.match(/\((\d{3,4})p(?:\d+)?\)/i);
  const direct = clean.match(/(\d{3,4})p(?:\d+)?/i);
  const height = paren?.[1] || direct?.[1];
  if (height) return `${height}p`;
  return (
    clean
      .replace(/\s*\([^)]*\)\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim() || clean
  );
}

function renderQuality(state: QualityState): void {
  const options = state.options.filter((o) => o && o.id && o.label);
  const confirmed = options.find((o) => o.current) ?? options.find((o) => o.id === state.current);
  const pending =
    pendingQuality && Date.now() < pendingQualityUntil
      ? options.find((o) => o.id === pendingQuality?.id)
      : null;
  const selected = pending && confirmed?.id !== pending.id ? pending : (confirmed ?? pending);
  if (!options.length || options.length < 2) {
    setQualityVisible(false);
    return;
  }
  if (confirmed && confirmed.id !== "auto" && !pending) pendingQuality = confirmed;
  setQualityVisible(true);
  if (qualityLabelEl) qualityLabelEl.textContent = qualityButtonLabel(selected?.label || "Auto");
  if (!qualityMenu) return;
  qualityMenu.textContent = "";
  for (const opt of options) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "qitem";
    item.textContent = opt.label;
    if (opt.current || opt.id === state.current) item.setAttribute("aria-current", "true");
    item.addEventListener("click", async () => {
      qualityMenu?.classList.remove("open");
      pendingQuality = opt;
      pendingQualityUntil = Date.now() + 12_000;
      if (qualityLabelEl) qualityLabelEl.textContent = qualityButtonLabel(opt.label);
      showBadgeNotice(`Quality: ${opt.label}`);
      const next = await qualityRequest("vtp-quality-set", opt.id);
      pendingQuality = null;
      pendingQualityUntil = 0;
      renderQuality({
        ...next,
        current: opt.id,
        options: next.options.map((o) => ({ ...o, current: o.id === opt.id })),
      });
      refreshMirrorStream();
      window.setTimeout(() => refreshMirrorStream(), 700);
      window.setTimeout(() => refreshQuality(), 700);
    });
    qualityMenu.appendChild(item);
  }
}

async function refreshQuality(): Promise<void> {
  if (!fmt || !video || !qualityWrap) return;
  renderQuality(await qualityRequest("vtp-quality-request"));
}

// Our control bar, inside a shadow-rooted host that spans the overlay (the
// host itself is click-through; only the bar takes pointer events).
function mountBar(): void {
  if (!overlay) return;
  const host = document.createElement("div");
  Object.assign(host.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
  } as Partial<CSSStyleDeclaration>);
  const shadow = host.attachShadow({ mode: "open" });
  ensureGlassFilter(shadow);
  const style = document.createElement("style");
  style.textContent =
    // The bar mirrors the popup's glass cards: same tint/blur family, rounded
    // rectangle buttons with a quiet hover, 13px system type.
    `.bar{position:fixed;transform:translateX(-50%);display:flex;align-items:center;gap:12px;` +
    `box-sizing:border-box;max-width:calc(100vw - 32px);min-width:0;` +
    `padding:12px 16px;border-radius:16px;color:#fff;` +
    `background:rgb(20 20 22 / calc(0.4 * var(--glass-opacity,1)));` +
    `box-shadow:0 0 0 1px rgba(255,255,255,0.14),0 12px 40px rgba(0,0,0,0.4);` +
    `-webkit-backdrop-filter:${GLASS_REFRACTION}blur(10px) saturate(180%) brightness(1.04);` +
    `backdrop-filter:${GLASS_REFRACTION}blur(10px) saturate(180%) brightness(1.04);` +
    `font:13px/1.2 -apple-system,system-ui,sans-serif;` +
    `opacity:0;visibility:hidden;pointer-events:none;transition:opacity .25s;z-index:1}` +
    `.bar.live{gap:6px;padding:8px 10px}` +
    `button{position:relative;width:32px;height:32px;flex:none;padding:0;border:0;border-radius:10px;` +
    `cursor:pointer;color:#fff;background:transparent;display:flex;align-items:center;justify-content:center;` +
    `transition:background .15s}` +
    `button:hover{background:rgba(255,255,255,0.12)}` +
    `button:active{background:rgba(255,255,255,0.2)}` +
    `.ico{position:absolute;inset:0;display:grid;place-items:center}` +
    `.ico svg{display:block}` +
    `.qbtn{width:auto;min-width:32px;max-width:104px;padding:0 9px;gap:5px}` +
    `.qbtn .ico{position:static;inset:auto;flex:none}` +
    `.qbtn-label{overflow:hidden;text-overflow:clip;white-space:nowrap;font-size:12px;` +
    `font-variant-numeric:tabular-nums}` +
    `.bar.live .qbtn{max-width:82px;padding:0 7px}` +
    `.bar.live .qbtn-label{max-width:40px}` +
    `button .ico-b{visibility:hidden}` +
    `button[aria-pressed="true"] .ico-a{visibility:hidden}` +
    `button[aria-pressed="true"] .ico-b{visibility:visible}` +
    // Sliders match the popup's: a 6px translucent groove + a white 20×16 pill.
    `input[type="range"]{-webkit-appearance:none;appearance:none;height:16px;` +
    `background:transparent;cursor:pointer;margin:0}` +
    `input[type="range"]::-webkit-slider-runnable-track{height:6px;border-radius:3px;` +
    `background:rgba(255,255,255,0.22)}` +
    `input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:16px;` +
    `border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);margin-top:-5px;border:0}` +
    `input[type="range"]:focus-visible::-webkit-slider-thumb{box-shadow:0 1px 3px rgba(0,0,0,0.4),` +
    `0 0 0 3px rgba(255,255,255,0.5)}` +
    `input[type="range"]::-moz-range-track{height:6px;border-radius:3px;background:rgba(255,255,255,0.22)}` +
    `input[type="range"]::-moz-range-thumb{width:20px;height:16px;border-radius:8px;background:#fff;` +
    `box-shadow:0 1px 3px rgba(0,0,0,0.4);border:0}` +
    `.seekwrap{position:relative;flex:1 1 120px;min-width:0;display:flex;align-items:center}` +
    `.seek{flex:1;min-width:0;position:relative;z-index:1}` +
    // Chapter boundaries read like YouTube's: dark notches CUT INTO the groove
    // (hover shows the chapter title); sponsor segments tint the groove itself.
    `.marks{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:16px;pointer-events:none}` +
    `.mark-seg{position:absolute;top:50%;transform:translateY(-50%);height:6px;border-radius:3px;` +
    `opacity:0.8;z-index:1;transition:height .12s ease,opacity .12s ease,box-shadow .12s ease}` +
    `.mark-chapter{position:absolute;top:50%;transform:translateY(-50%);height:16px;border-radius:4px;` +
    `background:transparent;z-index:0;transition:background .12s ease}` +
    `.mark-seg.active{height:10px;opacity:1;box-shadow:0 0 0 1px rgba(255,255,255,0.55),` +
    `0 0 12px currentColor}` +
    `.mark-chapter.active{background:rgba(255,255,255,0.16)}` +
    `.mark-tick{position:absolute;top:50%;transform:translateY(-50%);height:8px;width:2.5px;` +
    `background:rgba(0,0,0,0.65);pointer-events:auto;z-index:2}` +
    `.mark-tip{position:absolute;left:0;bottom:22px;max-width:220px;padding:5px 8px;border-radius:8px;` +
    `background:rgb(20 20 22 / 0.92);color:#fff;box-shadow:0 0 0 1px rgba(255,255,255,0.14),` +
    `0 8px 24px rgba(0,0,0,0.35);font:12px/1.2 -apple-system,system-ui,sans-serif;` +
    `white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;z-index:5;` +
    `opacity:0;transform:translateX(-50%) translateY(4px);transition:opacity .12s ease,transform .12s ease}` +
    `.mark-tip.show{opacity:1;transform:translateX(-50%) translateY(0)}` +
    `.vol{width:64px;flex:none}` +
    `.bar.live .vol{width:44px}` +
    `.time{flex:none;white-space:nowrap;opacity:.9;font-variant-numeric:tabular-nums}` +
    `.qwrap{position:relative;flex:none;z-index:3}` +
    `.qwrap[style*="display: none"]{display:none!important}` +
    `.qmenu{position:absolute;bottom:40px;left:50%;transform:translateX(-50%);display:none;` +
    `flex-direction:column;gap:2px;padding:6px;border-radius:10px;min-width:92px;` +
    `max-height:40vh;overflow:auto;background:rgb(20 20 22 / 0.9);pointer-events:auto;z-index:4;` +
    `box-shadow:0 0 0 1px rgba(255,255,255,0.14),0 12px 40px rgba(0,0,0,0.4)}` +
    `.qmenu.open{display:flex}` +
    `.qitem{padding:6px 10px;border:0;border-radius:6px;cursor:pointer;white-space:nowrap;` +
    `text-align:center;color:#fff;background:transparent;font:inherit;width:auto;height:auto;display:block}` +
    `.qitem:hover{background:rgba(255,255,255,0.15)}` +
    `.qitem[aria-current="true"]{background:rgba(255,255,255,0.25)}`;
  shadow.append(style);

  bar = document.createElement("div");
  bar.className = "bar";
  playBtn = barButton(I_PLAY, I_PAUSE, i18n("viewerPlayAria") || "Play / pause");
  playBtn.addEventListener("click", () => {
    if (!video) return;
    if (video.paused) video.play()?.catch(() => {});
    else video.pause();
  });
  timeEl = document.createElement("span");
  timeEl.className = "time";
  const seekWrap = document.createElement("span");
  seekWrap.className = "seekwrap";
  seekWrapEl = seekWrap;
  marksEl = document.createElement("div");
  marksEl.className = "marks";
  markerTipEl = document.createElement("div");
  markerTipEl.className = "mark-tip";
  seekEl = document.createElement("input");
  seekEl.type = "range";
  seekEl.className = "seek";
  seekEl.min = "0";
  seekEl.max = "1000";
  seekEl.step = "1";
  seekEl.setAttribute("aria-label", i18n("viewerSeekAria") || "Seek");
  seekEl.addEventListener("pointerdown", () => {
    seeking = true;
  });
  seekEl.addEventListener("pointerup", () => (seeking = false));
  seekEl.addEventListener("input", () => {
    if (!video) return;
    const timeline = mediaTimeline(video);
    if (timeline.kind !== "vod" && timeline.kind !== "dvr") return;
    video.currentTime = timeline.start + (Number(seekEl!.value) / 1000) * timeline.len;
    syncTime();
  });
  seekWrap.addEventListener("pointermove", showMarkerHover);
  seekWrap.addEventListener("pointerleave", clearMarkerHover);
  muteBtn = barButton(I_SOUND, I_MUTED, i18n("viewerMuteAria") || "Mute");
  muteBtn.addEventListener("click", () => {
    if (video) video.muted = !video.muted;
  });
  volEl = document.createElement("input");
  volEl.type = "range";
  volEl.className = "vol";
  volEl.min = "0";
  volEl.max = "100";
  volEl.step = "1";
  volEl.setAttribute("aria-label", i18n("viewerVolumeAria") || "Volume");
  volEl.addEventListener("input", () => {
    if (!video) return;
    video.volume = Number(volEl!.value) / 100;
    video.muted = false;
  });
  // Fit mode menu: letterbox / crop / stretch (pulls a 4:3 picture out to the
  // edges).
  const fwrap = document.createElement("span");
  fwrap.className = "qwrap";
  const fitBtn = barButton(I_FIT, null, i18n("viewerFitAria") || "Fill mode");
  fitMenu = document.createElement("div");
  fitMenu.className = "qmenu";
  fitBtn.addEventListener("click", () => {
    if (!fitMenu) return;
    if (fitMenu.classList.contains("open")) {
      fitMenu.classList.remove("open");
      return;
    }
    fitMenu.textContent = "";
    for (const m of FIT_MODES) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "qitem";
      item.textContent = fitLabel(m);
      if (m === S.viewerFit) item.setAttribute("aria-current", "true");
      item.addEventListener("click", () => {
        setViewerFitMode(m);
        fitMenu?.classList.remove("open");
      });
      fitMenu.appendChild(item);
    }
    fitMenu.classList.add("open");
  });
  fwrap.append(fitBtn, fitMenu);
  qualityWrap = document.createElement("span");
  qualityWrap.className = "qwrap";
  qualityWrap.style.display = "none";
  qualityBtn = barButton(I_QUALITY, null, i18n("viewerQualityAria") || "Quality");
  qualityBtn.classList.add("qbtn");
  qualityLabelEl = document.createElement("span");
  qualityLabelEl.className = "qbtn-label";
  qualityLabelEl.textContent = "Auto";
  qualityBtn.appendChild(qualityLabelEl);
  qualityMenu = document.createElement("div");
  qualityMenu.className = "qmenu";
  qualityBtn.addEventListener("click", async () => {
    if (!qualityMenu) return;
    if (qualityMenu.classList.contains("open")) {
      qualityMenu.classList.remove("open");
      return;
    }
    const state = await qualityRequest("vtp-quality-request");
    renderQuality(state);
    if (state.options.length >= 2) qualityMenu.classList.add("open");
  });
  qualityWrap.append(qualityBtn, qualityMenu);
  fmtBtn = barButton(I_GROW, I_SHRINK, i18n("viewerTheaterAria") || "Pop out in theater format");
  fmtBtn.addEventListener("click", () => toggleViewer(fmt === "theater" ? "normal" : "theater"));
  const closeBtn = barButton(I_CLOSE, null, i18n("viewerCloseAria") || "Close the pop-out viewer");
  closeBtn.addEventListener("click", exitViewer);
  seekWrap.append(marksEl, seekEl, markerTipEl);
  bar.append(playBtn, timeEl, seekWrap, muteBtn, volEl, qualityWrap, fwrap, fmtBtn, closeBtn);
  bar.addEventListener("pointerenter", () => clearTimeout(barTimer));
  bar.addEventListener("pointerleave", showBar);
  shadow.append(bar);
  overlay.appendChild(host);
  bar.style.setProperty("--glass-opacity", String(S.glassOpacity));
}

// Chapter ticks (captured pre-adoption) and opt-in SponsorBlock bands on the
// seek bar. Waits for a real duration; bands render under the ticks.
function segmentLabel(category: string): string {
  return category.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function chapterLabel(title: string, index: number): string {
  return title || `${i18n("viewerChapterFallback") || "Chapter"} ${index + 1}`;
}

function addMarkerRange(start: number, end: number, label: string, el: HTMLElement): void {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !label) return;
  markerRanges.push({ start, end, label, el });
}

function clampMarkerFloatX(x: number, width: number): number {
  const pad = width / 2 + 4;
  return Math.min(
    Math.max(x, pad),
    Math.max(pad, (seekWrapEl?.getBoundingClientRect().width ?? 0) - pad),
  );
}

function clearMarkerHighlight(): void {
  activeMarker?.el.classList.remove("active");
  activeMarker = null;
  markerTipEl?.classList.remove("show");
}

function clearMarkerHover(): void {
  clearMarkerHighlight();
}

function markerSourceKey(v: HTMLVideoElement): string {
  return `${v.currentSrc || v.src || ""}|${Number.isFinite(v.duration) ? v.duration : ""}`;
}

function resetMarkersForSource(): void {
  if (!video) return;
  const key = markerSourceKey(video);
  if (key === marksSourceKey) return;
  marksSourceKey = key;
  marksLoaded = false;
  marksEl?.replaceChildren();
  markerRanges = [];
  activeMarker = null;
  clearMarkerHover();
  pendingChapters =
    isYouTube() && Number.isFinite(video.duration) ? readYouTubeChapters(video.duration) : [];
}

function showMarkerHover(e: PointerEvent): void {
  if (!seekWrapEl || !markerTipEl || !video) return;
  const timeline = mediaTimeline(video);
  if ((timeline.kind !== "vod" && timeline.kind !== "dvr") || timeline.len <= 0) return;
  const r = seekWrapEl.getBoundingClientRect();
  if (r.width <= 0) return;
  const x = Math.min(r.width, Math.max(0, e.clientX - r.left));
  const t = timeline.start + (x / r.width) * timeline.len;
  const next =
    markerRanges
      .filter((m) => t >= m.start && t <= m.end)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0] ?? null;
  if (!next) {
    clearMarkerHighlight();
    return;
  }
  if (activeMarker !== next) {
    activeMarker?.el.classList.remove("active");
    activeMarker = next;
    next.el.classList.add("active");
    markerTipEl.textContent = next.label;
  }
  markerTipEl.style.left = Math.round(clampMarkerFloatX(x, 80)) + "px";
  markerTipEl.classList.add("show");
}

async function loadMarkers(): Promise<void> {
  if (!marksEl || !video) return;
  const dur = video.duration;
  if (!Number.isFinite(dur) || dur <= 0) return;
  marksSourceKey = markerSourceKey(video);
  marksLoaded = true;
  marksEl.textContent = "";
  markerRanges = [];
  clearMarkerHover();
  const keyAtEntry = marksSourceKey;
  if ((S.sponsorMarks || hasNativeSponsorBlock()) && isYouTube()) {
    const id = youTubeVideoId();
    if (id) {
      const segs = await fetchSponsorSegments(id);
      if (!fmt || !marksEl || marksSourceKey !== keyAtEntry) return;
      for (const sg of segs) {
        const d = document.createElement("div");
        d.className = "mark-seg";
        d.style.left = (sg.start / dur) * 100 + "%";
        d.style.width = Math.max(((sg.end - sg.start) / dur) * 100, 0.3) + "%";
        d.style.background = SPONSOR_COLORS[sg.category] || "#888";
        d.style.color = SPONSOR_COLORS[sg.category] || "#888";
        addMarkerRange(sg.start, sg.end, segmentLabel(sg.category), d);
        marksEl.appendChild(d);
      }
    }
  }
  for (let i = 0; i < pendingChapters.length; i++) {
    const ch = pendingChapters[i];
    const end = pendingChapters[i + 1]?.start ?? dur;
    if (end > ch.start) {
      const s = document.createElement("div");
      s.className = "mark-chapter";
      s.style.left = (ch.start / dur) * 100 + "%";
      s.style.width = Math.max(((end - ch.start) / dur) * 100, 0.3) + "%";
      addMarkerRange(ch.start, end, chapterLabel(ch.title, i), s);
      marksEl.appendChild(s);
    }
    if (ch.start <= 0) continue;
    const t = document.createElement("div");
    t.className = "mark-tick";
    t.style.left = (ch.start / dur) * 100 + "%";
    marksEl.appendChild(t);
  }
}

// While popped out: the site's player may fight back — yank the video home or
// tear the spot down (the layer closed, SPA navigation). Both mean the show is
// over; put everything back (or let it go) and close.
function guard(): void {
  if (!fmt) return;
  if (
    !video ||
    !overlay ||
    !surfaceVideo?.isConnected ||
    !surfaceShell?.isConnected ||
    (mirrored && !video.isConnected) ||
    (!mirrored && video.parentElement !== surfaceShell) ||
    (holder && !holder.isConnected)
  ) {
    exitViewer();
  }
}

function hookGlobal(): void {
  if (hooked) return;
  hooked = true;
  window.addEventListener(
    "resize",
    () => {
      sizeVideo();
      notifyViewerLayout();
    },
    { passive: true },
  );
  // Real fullscreen supersedes the viewer — the two fight over the same video.
  addFullscreenChangeListener(() => {
    if (currentFullscreenElement()) exitViewer();
  });
}

// Media listeners + style enforcer for the adopted element. The shared
// AbortController also holds the overlay-level listeners, so re-wiring after a
// player recreated its element just adds the new element's set (the old one
// left the DOM together with its listeners).
function wireVideo(v: HTMLVideoElement): void {
  if (!media) return;
  const opt = { signal: media.signal };
  for (const ev of ["play", "pause"]) v.addEventListener(ev, syncPlay, opt);
  v.addEventListener("volumechange", syncVolume, opt);
  for (const ev of ["timeupdate", "durationchange", "loadedmetadata"]) {
    v.addEventListener(ev, syncTime, opt);
  }
  v.addEventListener("loadedmetadata", sizeVideo, opt); // the real aspect may arrive late
  v.addEventListener("ended", exitViewer, opt); // the show is over — hand the page back
  v.addEventListener(
    "durationchange",
    () => {
      resetMarkersForSource();
      if (!marksLoaded) loadMarkers();
    },
    opt,
  );
  v.addEventListener(
    "loadedmetadata",
    () => {
      resetMarkersForSource();
      if (!marksLoaded) loadMarkers();
    },
    opt,
  );
  surfaceVideo?.addEventListener(
    "click",
    () => (v.paused ? v.play()?.catch(() => {}) : v.pause()),
    opt,
  );
  // Sites (YouTube) keep restyling their video — snap ours back on sight.
  // Disconnect while writing rather than trust a string comparison to converge:
  // the browser doesn't guarantee re-serializing an already-normalized cssText
  // yields byte-identical output every time, and a callback that reasserts a
  // style on the very node it's observing can otherwise re-trigger itself
  // indefinitely.
  styleGuard?.disconnect();
  styleGuard = new MutationObserver(() => {
    const surface = surfaceVideo ?? video;
    if (!fmt || !surface || surface.style.cssText === desiredCss) return;
    styleGuard?.disconnect();
    surface.style.cssText = desiredCss;
    if (surfaceVideo)
      styleGuard?.observe(surfaceVideo, { attributes: true, attributeFilter: ["style"] });
  });
  if (surfaceVideo)
    styleGuard.observe(surfaceVideo, { attributes: true, attributeFilter: ["style"] });
}

type CaptureVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

function createMirror(v: HTMLVideoElement): HTMLVideoElement | null {
  const capture = (v as CaptureVideo).captureStream ?? (v as CaptureVideo).mozCaptureStream;
  if (!capture) return null;
  try {
    const stream = capture.call(v);
    if (!stream || !stream.getVideoTracks().length) return null;
    const mirror = document.createElement("video");
    mirrorStream = stream;
    mirror.srcObject = stream;
    mirror.muted = true;
    mirror.playsInline = true;
    mirror.autoplay = true;
    mirror.controls = false;
    mirror.setAttribute("aria-hidden", "true");
    mirror.play()?.catch(() => {});
    return mirror;
  } catch (e) {
    return null;
  }
}

function refreshMirrorStream(): void {
  if (!mirrored || !video || !surfaceVideo) return;
  const capture = (video as CaptureVideo).captureStream ?? (video as CaptureVideo).mozCaptureStream;
  if (!capture) return;
  try {
    const stream = capture.call(video);
    if (!stream || !stream.getVideoTracks().length) return;
    mirrorStream?.getTracks().forEach((t) => t.stop());
    mirrorStream = stream;
    surfaceVideo.srcObject = stream;
    if (backdropVideo instanceof HTMLVideoElement) backdropVideo.srcObject = stream;
    else if (backdropVideo instanceof HTMLCanvasElement && !drawBackdropCanvas()) {
      createBackdropVideoFallback();
    }
    surfaceVideo.play()?.catch(() => {});
    if (backdropVideo instanceof HTMLVideoElement) backdropVideo.play()?.catch(() => {});
    else scheduleBackdropCanvas();
  } catch (e) {
    /* keep the existing mirror */
  }
}

function hideMirroredSource(v: HTMLVideoElement): void {
  prevSourceVisibility = v.style.getPropertyValue("visibility");
  prevSourceVisibilityPriority = v.style.getPropertyPriority("visibility");
  v.style.setProperty("visibility", "hidden", "important");
}

function restoreMirroredSource(v: HTMLVideoElement): void {
  if (prevSourceVisibility) {
    v.style.setProperty("visibility", prevSourceVisibility, prevSourceVisibilityPriority);
  } else {
    v.style.removeProperty("visibility");
  }
  prevSourceVisibility = "";
  prevSourceVisibilityPriority = "";
}

// Auto-open on playback (the `viewerAuto` setting). Once per video element:
// exiting adds the video to the seen set, so a manual close isn't fought the
// next time the user hits play.
const autoSeen = new WeakSet<HTMLVideoElement>();
document.addEventListener(
  "play",
  (e) => {
    if (window.top !== window) return;
    const t = e.target;
    if (!(t instanceof HTMLVideoElement)) return;
    // Our own mirror/backdrop videos live inside the overlay and are started
    // with .play() during enter() — their own (async) "play" event bubbles
    // right back to this same document-level listener. Without this check,
    // that self-generated event re-enters the viewer, which creates a new
    // mirror, whose play event re-enters again — a confirmed infinite loop
    // (reproduced: 43 stacked overlays within 500ms without this guard).
    if (t.closest(`[${OVERLAY}]`)) return;
    if (!S.viewerAutoEnabled || S.viewerAuto === "off" || fmt || autoSeen.has(t)) return;
    const r = t.getBoundingClientRect();
    if (r.width < 200 || r.height < 112) return; // thumbnails/previews don't count
    autoSeen.add(t);
    enter(S.viewerAuto, t, { mirrorOnly: true });
  },
  true,
);

async function enter(
  format: ViewerFormat,
  target?: HTMLVideoElement,
  opts: { mirrorOnly?: boolean } = {},
): Promise<void> {
  if (window.top !== window) return;
  const v = target ?? primaryVideo();
  if (!v || currentFullscreenElement() || fmt || exiting || overlay || isDrmVideo(v)) return;
  const firstRect = v.getBoundingClientRect();
  const mirror = createMirror(v);
  if (!mirror && opts.mirrorOnly) return;
  document.dispatchEvent(new Event(CLOSE_EVENT));
  fmt = format;
  video = v;
  surfaceVideo = null;
  backdropEl = null;
  surfaceShell = null;
  mirrored = false;
  if (!mirror) mirrorStream = null;
  sourceParent = null;
  sourceNextSibling = null;
  sourceRect = firstRect;
  normalBox = null;
  prevCss = v.style.cssText;
  prevSourceVisibility = "";
  prevSourceVisibilityPriority = "";
  prevControls = v.controls;
  overlay = document.createElement("div");
  overlay.setAttribute(OVERLAY, "");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: Z_OVERLAY,
    overflow: "hidden",
    contain: "layout style paint",
  } as Partial<CSSStyleDeclaration>);
  overlay.tabIndex = -1;
  document.body.appendChild(overlay);
  backdropEl = document.createElement("div");
  Object.assign(backdropEl.style, {
    position: "absolute",
    inset: `-${BACKDROP_OVERSCAN}px`,
    opacity: "0",
    pointerEvents: "none",
    willChange: "opacity, backdrop-filter",
  } as Partial<CSSStyleDeclaration>);
  overlay.appendChild(backdropEl);
  surfaceShell = document.createElement("div");
  Object.assign(surfaceShell.style, {
    position: "absolute",
    overflow: "hidden",
    zIndex: "1",
    background: "#000",
  } as Partial<CSSStyleDeclaration>);
  overlay.appendChild(surfaceShell);
  hookGlobal();
  // Chapters depend on the SITE player's UI, so read them before the video
  // leaves it.
  pendingChapters =
    isYouTube() && Number.isFinite(v.duration) ? readYouTubeChapters(v.duration) : [];
  if (mirror) {
    mirrored = true;
    surfaceVideo = mirror;
    hideMirroredSource(v);
    surfaceShell.appendChild(mirror);
  } else {
    sourceParent = v.parentNode;
    sourceNextSibling = v.nextSibling;
    holder = document.createComment("vtp-viewer-holder");
    v.parentNode?.insertBefore(holder, v);
    surfaceVideo = v;
    v.setAttribute(ADOPTED_VIDEO, "");
    surfaceShell.appendChild(v);
    v.controls = false; // ours replace them; the site's flag is restored on exit
  }
  mountBar();
  prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  // Session-scoped wiring, all dropped at once on exit.
  media = new AbortController();
  const opt = { signal: media.signal };
  wireVideo(v);
  overlay.addEventListener("mousemove", showBar, { passive: true, signal: media.signal });
  // A press on the dim (not on the video or the bar) closes.
  overlay.addEventListener(
    "pointerdown",
    (e) => {
      if (e.target === overlay) exitViewer();
    },
    opt,
  );
  layoutPaused = true;
  setFormat(format);
  dispatchViewerLayout();
  animateBackdropIn();
  const enterAnim = animateSurfaceFrom(frameFromRect(firstRect));
  syncPlay();
  syncVolume();
  syncTime();
  if (!enterAnim) {
    layoutPaused = false;
    notifyViewerLayout();
    showBar();
  }
  loadMarkers();
  refreshQuality();
  guardTimer = setInterval(guard, 500);
}

export function exitViewer(): void {
  if (!fmt || exiting) return;
  exiting = true;
  // Stays paused for the whole close transition — same as enter() — so the
  // launcher doesn't reposition itself off a video mid-shrink/mid-restore.
  // finish() below clears it once the video is truly back in its original spot.
  layoutPaused = true;
  const exitingOverlay = overlay;
  const targetRect = mirrored && video ? video.getBoundingClientRect() : sourceRect;
  const surfaceAnim = animateSurfaceTo(targetRect);
  const backdropAnim = animateBackdropOut(targetRect);
  const animated = !!surfaceAnim || !!backdropAnim;
  fmt = null;
  document.documentElement.removeAttribute(ATTR);
  document.documentElement.style.overflow = prevOverflow;
  notifyViewerState();
  bar?.animate?.([{ opacity: 1 }, { opacity: 0 }], {
    duration: Math.min(160, VIEWER_ANIM_MS),
    easing: "ease",
    fill: "forwards",
  });

  const finish = () => {
    if (guardTimer != null) {
      clearInterval(guardTimer);
      guardTimer = null;
    }
    clearTimeout(barTimer);
    clearTimeout(barVisibilityTimer);
    media?.abort();
    media = null;
    styleGuard?.disconnect();
    styleGuard = null;
    pendingChapters = [];
    marksLoaded = false;
    marksSourceKey = "";
    markerRanges = [];
    activeMarker = null;
    if (video) {
      autoSeen.add(video); // closing means "not this one again"
      if (mirrored) {
        restoreMirroredSource(video);
      } else {
        video.removeAttribute(ADOPTED_VIDEO);
        video.controls = prevControls;
        video.style.cssText = prevCss;
      }
      // Prefer the exact comment spot. If a site removed only that marker while
      // keeping the original parent, fall back to the saved parent/sibling so
      // closing the viewer does not discard the only page video with the overlay.
      if (!mirrored && holder?.isConnected && video.parentElement === surfaceShell) {
        holder.parentNode?.insertBefore(video, holder);
      } else if (!mirrored && sourceParent?.isConnected && video.parentElement === surfaceShell) {
        if (sourceNextSibling?.parentNode === sourceParent) {
          sourceParent.insertBefore(video, sourceNextSibling);
        } else {
          sourceParent.appendChild(video);
        }
      }
    }
    mirrorStream?.getTracks().forEach((t) => t.stop());
    mirrorStream = null;
    removeBackdropVideo();
    if (video && qualityVideoId) video.removeAttribute("data-vtp-quality-id");
    qualityVideoId = "";
    document.documentElement.removeAttribute(QUALITY_REQ_ATTR);
    document.documentElement.removeAttribute(QUALITY_VIDEO_ATTR);
    document.documentElement.removeAttribute(QUALITY_PICK_ATTR);
    document.documentElement.removeAttribute(QUALITY_RESP_ATTR);
    holder?.remove();
    holder = null;
    sourceParent = null;
    sourceNextSibling = null;
    exitingOverlay?.remove();
    if (overlay === exitingOverlay) overlay = null;
    backdropEl = null;
    backdropVideo = null;
    surfaceShell = null;
    bar = null;
    playBtn = muteBtn = fmtBtn = null;
    seekEl = seekWrapEl = volEl = null;
    timeEl = null;
    fitMenu = null;
    qualityWrap = null;
    qualityBtn = null;
    qualityLabelEl = null;
    qualityMenu = null;
    pendingQuality = null;
    pendingQualityUntil = 0;
    marksEl = null;
    markerTipEl = null;
    seeking = false;
    normalBox = null;
    sourceRect = null;
    layoutPaused = false;
    exiting = false;
    surfaceVideo = null;
    mirrored = false;
    video = null;
    // Players re-measure on resize — let the restored one lay itself out.
    window.dispatchEvent(new Event("resize"));
    notifyViewerLayout();
    // Some site players (YouTube's included) don't finish re-laying the
    // returned video out in the same tick — a launcher position measured right
    // now can grab a transitional rect and stick there. One more pass shortly
    // after catches it once the page has actually settled.
    setTimeout(notifyViewerLayout, 300);
  };

  if (animated)
    void Promise.all([waitAnimation(surfaceAnim), waitAnimation(backdropAnim)]).then(finish);
  else finish();
}

// The hotkey/button entry point. Closed → open in `format`; open in the other
// format → switch; open in the same format → close. So V and T each toggle
// their own view and jump straight between the two.
export function toggleViewer(format: ViewerFormat): void {
  if (!S.viewerAutoEnabled) return;
  if (fmt) {
    if (fmt === format) exitViewer();
    else setFormat(format);
    return;
  }
  const active = viewerFormat();
  if (active) {
    document.dispatchEvent(new Event(CLOSE_EVENT));
    if (active !== format)
      setTimeout(() => {
        if (!viewerFormat()) void enter(format);
      }, 0);
    return;
  }
  enter(format);
}
