// Pop-out video viewer. It moves the page's actual <video> into our overlay and
// restores it on exit. Rendering the original element keeps the browser's native
// video/audio clock intact; using captureStream() for the primary picture caused
// visible frame drops and A/V drift on real players.
import { S } from "./state.js";
import { isDrmVideo, primaryVideo } from "./videos.js";
import {
  isYouTube,
  youTubeVideoId,
  readYouTubeChapters,
  fetchSponsorSegments,
  SPONSOR_COLORS,
} from "./markers.js";
import { api } from "./platform/browser.js";
import { addFullscreenChangeListener, currentFullscreenElement } from "./platform/fullscreen.js";
import { i18n } from "./platform/i18n.js";
import { ensureGlassFilter, GLASS_REFRACTION } from "../shared/glass.js";
import { isLive, isVkLiveChannelPage, onStreamPage } from "./live/detection.js";
import { normalizeViewerFit, type ViewerFitMode } from "./core/resolve.js";
import { showBadgeNotice } from "./badge/overlay.js";
import { LAUNCHER_TOP_LAYER_ATTR, listenerObjectOptions, listenerOptions } from "./lifecycle.js";

export type ViewerFormat = "normal" | "theater";
export const VIEWER_LAYOUT_EVENT = "vtp-viewer-layout";

const ATTR = "data-vtp-viewer"; // on <html>: "normal" | "theater" — state marker
const OVERLAY = "data-vtp-viewer-overlay";
const ADOPTED_VIDEO = "data-vtp-viewer-adopted-video";
const PLAYER_SURFACE = "data-vtp-viewer-player";
const PLAYER_SURFACE_FORMAT = "data-vtp-viewer-player-format";
const PLAYER_SURFACE_VIDEO = "data-vtp-viewer-player-video";
const FRACTION = 0.86; // the normal box's share of the viewport
const BAR_HIDE_MS = 2600; // control-bar auto-hide, mirrors the launcher FAB
const CLOSE_EVENT = "vtp-viewer-close";
const VIEWER_ANIM_MS = 420;
const VIEWER_BACKDROP_VIDEO_ANIM_MS = 680;
const VIEWER_PLAYBACK_ANIM_MS = 300;
const VIEWER_PLAYBACK_BACKDROP_VIDEO_ANIM_MS = 480;
const VIEWER_PLAYBACK_STABLE_MS = 250;

function viewerAnimationMs(): number {
  return autoOpenedSession && S.viewerAutoPlaybackOnly ? VIEWER_PLAYBACK_ANIM_MS : VIEWER_ANIM_MS;
}

function viewerBackdropVideoAnimationMs(): number {
  return autoOpenedSession && S.viewerAutoPlaybackOnly
    ? VIEWER_PLAYBACK_BACKDROP_VIDEO_ANIM_MS
    : VIEWER_BACKDROP_VIDEO_ANIM_MS;
}
// The moving backdrop is blurred heavily, so full media cadence and resolution
// only waste GPU/CPU time. Keep it deliberately coarse while the primary video
// remains the original, full-rate media element.
const BACKDROP_FPS = 10;
const BACKDROP_CAPTURE_MAX_FPS = 15;
const BACKDROP_CANVAS_SCALE = 0.1;
const BACKDROP_CANVAS_MS = Math.round(1000 / BACKDROP_FPS);
const BACKDROP_CANVAS_FILTER = "blur(3px) saturate(150%) brightness(72%) contrast(116%)";
const NORMAL_BACKDROP_FILTER = "blur(28px) saturate(150%) brightness(0.72) contrast(1.16)";
const NORMAL_SURFACE_SHADOW =
  "0 0 0 1px rgba(255,255,255,0.2)," +
  "inset 0 1px 0 rgba(255,255,255,0.08)," +
  "0 40px 120px rgba(0,0,0,0.74),0 12px 36px rgba(0,0,0,0.48)";
// A CSS/backdrop-filter blur can't invent pixels past its own box, so an element
// blurred exactly at the viewport edge fades toward whatever's behind it there —
// a visible vignette right at the screen border. Overscanning the box (then
// letting the overlay's overflow:hidden crop it back to the viewport) hides that
// fade off-screen instead. Comfortably more than 2× the largest blur radius used
// (14/28px) so the fade-out never reaches the visible edge.
const BACKDROP_OVERSCAN = 64;

// The overlay sits under the speed badge (…646) and the launcher FAB with its
// radial menu (…647), so both remain usable over the popped-out video.
const Z_OVERLAY = "2147483643";

let fmt: ViewerFormat | null = null;
let video: HTMLVideoElement | null = null; // the page media element we control
let videoAutoIdentity = ""; // route/media identity captured when this viewer session opened
let playbackFollowArmTimer: ReturnType<typeof setTimeout> | null = null;
let playbackFollowArmed = false;
// Capture the page-level verdict before Viewer hides/adopts the source. Some
// MSE players (VK Video Live in particular) temporarily drop duration and
// seekable ranges while captureStream() is attached, which otherwise turns a
// confirmed live stream into a misleading 0:00 loading timeline.
let liveAtViewerEntry = false;
// Stronger than the generic media-element live heuristic: this is set only by
// the popup's page verdict or by a recognised live page sitting at its edge.
// It lets an actual broadcast beat a seekable range without turning every
// large-duration DVR-like element into the compact live layout.
let liveLayoutAtViewerEntry = false;
let surfaceVideo: HTMLVideoElement | null = null; // the overlay video we render/style
let overlay: HTMLDivElement | null = null;
let backdropEl: HTMLDivElement | null = null;
let backdropVideo: HTMLVideoElement | HTMLCanvasElement | null = null;
let backdropCanvasTimer: ReturnType<typeof setTimeout> | null = null;
let surfaceShell: HTMLDivElement | null = null;
let playerSurface: HTMLElement | null = null;
let playerSurfaceStyle: HTMLStyleElement | null = null;
let playerSurfaceToggle: ((e: Event) => void) | null = null;
let playerSurfaceObserver: MutationObserver | null = null;
let loadingEl: HTMLDivElement | null = null;
let loadingShown = false;
let holder: Comment | null = null; // marks the video's original DOM spot
let sourceParent: Node | null = null;
let sourceNextSibling: Node | null = null;
let prevCss = ""; // the video's inline style before we took over
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
let seekWrapRect: DOMRect | null = null;
// Chapters are read from the site player's own progress bar BEFORE the video
// is adopted — YouTube tears its player UI down once the element leaves.
let pendingChapters: { start: number; title: string }[] = [];
// Sites (YouTube) keep rewriting their video's inline style, clobbering ours —
// a plain style write drops even !important declarations. Re-assert on sight.
let styleGuard: MutationObserver | null = null;
let styleGuardFrame: ReturnType<typeof requestAnimationFrame> | null = null;
let desiredCss = "";
let desiredShellCss = "";
let normalBox: { w: number; h: number; vw: number; vh: number; fromMetadata: boolean } | null =
  null;
let surfaceTransition: Animation | null = null;
let surfaceTransitionTimer: ReturnType<typeof setTimeout> | null = null;
let nativeSurfaceTransitionTimer: ReturnType<typeof setTimeout> | null = null;
let nativeSurfaceTransitionToken = 0;
let postRestoreLayoutTimer: ReturnType<typeof setTimeout> | null = null;
let surfaceTransitionToken = 0;
let backdropStream: MediaStream | null = null;
let sourceRect: DOMRect | null = null;
let layoutPaused = false;
let exiting = false;
// Some native players (notably YouTube) briefly pause when their existing
// player root enters the browser's top layer. If playback was active before
// opening the viewer, allow one short, one-shot resume during that transition;
// never fight a later user pause.
let resumeSurfacePlaybackUntil = 0;
let resumeSurfacePlaybackUsed = false;

let fitMenu: HTMLDivElement | null = null;
let fitBtn: HTMLButtonElement | null = null;
let qualityWrap: HTMLSpanElement | null = null;
let qualityBtn: HTMLButtonElement | null = null;
let qualityLabelEl: HTMLSpanElement | null = null;
let qualityMenu: HTMLDivElement | null = null;
let qualityReq = 0;
let qualityVideoId = "";
let pendingQuality: QualityOption | null = null;
let pendingQualityUntil = 0;
let viewerSession = 0;
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

document.addEventListener(CLOSE_EVENT, () => exitViewer(), listenerOptions());
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
    if (
      S.keyboardEnabled &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey &&
      e.code === S.keymap.hold
    )
      return;
    if (e.key === "Escape") {
      if (closeViewerMenus()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (document.documentElement.hasAttribute(LAUNCHER_TOP_LAYER_ATTR)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      exitViewer();
      return;
    }
    if (e.key === "Tab") {
      closeViewerMenus();
      trapViewerFocus(e);
      return;
    }
    if (!S.keyboardEnabled) return;
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
      const pct = String(Math.round(next * 100));
      showBadgeNotice(
        video.muted
          ? notice("viewerNoticeMuted", "Muted")
          : notice("viewerNoticeVolume", `Volume ${pct}%`, pct),
      );
    }
  },
  listenerOptions(true),
);

function viewerFocusable(): HTMLElement[] {
  if (!overlay) return [];
  const roots: Array<Document | ShadowRoot | HTMLElement> = [overlay];
  overlay.querySelectorAll<HTMLElement>("*").forEach((el) => {
    if (el.shadowRoot) roots.push(el.shadowRoot);
  });
  const nodes: HTMLElement[] = [];
  for (const root of roots) {
    nodes.push(
      ...Array.from(
        root.querySelectorAll<HTMLElement>(
          'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
        ),
      ),
    );
  }
  return nodes.filter((el) => {
    if (el.tabIndex < 0 || el.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

function trapViewerFocus(e: KeyboardEvent): void {
  if (!overlay) return;
  const items = viewerFocusable();
  if (!items.length) {
    e.preventDefault();
    overlay.focus({ preventScroll: true });
    return;
  }
  const shadowActive = Array.from(overlay.querySelectorAll<HTMLElement>("*"))
    .map((el) => el.shadowRoot?.activeElement)
    .find((el): el is Element => !!el);
  const active = shadowActive ?? document.activeElement;
  const current = items.findIndex((el) => el === active);
  const next =
    current < 0
      ? e.shiftKey
        ? items.length - 1
        : 0
      : e.shiftKey
        ? (current - 1 + items.length) % items.length
        : (current + 1) % items.length;
  e.preventDefault();
  e.stopImmediatePropagation();
  items[next].focus({ preventScroll: true });
}

export function viewerFormat(): ViewerFormat | null {
  const dom = document.documentElement.getAttribute(ATTR);
  if (fmt) return fmt;
  if ((dom === "normal" || dom === "theater") && document.querySelector(`[${OVERLAY}]`)) return dom;
  return null;
}

export function setViewerState(format: ViewerFormat | "off", liveHint = false): void {
  if (format === "off") {
    if (fmt) exitViewer();
    else document.dispatchEvent(new Event(CLOSE_EVENT));
    return;
  }
  if (!S.viewerAutoEnabled) return;
  if (viewerFormat() === format) return;
  if (fmt) {
    markViewerSessionManual();
    setFormat(format);
  } else {
    document.dispatchEvent(new Event(CLOSE_EVENT));
    void enter(format, undefined, { liveHint });
  }
}

export function viewerAnchorVideo(): HTMLElement | null {
  if (!viewerFormat()) return null;
  if (playerSurface?.isConnected) return playerSurface;
  if (surfaceShell?.isConnected) return surfaceShell;
  if (surfaceVideo?.isConnected) return surfaceVideo;
  const overlayEl = document.querySelector(`[${OVERLAY}]`);
  const fallback = Array.from(overlayEl?.children ?? []).find(
    (el) =>
      el instanceof HTMLElement && el.querySelector("video:not([data-vtp-viewer-backdrop-video])"),
  );
  return fallback instanceof HTMLElement ? fallback : null;
}

type PopoverPlayer = HTMLElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
};

function playerSurfaceCandidate(v: HTMLVideoElement): PopoverPlayer | null {
  const videoRect = v.getBoundingClientRect();
  if (videoRect.width < 40 || videoRect.height < 40) return null;

  // YouTube's player root owns its native controls and already responds to box
  // resizes. For other sites, walk only within the video's current DOM root and
  // pick the highest wrapper that still has player-like dimensions.
  const youtube = v.closest(".html5-video-player");
  let candidate = youtube instanceof HTMLElement ? youtube : null;
  if (!candidate) {
    let current = v.parentElement;
    for (let depth = 0; current && depth < 8; depth++, current = current.parentElement) {
      if (current === document.body || current === document.documentElement) break;
      const rect = current.getBoundingClientRect();
      const playerSized =
        rect.width >= videoRect.width * 0.8 &&
        rect.height >= videoRect.height * 0.8 &&
        rect.width <= videoRect.width * 1.4 &&
        rect.height <= videoRect.height * 1.6;
      if (!playerSized) break;
      candidate = current;
    }
  }
  if (!candidate || candidate.hasAttribute("popover")) return null;
  const popover = candidate as PopoverPlayer;
  return typeof popover.showPopover === "function" && typeof popover.hidePopover === "function"
    ? popover
    : null;
}

function mountPlayerSurface(v: HTMLVideoElement): boolean {
  const candidate = playerSurfaceCandidate(v);
  if (!candidate) return false;
  const root = candidate.getRootNode();
  if (!(root instanceof Document || root instanceof ShadowRoot)) return false;

  const style = document.createElement("style");
  style.textContent =
    `[${PLAYER_SURFACE}]:popover-open{display:block!important;position:fixed!important;` +
    `box-sizing:border-box!important;margin:0!important;padding:0!important;border:0!important;` +
    `max-width:none!important;max-height:none!important;overflow:hidden!important;background:#000!important;` +
    `visibility:var(--vtp-viewer-motion-visibility,visible)!important;` +
    `will-change:var(--vtp-viewer-motion-will-change,auto)!important;` +
    `transition:var(--vtp-viewer-motion-transition,none)!important;` +
    `transform-origin:var(--vtp-viewer-motion-origin,center)!important}` +
    `[${PLAYER_SURFACE}][${PLAYER_SURFACE_FORMAT}="theater"]:popover-open{` +
    `inset:auto!important;left:var(--vtp-viewer-motion-left,0px)!important;` +
    `top:var(--vtp-viewer-motion-top,0px)!important;right:auto!important;bottom:auto!important;` +
    `width:var(--vtp-viewer-motion-width,100vw)!important;` +
    `height:var(--vtp-viewer-motion-height,100vh)!important;` +
    `transform:var(--vtp-viewer-motion-transform,none)!important;` +
    `border-radius:0!important;box-shadow:none!important}` +
    `[${PLAYER_SURFACE}][${PLAYER_SURFACE_FORMAT}="normal"]:popover-open{` +
    `inset:auto!important;left:var(--vtp-viewer-motion-left,50%)!important;` +
    `top:var(--vtp-viewer-motion-top,50%)!important;right:auto!important;bottom:auto!important;` +
    `width:var(--vtp-viewer-motion-width,var(--vtp-viewer-width))!important;` +
    `height:var(--vtp-viewer-motion-height,var(--vtp-viewer-height))!important;` +
    `transform:var(--vtp-viewer-motion-transform,translate(-50%,-50%))!important;border-radius:12px!important;` +
    `box-shadow:${NORMAL_SURFACE_SHADOW}!important}` +
    `[${PLAYER_SURFACE}] [${PLAYER_SURFACE_VIDEO}]{position:absolute!important;inset:0!important;` +
    `width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;` +
    `display:block!important;visibility:visible!important;opacity:1!important;` +
    `margin:0!important;padding:0!important;border:0!important;transform:none!important;` +
    `object-fit:var(--vtp-viewer-fit)!important}` +
    // YouTube keeps the video in a zero-height relative wrapper. Percentage
    // heights on the video then resolve to zero after we resize the player
    // popover, even though decoding continues and native controls remain. Size
    // the media against the known surface box instead of its intermediate
    // containing block so the painted frame cannot collapse.
    `[${PLAYER_SURFACE}][${PLAYER_SURFACE_FORMAT}="normal"] [${PLAYER_SURFACE_VIDEO}]{` +
    `width:var(--vtp-viewer-width)!important;height:var(--vtp-viewer-height)!important}` +
    `[${PLAYER_SURFACE}][${PLAYER_SURFACE_FORMAT}="theater"] [${PLAYER_SURFACE_VIDEO}]{` +
    `width:100vw!important;height:100vh!important}` +
    `[${PLAYER_SURFACE}]::backdrop{background:transparent!important;pointer-events:none!important}`;
  if (root instanceof Document) (root.head ?? root.documentElement).appendChild(style);
  else root.appendChild(style);

  candidate.setAttribute(PLAYER_SURFACE, "");
  candidate.setAttribute("popover", "manual");
  candidate.style.setProperty("--vtp-viewer-motion-visibility", "hidden");
  v.setAttribute(PLAYER_SURFACE_VIDEO, "");
  try {
    candidate.showPopover?.();
    if (!candidate.matches(":popover-open")) throw new Error("player popover did not open");
  } catch {
    candidate.removeAttribute(PLAYER_SURFACE);
    candidate.removeAttribute(PLAYER_SURFACE_FORMAT);
    candidate.removeAttribute("popover");
    candidate.style.removeProperty("--vtp-viewer-motion-visibility");
    v.removeAttribute(PLAYER_SURFACE_VIDEO);
    style.remove();
    return false;
  }
  playerSurface = candidate;
  playerSurfaceStyle = style;
  surfaceVideo = v;
  playerSurfaceToggle = (e: Event) => {
    if ((e as { newState?: string }).newState !== "closed") return;
    if (playerSurface !== candidate) return;
    // beforetoggle fires synchronously inside the hide algorithm, where
    // re-showing is not allowed yet. A microtask runs right after the hide
    // completes but still before the next paint, so the closed state never
    // reaches the screen. The plain toggle handler stays as a fallback for
    // engines that only deliver the queued event.
    if (e.type === "beforetoggle") queueMicrotask(recoverPlayerSurface);
    else recoverPlayerSurface();
  };
  candidate.addEventListener("beforetoggle", playerSurfaceToggle);
  candidate.addEventListener("toggle", playerSurfaceToggle);
  // Reparenting (YouTube's playerAttach moves the player into the hydrated
  // watch layout) hides the popover SILENTLY — no toggle events fire for a
  // disconnected element. The mutation observer sees the reinsertion in the
  // same mutation batch, and its callback runs as a microtask before the next
  // render, so re-showing here keeps the closed popover from ever painting.
  playerSurfaceObserver = new MutationObserver(() => {
    const surface = playerSurface;
    if (surface !== candidate || !fmt || exiting) return;
    if (!surface.isConnected) return; // mid-migration — wait for the reinsertion
    let open = false;
    try {
      open = surface.matches(":popover-open");
    } catch {}
    if (!open) recoverPlayerSurface();
  });
  playerSurfaceObserver.observe(document.documentElement, { childList: true, subtree: true });
  return true;
}

// YouTube rebuilds its top layer while a page is still loading or navigating,
// which force-closes every open popover — ours included. That closure is not a
// user action: put the surface back instead of tearing the session down. The
// per-session cap concedes to a player that actively fights the popover.
const MAX_SURFACE_RESHOWS = 6;
let surfaceReshows = 0;
function reshowPlayerSurface(): boolean {
  const surface = playerSurface as PopoverPlayer | null;
  if (!surface || !fmt || exiting) return false;
  try {
    if (surface.matches(":popover-open")) return true; // already recovered
  } catch {}
  if (!surface.isConnected || surfaceReshows >= MAX_SURFACE_RESHOWS) return false;
  surfaceReshows++;
  try {
    surface.showPopover?.();
    if (!surface.matches(":popover-open")) return false;
  } catch {
    return false;
  }
  notifyViewerLayout();
  return true;
}

function recoverPlayerSurface(): void {
  if (!playerSurface || !fmt || exiting) return; // no session to recover
  if (!reshowPlayerSurface()) involuntaryExitViewer();
}

function unmountPlayerSurface(): void {
  const surface = playerSurface as PopoverPlayer | null;
  if (surface) {
    if (playerSurfaceToggle) {
      surface.removeEventListener("beforetoggle", playerSurfaceToggle);
      surface.removeEventListener("toggle", playerSurfaceToggle);
    }
    try {
      if (surface.matches(":popover-open")) surface.hidePopover?.();
    } catch {}
    surface.removeAttribute(PLAYER_SURFACE);
    surface.removeAttribute(PLAYER_SURFACE_FORMAT);
    surface.removeAttribute("popover");
    surface.style.removeProperty("--vtp-viewer-fit");
    surface.style.removeProperty("--vtp-viewer-width");
    surface.style.removeProperty("--vtp-viewer-height");
    clearNativeSurfaceMotion(surface);
  }
  video?.removeAttribute(PLAYER_SURFACE_VIDEO);
  playerSurfaceObserver?.disconnect();
  playerSurfaceObserver = null;
  playerSurfaceStyle?.remove();
  playerSurfaceStyle = null;
  playerSurface = null;
  playerSurfaceToggle = null;
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
  if (typeof document === "undefined") return;
  document.dispatchEvent(new Event(VIEWER_LAYOUT_EVENT));
}

function notifyViewerLayout(): void {
  if (layoutPaused) return;
  dispatchViewerLayout();
}

function cancelPostRestoreLayout(): void {
  if (postRestoreLayoutTimer == null) return;
  clearTimeout(postRestoreLayoutTimer);
  postRestoreLayoutTimer = null;
}

function applyOverlayBackdrop(): void {
  if (!backdropEl || !fmt) return;
  if (fmt === "normal" && S.viewerBackdropVideo) syncViewerBackdropVideo();
  else removeBackdropVideo();
  backdropEl.style.setProperty("--glass-opacity", String(S.glassOpacity));
  if (fmt === "theater") {
    backdropEl.style.background = "rgba(0, 0, 0, 0.92)";
    backdropEl.style.removeProperty("-webkit-backdrop-filter");
    backdropEl.style.backdropFilter = "";
  } else {
    // Keep the moving mirror recognisable while giving the primary player a
    // distinct visual plane. The centre stays lightly veiled and the edges fall
    // off more decisively, which also avoids a flat grey wash on dark footage.
    backdropEl.style.background =
      "radial-gradient(ellipse at center," +
      "rgb(8 8 10 / calc(0.08 * var(--glass-opacity,1))) 0%," +
      "rgb(2 2 4 / calc(0.5 * var(--glass-opacity,1))) 100%)";
    if (S.viewerBackdropVideo && backdropVideo) {
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
  backdropStream?.getTracks().forEach((track) => track.stop());
  backdropStream = null;
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
    // More blur separates the duplicate image from the player. Contrast and
    // saturation retain colour in the backdrop; lower brightness leaves the
    // unfiltered primary video visually dominant.
    // Blurring a viewport-sized layer on every canvas update stalls the primary
    // video compositor on some GPUs. Canvas frames are pre-filtered at their tiny
    // internal resolution; only the rare captureStream fallback needs CSS blur.
    filter: el instanceof HTMLCanvasElement ? "none" : NORMAL_BACKDROP_FILTER,
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
    ctx.filter = BACKDROP_CANVAS_FILTER;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
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

document.addEventListener(
  "visibilitychange",
  () => {
    if (document.hidden) {
      if (backdropCanvasTimer != null) {
        clearTimeout(backdropCanvasTimer);
        backdropCanvasTimer = null;
      }
    } else {
      scheduleBackdropCanvas();
    }
  },
  listenerOptions(),
);

function createBackdropVideoFallback(): HTMLVideoElement | null {
  const stream = ensureBackdropStream();
  if (!overlay || !backdropEl || !stream) return null;
  const videoEl = document.createElement("video");
  videoEl.srcObject = stream;
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
  if (!overlay || !backdropEl || fmt !== "normal" || !S.viewerBackdropVideo) {
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
      canvas.remove();
      backdropVideo = null;
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
    duration: viewerBackdropVideoAnimationMs(),
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
      duration: viewerBackdropVideoAnimationMs(),
      easing: "cubic-bezier(0.4, 0, 1, 1)",
      fill: "forwards",
    });
  }
  setBackdropVideoViewport("1");
  backdropVideo.getBoundingClientRect();
  const anim = backdropVideo.animate([viewportFrame(1), backdropVideoTransformFrame(target, 0)], {
    duration: viewerBackdropVideoAnimationMs(),
    easing: "cubic-bezier(0.4, 0, 1, 1)",
    fill: "forwards",
  });
  anim.onfinish = () => {
    if (backdropVideo) backdropVideo.style.opacity = "0";
  };
  return anim;
}

function animateBackdropIn(
  delay = viewerAnimationMs() === VIEWER_PLAYBACK_ANIM_MS ? 120 : 190,
): void {
  const duration = viewerAnimationMs();
  const keyframes: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
  const options: KeyframeAnimationOptions = {
    delay,
    duration: duration - Math.min(delay, duration - 80),
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
    duration: viewerAnimationMs(),
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
  const duration = viewerAnimationMs();
  const anim = shell.animate([rectFrame(first.rect, first.radius), rectFrame(last, finalRadius)], {
    duration,
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
  surfaceTransitionTimer = window.setTimeout(settle, duration + 80);
  return anim;
}

function animateSurfaceTo(target: DOMRect | null): Animation | null {
  const shell = surfaceShell;
  if (!canAnimate(shell)) return null;
  const firstFrame = interruptSurfaceTransition();
  const first = firstFrame?.rect ?? shell.getBoundingClientRect();
  const duration = viewerAnimationMs();
  if (!visibleRect(first) || !visibleRect(target)) {
    return shell.animate(
      [
        { opacity: 1, transform: shell.style.transform || "none" },
        { opacity: 0, transform: `${shell.style.transform || "none"} scale(.96)` },
      ],
      {
        duration,
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
    duration,
    easing: "cubic-bezier(0.4, 0, 1, 1)",
    fill: "forwards",
  });
  return anim;
}

type SurfaceTransition = Animation | Promise<void> | null;

const NATIVE_MOTION_PROPERTIES = [
  "--vtp-viewer-motion-left",
  "--vtp-viewer-motion-top",
  "--vtp-viewer-motion-width",
  "--vtp-viewer-motion-height",
  "--vtp-viewer-motion-transform",
  "--vtp-viewer-motion-origin",
  "--vtp-viewer-motion-will-change",
  "--vtp-viewer-motion-transition",
  "--vtp-viewer-motion-visibility",
] as const;

function clearNativeSurfaceMotion(surface: HTMLElement | null = playerSurface): void {
  if (!surface) return;
  for (const property of NATIVE_MOTION_PROPERTIES) surface.style.removeProperty(property);
}

function interruptNativeSurfaceTransition(): DOMRect | null {
  const surface = playerSurface;
  const frame = surface?.getBoundingClientRect() ?? null;
  nativeSurfaceTransitionToken++;
  if (nativeSurfaceTransitionTimer != null) {
    clearTimeout(nativeSurfaceTransitionTimer);
    nativeSurfaceTransitionTimer = null;
  }
  clearNativeSurfaceMotion(surface);
  return visibleRect(frame) ? frame : null;
}

function setNativeSurfaceMotionBox(surface: HTMLElement, rect: DOMRect): void {
  surface.style.setProperty("--vtp-viewer-motion-left", `${rect.left}px`);
  surface.style.setProperty("--vtp-viewer-motion-top", `${rect.top}px`);
  surface.style.setProperty("--vtp-viewer-motion-width", `${rect.width}px`);
  surface.style.setProperty("--vtp-viewer-motion-height", `${rect.height}px`);
  surface.style.setProperty("--vtp-viewer-motion-origin", "0 0");
  surface.style.setProperty("--vtp-viewer-motion-will-change", "transform");
}

function transformBetweenRects(from: DOMRect, to: DOMRect): string {
  const scaleX = Math.max(0.01, from.width / to.width);
  const scaleY = Math.max(0.01, from.height / to.height);
  return `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${scaleX}, ${scaleY})`;
}

function animateNativeSurfaceFrom(first: DOMRect | null): Promise<void> | null {
  const surface = playerSurface;
  if (!surface || !visibleRect(first)) {
    clearNativeSurfaceMotion(surface);
    return null;
  }
  const last = surface.getBoundingClientRect();
  if (!visibleRect(last)) {
    clearNativeSurfaceMotion(surface);
    return null;
  }
  const token = ++nativeSurfaceTransitionToken;
  setNativeSurfaceMotionBox(surface, last);
  surface.style.setProperty("--vtp-viewer-motion-transition", "none");
  surface.style.setProperty("--vtp-viewer-motion-transform", transformBetweenRects(first, last));
  surface.style.setProperty("--vtp-viewer-motion-visibility", "visible");
  surface.getBoundingClientRect();
  layoutPaused = true;
  const duration = viewerAnimationMs();
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      if (token !== nativeSurfaceTransitionToken || playerSurface !== surface) return;
      surface.style.setProperty(
        "--vtp-viewer-motion-transition",
        `transform ${duration}ms cubic-bezier(0.2, 0, 0, 1)`,
      );
      surface.style.setProperty("--vtp-viewer-motion-transform", "translate(0, 0) scale(1)");
      nativeSurfaceTransitionTimer = setTimeout(() => {
        if (token !== nativeSurfaceTransitionToken || playerSurface !== surface) return;
        nativeSurfaceTransitionTimer = null;
        clearNativeSurfaceMotion(surface);
        layoutPaused = false;
        notifyViewerLayout();
        resolve();
      }, duration + 60);
    });
  });
}

function animateNativeSurfaceTo(target: DOMRect | null): Promise<void> | null {
  const surface = playerSurface;
  const first = interruptNativeSurfaceTransition();
  if (!surface || !visibleRect(first) || !visibleRect(target)) return null;
  const token = ++nativeSurfaceTransitionToken;
  setNativeSurfaceMotionBox(surface, first);
  surface.style.setProperty("--vtp-viewer-motion-transition", "none");
  surface.style.setProperty("--vtp-viewer-motion-transform", "translate(0, 0) scale(1)");
  surface.style.setProperty("--vtp-viewer-motion-visibility", "visible");
  surface.getBoundingClientRect();
  const duration = viewerAnimationMs();
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      if (token !== nativeSurfaceTransitionToken || playerSurface !== surface) return;
      surface.style.setProperty(
        "--vtp-viewer-motion-transition",
        `transform ${duration}ms cubic-bezier(0.4, 0, 1, 1)`,
      );
      surface.style.setProperty(
        "--vtp-viewer-motion-transform",
        transformBetweenRects(target, first),
      );
      nativeSurfaceTransitionTimer = setTimeout(() => {
        if (token !== nativeSurfaceTransitionToken || playerSurface !== surface) return;
        nativeSurfaceTransitionTimer = null;
        resolve();
      }, duration + 60);
    });
  });
}

function waitAnimation(anim: Animation | null): Promise<void> {
  if (!anim) return Promise.resolve();
  const finish = anim.onfinish;
  const cancel = anim.oncancel;
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(complete, viewerAnimationMs() + 180);
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

function waitSurfaceTransition(transition: SurfaceTransition): Promise<void> {
  return transition && "then" in transition ? transition : waitAnimation(transition);
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
const LIVE_EDGE_GRACE = 15;

// Some players (notably VK Video Live) keep the actual media element inside a
// closed shadow root and expose a finite, segment-growing duration there. The
// page-level detector can still be confidently live while that particular
// element briefly loses its probe state during adoption/mirroring. Corroborate
// the page result only when this video is itself sitting at the media edge; a
// user who scrubbed back into DVR keeps the ordinary seekable timeline.
function nearLiveEdge(v: HTMLVideoElement): boolean {
  const dur = v.duration;
  if (Number.isFinite(dur) && dur > 0 && dur < MAX_REAL_DURATION) {
    const distance = dur - v.currentTime;
    if (Number.isFinite(distance) && distance >= 0 && distance <= LIVE_EDGE_GRACE) return true;
  }
  try {
    const ranges = v.seekable;
    if (!ranges?.length) return false;
    const distance = ranges.end(ranges.length - 1) - v.currentTime;
    return Number.isFinite(distance) && distance >= 0 && distance <= LIVE_EDGE_GRACE;
  } catch {
    return false;
  }
}

function mediaTimeline(v: HTMLVideoElement): Timeline {
  const dur = v.duration;
  const edgeCorroborated = nearLiveEdge(v);
  const pageEdgeLive = edgeCorroborated && (onStreamPage() || isVkLiveChannelPage());
  const live = isLive(v) || liveAtViewerEntry || pageEdgeLive;
  if (live && Number.isFinite(dur) && dur > 0 && dur < MAX_REAL_DURATION) {
    return { kind: "live" };
  }
  // VK exposes duration=Infinity together with a long seekable range. A strong
  // page/popup verdict must beat that range, while a generic sentinel-duration
  // element away from the edge remains an ordinary DVR timeline.
  if (liveLayoutAtViewerEntry || pageEdgeLive) return { kind: "live" };
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
  if (live) return { kind: "live" };
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
const notice = (key: string, fallback: string, subs?: string | string[]) =>
  i18n(key, subs) || fallback;
const qualityAutoLabel = () => i18n("viewerQualityAuto") || "Auto";

export function setViewerFitMode(mode: unknown, notify = false): ViewerFitMode {
  S.viewerFit = normalizeViewerFit(mode);
  sizeVideo();
  if (notify) {
    const label = fitLabel(S.viewerFit);
    showBadgeNotice(notice("viewerNoticeFit", `Fit: ${label}`, label));
  }
  return S.viewerFit;
}

function sizeVideo(): void {
  const surface = surfaceVideo ?? video;
  const shell = surfaceShell;
  if (!fmt || !surface) return;
  if (playerSurface) {
    playerSurface.setAttribute(PLAYER_SURFACE_FORMAT, fmt);
    playerSurface.style.setProperty("--vtp-viewer-fit", S.viewerFit);
    if (fmt === "theater") {
      normalBox = null;
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
      if (normalBox) {
        playerSurface.style.setProperty("--vtp-viewer-width", `${normalBox.w}px`);
        playerSurface.style.setProperty("--vtp-viewer-height", `${normalBox.h}px`);
      }
    }
    layoutBar();
    return;
  }
  if (!shell) return;
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
      `border-radius:12px !important;box-shadow:${NORMAL_SURFACE_SHADOW} !important;` +
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
  bar.style.width = live
    ? "max-content"
    : Math.round(Math.min(Math.max(r.width - 32, 280), 760)) + "px";
  bar.style.left = Math.round(r.left + r.width / 2) + "px";
  bar.style.bottom = Math.max(Math.round(window.innerHeight - r.bottom + 14), 14) + "px";
}

function refreshNativePlayerLayout(): void {
  const surface = playerSurface;
  if (!surface) return;
  const session = viewerSession;
  requestAnimationFrame(() => {
    // Several site-owned players measure their control rail only from a window
    // resize. Moving their root into the top layer changes its box without a
    // browser resize, so request one ordinary layout pass after the new format
    // has been applied. This runs once per format change and never touches the
    // media element or its playback pipeline.
    if (session !== viewerSession || surface !== playerSurface || !fmt) return;
    window.dispatchEvent(new Event("resize"));
  });
}

function setFormat(f: ViewerFormat): void {
  const switchingFormat = !!fmt && fmt !== f;
  const firstFrame = switchingFormat ? interruptSurfaceTransition() : null;
  const nativeFirstFrame = switchingFormat ? interruptNativeSurfaceTransition() : null;
  fmt = f;
  document.documentElement.setAttribute(ATTR, f);
  fmtBtn?.setAttribute("aria-pressed", f === "theater" ? "true" : "false");
  applyOverlayBackdrop();
  sizeVideo();
  refreshNativePlayerLayout();
  const transition = firstFrame
    ? animateSurfaceFrom(firstFrame)
    : nativeFirstFrame
      ? animateNativeSurfaceFrom(nativeFirstFrame)
      : null;
  if (switchingFormat && !transition) {
    layoutPaused = false;
    layoutBar();
    showBar();
  }
  overlay?.focus({ preventScroll: true });
  notifyViewerState();
  notifyViewerLayout();
  showBadgeNotice(
    f === "theater"
      ? notice("viewerNoticeTheater", "Theater")
      : notice("viewerNoticeViewer", "Viewer"),
    { video },
  );
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
  if (
    video?.paused &&
    (playerSurface || (autoOpenedSession && S.viewerAutoPlaybackOnly && !playbackFollowArmed)) &&
    !resumeSurfacePlaybackUsed &&
    Date.now() < resumeSurfacePlaybackUntil
  ) {
    resumeSurfacePlaybackUsed = true;
    void video.play()?.catch(() => {});
  }
  playBtn?.setAttribute("aria-pressed", video && !video.paused ? "true" : "false");
  if (video?.paused) {
    showBar();
    setViewerLoading(false);
  } else scheduleBackdropCanvas();
}

function handleViewerPlayState(): void {
  syncPlay();
  if (
    video?.paused &&
    !video.ended &&
    autoOpenedSession &&
    S.viewerAutoPlaybackOnly &&
    playbackFollowArmed &&
    !exiting
  ) {
    playbackPauseExit = true;
    exitViewer();
  }
}

function setViewerLoading(on: boolean): void {
  if (!loadingEl) return;
  const show = on && !!video && !video.paused;
  if (loadingShown === show) return;
  loadingShown = show;
  if (show) showBar();
  loadingEl.style.opacity = show ? "1" : "0";
  loadingEl.style.transform = show
    ? "translate(-50%, -50%) scale(1)"
    : "translate(-50%, -50%) scale(.92)";
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
        ? i18n("viewerLiveLabel") || "LIVE"
        : timeline.kind === "loading"
          ? fmtTime(timeline.pos)
          : `${fmtTime(timeline.pos)} / ${fmtTime(timeline.len)}`;
  }
  if (timeline.kind !== prevTimelineKind || seekWrapEl?.style.display !== prevSeekDisplay) {
    seekWrapRect = null;
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
  if (!visible) setMenuOpen(qualityMenu, qualityBtn, false);
  qualityWrap.style.display = visible ? "block" : "none";
  layoutBar();
}

function qualityButtonLabel(label: string): string {
  const clean = label.trim();
  if (/^auto$/i.test(clean)) return qualityAutoLabel();
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
  if (!fmt) return;
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
  if (qualityLabelEl)
    qualityLabelEl.textContent = qualityButtonLabel(selected?.label || qualityAutoLabel());
  if (!qualityMenu) return;
  qualityMenu.textContent = "";
  for (const opt of options) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "qitem";
    item.setAttribute("role", "menuitemradio");
    item.textContent = opt.id === "auto" ? qualityAutoLabel() : opt.label;
    if (opt.current || opt.id === state.current) {
      item.setAttribute("aria-current", "true");
      item.setAttribute("aria-checked", "true");
    } else {
      item.setAttribute("aria-checked", "false");
    }
    item.addEventListener("click", async () => {
      const session = viewerSession;
      setMenuOpen(qualityMenu, qualityBtn, false);
      pendingQuality = opt;
      pendingQualityUntil = Date.now() + 12_000;
      const label = opt.id === "auto" ? qualityAutoLabel() : opt.label;
      if (qualityLabelEl) qualityLabelEl.textContent = qualityButtonLabel(label);
      showBadgeNotice(notice("viewerNoticeQuality", `Quality: ${label}`, label));
      const next = await qualityRequest("vtp-quality-set", opt.id);
      if (session !== viewerSession || !fmt) return;
      pendingQuality = null;
      pendingQualityUntil = 0;
      renderQuality({
        ...next,
        current: opt.id,
        options: next.options.map((o) => ({ ...o, current: o.id === opt.id })),
      });
      refreshBackdropStream();
      sessionTimeout(() => refreshBackdropStream(), 700, session);
      sessionTimeout(() => refreshQuality(), 700, session);
    });
    item.addEventListener("keydown", (e) => handleMenuKey(e, qualityMenu, qualityBtn));
    qualityMenu.appendChild(item);
  }
}

async function refreshQuality(): Promise<void> {
  if (!fmt || !video || !qualityWrap) return;
  const session = viewerSession;
  const state = await qualityRequest("vtp-quality-request");
  if (session !== viewerSession || !fmt) return;
  renderQuality(state);
}

function sessionTimeout(fn: () => void, ms: number, session = viewerSession): void {
  const timer = window.setTimeout(() => {
    if (session === viewerSession && fmt) fn();
  }, ms);
  media?.signal.addEventListener("abort", () => window.clearTimeout(timer), { once: true });
}

function setMenuOpen(
  menu: HTMLDivElement | null,
  trigger: HTMLButtonElement | null,
  open: boolean,
) {
  if (!menu || !trigger) return;
  menu.classList.toggle("open", open);
  trigger.setAttribute("aria-expanded", open ? "true" : "false");
}

function menuItems(menu: HTMLDivElement | null): HTMLButtonElement[] {
  return Array.from(menu?.querySelectorAll<HTMLButtonElement>(".qitem") ?? []);
}

function focusMenuItem(menu: HTMLDivElement | null, delta = 0): void {
  const items = menuItems(menu);
  if (!items.length) return;
  const root = menu?.getRootNode();
  const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
  const current = active instanceof HTMLButtonElement ? items.indexOf(active) : -1;
  const next = current < 0 ? 0 : (current + delta + items.length) % items.length;
  items[next]?.focus();
}

function handleMenuKey(
  e: KeyboardEvent,
  menu: HTMLDivElement | null,
  trigger: HTMLButtonElement | null,
): void {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(menu, trigger, false);
    trigger?.focus();
    return;
  }
  if (e.key === "Tab") {
    setMenuOpen(menu, trigger, false);
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowRight") {
    e.preventDefault();
    e.stopPropagation();
    focusMenuItem(menu, 1);
    return;
  }
  if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
    e.preventDefault();
    e.stopPropagation();
    focusMenuItem(menu, -1);
    return;
  }
  if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    e.stopPropagation();
    const items = menuItems(menu);
    items[e.key === "Home" ? 0 : items.length - 1]?.focus();
  }
}

function closeViewerMenus(): boolean {
  let closed = false;
  if (fitMenu?.classList.contains("open")) {
    setMenuOpen(fitMenu, fitBtn, false);
    closed = true;
  }
  if (qualityMenu?.classList.contains("open")) {
    setMenuOpen(qualityMenu, qualityBtn, false);
    closed = true;
  }
  return closed;
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
    `button:focus-visible{outline:0;box-shadow:0 0 0 3px rgba(10,132,255,0.72)}` +
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
  markerTipEl.id = "vtp-viewer-marker-tip";
  markerTipEl.setAttribute("role", "tooltip");
  seekEl = document.createElement("input");
  seekEl.type = "range";
  seekEl.className = "seek";
  seekEl.min = "0";
  seekEl.max = "1000";
  seekEl.step = "1";
  seekEl.setAttribute("aria-label", i18n("viewerSeekAria") || "Seek");
  seekEl.setAttribute("aria-describedby", markerTipEl.id);
  seekEl.addEventListener("pointerdown", () => {
    seekWrapRect = null;
    seeking = true;
  });
  seekEl.addEventListener("pointerup", () => (seeking = false));
  seekEl.addEventListener("pointercancel", () => (seeking = false));
  seekEl.addEventListener("lostpointercapture", () => (seeking = false));
  seekEl.addEventListener("input", () => {
    if (!video) return;
    const timeline = mediaTimeline(video);
    if (timeline.kind !== "vod" && timeline.kind !== "dvr") return;
    video.currentTime = timeline.start + (Number(seekEl!.value) / 1000) * timeline.len;
    syncTime();
    showMarkerAtSeek();
  });
  seekEl.addEventListener("focus", showMarkerAtSeek);
  seekEl.addEventListener("blur", clearMarkerHover);
  seekWrap.addEventListener("pointerenter", () => {
    seekWrapRect = null;
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
  fitBtn = barButton(I_FIT, null, i18n("viewerFitAria") || "Fill mode");
  fitBtn.setAttribute("aria-haspopup", "menu");
  fitBtn.setAttribute("aria-expanded", "false");
  fitMenu = document.createElement("div");
  fitMenu.className = "qmenu";
  fitMenu.setAttribute("role", "menu");
  fitBtn.addEventListener("click", () => {
    if (!fitMenu) return;
    if (fitMenu.classList.contains("open")) {
      setMenuOpen(fitMenu, fitBtn, false);
      return;
    }
    closeViewerMenus();
    fitMenu.textContent = "";
    for (const m of FIT_MODES) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "qitem";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", m === S.viewerFit ? "true" : "false");
      item.textContent = fitLabel(m);
      if (m === S.viewerFit) item.setAttribute("aria-current", "true");
      item.addEventListener("click", () => {
        setViewerFitMode(m, true);
        setMenuOpen(fitMenu, fitBtn, false);
      });
      item.addEventListener("keydown", (e) => handleMenuKey(e, fitMenu, fitBtn));
      fitMenu.appendChild(item);
    }
    setMenuOpen(fitMenu, fitBtn, true);
    focusMenuItem(fitMenu);
  });
  fwrap.append(fitBtn, fitMenu);
  qualityWrap = document.createElement("span");
  qualityWrap.className = "qwrap";
  qualityWrap.style.display = "none";
  qualityBtn = barButton(I_QUALITY, null, i18n("viewerQualityAria") || "Quality");
  qualityBtn.classList.add("qbtn");
  qualityBtn.setAttribute("aria-haspopup", "menu");
  qualityBtn.setAttribute("aria-expanded", "false");
  qualityLabelEl = document.createElement("span");
  qualityLabelEl.className = "qbtn-label";
  qualityLabelEl.textContent = qualityAutoLabel();
  qualityBtn.appendChild(qualityLabelEl);
  qualityMenu = document.createElement("div");
  qualityMenu.className = "qmenu";
  qualityMenu.setAttribute("role", "menu");
  qualityBtn.addEventListener("click", async () => {
    if (!qualityMenu) return;
    if (qualityMenu.classList.contains("open")) {
      setMenuOpen(qualityMenu, qualityBtn, false);
      return;
    }
    closeViewerMenus();
    const state = await qualityRequest("vtp-quality-request");
    renderQuality(state);
    if (state.options.length >= 2) {
      setMenuOpen(qualityMenu, qualityBtn, true);
      focusMenuItem(qualityMenu);
    }
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

function currentSeekWrapRect(): DOMRect | null {
  if (!seekWrapEl) return null;
  if (!seekWrapRect) seekWrapRect = seekWrapEl.getBoundingClientRect();
  return seekWrapRect;
}

function clampMarkerFloatX(x: number, width: number, wrapWidth: number): number {
  const pad = width / 2 + 4;
  return Math.min(Math.max(x, pad), Math.max(pad, wrapWidth - pad));
}

function clearMarkerHighlight(): void {
  activeMarker?.el.classList.remove("active");
  activeMarker = null;
  markerTipEl?.classList.remove("show");
}

function clearMarkerHover(): void {
  clearMarkerHighlight();
  seekWrapRect = null;
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

function showMarkerAtTime(t: number, x: number): void {
  if (!seekWrapEl || !markerTipEl || !video) return;
  const r = currentSeekWrapRect();
  if (!r || r.width <= 0) return;
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
  markerTipEl.style.left = Math.round(clampMarkerFloatX(x, 80, r.width)) + "px";
  markerTipEl.classList.add("show");
}

function showMarkerAtSeek(): void {
  if (!seekWrapEl || !seekEl || !video) return;
  const timeline = mediaTimeline(video);
  if ((timeline.kind !== "vod" && timeline.kind !== "dvr") || timeline.len <= 0) return;
  const r = currentSeekWrapRect();
  if (!r || r.width <= 0) return;
  const ratio = Math.min(1, Math.max(0, Number(seekEl.value) / 1000));
  showMarkerAtTime(timeline.start + ratio * timeline.len, ratio * r.width);
}

function showMarkerHover(e: PointerEvent): void {
  if (!seekWrapEl || !video) return;
  const timeline = mediaTimeline(video);
  if ((timeline.kind !== "vod" && timeline.kind !== "dvr") || timeline.len <= 0) return;
  const r = currentSeekWrapRect();
  if (!r || r.width <= 0) return;
  const x = Math.min(r.width, Math.max(0, e.clientX - r.left));
  showMarkerAtTime(timeline.start + (x / r.width) * timeline.len, x);
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
  if (S.sponsorMarks && isYouTube() && (await sponsorBlockConsentGranted())) {
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

function sponsorBlockConsentGranted(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      api.runtime.sendMessage({ action: "sponsorConsentStatus" }, (response?: unknown) => {
        void api.runtime.lastError;
        resolve(
          !!response &&
            typeof response === "object" &&
            (response as { granted?: unknown }).granted === true,
        );
      });
    } catch {
      resolve(false);
    }
  });
}

// While popped out: the site's player may fight back — yank the video home or
// tear the spot down (the layer closed, SPA navigation). Both mean the show is
// over; put everything back (or let it go) and close.
function guard(): void {
  if (!fmt) return;
  if (playerSurface) {
    let open = false;
    try {
      open = playerSurface.matches(":popover-open");
    } catch {}
    if (!video?.isConnected || !overlay || !playerSurface.isConnected) involuntaryExitViewer();
    // A silently closed popover (element briefly out of the top layer without a
    // toggle event) gets one re-show attempt before the session is torn down.
    else if (!open && !reshowPlayerSurface()) involuntaryExitViewer();
    return;
  }
  if (
    !video ||
    !overlay ||
    !surfaceVideo?.isConnected ||
    !surfaceShell?.isConnected ||
    video.parentElement !== surfaceShell ||
    (holder && !holder.isConnected)
  ) {
    involuntaryExitViewer();
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
    listenerOptions({ passive: true }),
  );
  // Real fullscreen supersedes the viewer — the two fight over the same video.
  addFullscreenChangeListener(() => {
    if (currentFullscreenElement()) exitViewer();
  }, listenerObjectOptions());
}

// Media listeners + style enforcer for the adopted element. The shared
// AbortController also holds the overlay-level listeners, so re-wiring after a
// player recreated its element just adds the new element's set (the old one
// left the DOM together with its listeners).
function wireVideo(v: HTMLVideoElement): void {
  if (!media) return;
  const opt = { signal: media.signal };
  for (const ev of ["play", "pause"]) v.addEventListener(ev, handleViewerPlayState, opt);
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
  if (!playerSurface) {
    surfaceVideo?.addEventListener(
      "click",
      () => (v.paused ? v.play()?.catch(() => {}) : v.pause()),
      opt,
    );
  }
  for (const ev of ["waiting", "stalled"]) {
    v.addEventListener(ev, () => setViewerLoading(true), opt);
  }
  for (const ev of ["playing", "canplay", "canplaythrough", "timeupdate", "pause"]) {
    v.addEventListener(ev, () => setViewerLoading(false), opt);
  }
  // A lifted player remains in its site-owned DOM with its own controls and
  // resize logic. Do not fight the site's inline writes with the bare-video
  // style guard used by the fallback surface.
  if (playerSurface) return;
  styleGuard?.disconnect();
  if (styleGuardFrame != null) {
    cancelAnimationFrame(styleGuardFrame);
    styleGuardFrame = null;
  }
  // Sites (YouTube) keep restyling their video; batch the snap-back to one
  // frame so repeated inline writes do not turn into a mutation/write loop.
  styleGuard = new MutationObserver(() => {
    const surface = surfaceVideo ?? video;
    if (!fmt || !surface || surface.style.cssText === desiredCss || styleGuardFrame != null) return;
    styleGuardFrame = requestAnimationFrame(() => {
      styleGuardFrame = null;
      const current = surfaceVideo ?? video;
      if (!fmt || !current || current.style.cssText === desiredCss) return;
      styleGuard?.disconnect();
      current.style.cssText = desiredCss;
      styleGuard?.observe(current, { attributes: true, attributeFilter: ["style"] });
    });
  });
  const surface = surfaceVideo ?? video;
  if (surface) styleGuard.observe(surface, { attributes: true, attributeFilter: ["style"] });
}

type CaptureVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

function captureVideoStream(v: HTMLVideoElement): MediaStream | null {
  const capture = (v as CaptureVideo).captureStream ?? (v as CaptureVideo).mozCaptureStream;
  if (!capture) return null;
  try {
    const stream = capture.call(v);
    if (!stream || !stream.getVideoTracks().length) return null;
    // A captured fallback is decorative only. Drop its audio pipeline entirely
    // and ask Blink/Gecko to cap frame production; unsupported constraints are
    // harmless and the low-rate canvas remains the preferred path.
    stream.getAudioTracks?.().forEach((track) => track.stop());
    for (const track of stream.getVideoTracks()) {
      void track
        .applyConstraints?.({ frameRate: { ideal: BACKDROP_FPS, max: BACKDROP_CAPTURE_MAX_FPS } })
        .catch(() => {});
    }
    return stream;
  } catch (e) {
    return null;
  }
}

function ensureBackdropStream(): MediaStream | null {
  if (backdropStream) return backdropStream;
  if (!video) return null;
  backdropStream = captureVideoStream(video);
  return backdropStream;
}

function refreshBackdropStream(): void {
  if (!video || !(backdropVideo instanceof HTMLVideoElement)) return;
  const stream = captureVideoStream(video);
  if (!stream) return;
  backdropStream?.getTracks().forEach((track) => track.stop());
  backdropStream = stream;
  backdropVideo.srcObject = stream;
  backdropVideo.play()?.catch(() => {});
}

// Auto-open on playback (the `viewerAuto` setting). Sites such as YouTube reuse
// one <video> across SPA navigations, so "once per element" would make closing
// viewer on video A suppress auto-open for video B too. Remember page/media
// identities per element instead: the same video stays dismissed, while a new
// route can apply the configured auto mode again.
const autoSeen = new WeakMap<HTMLVideoElement, Set<string>>();
const pendingAutoOpen = new WeakMap<
  HTMLVideoElement,
  { identity: string; timer: ReturnType<typeof setTimeout> }
>();
let autoOpenedSession = false;
let playbackPauseExit = false;
// The video playback-follow just returned to the page on pause. Its next play
// press reopens the viewer immediately — see maybeAutoOpenViewer.
let playbackResume: { el: HTMLVideoElement; identity: string } | null = null;
// An exit the page forced on us (it yanked the video home, tore the spot down,
// or force-closed our popover) is not the user dismissing the viewer, so it
// must not burn the once-per-identity auto-open. The flag is only ever set for
// the synchronous exitViewer() call right under it; the per-identity counter
// keeps a player that actively fights the viewer from bouncing it forever.
let exitInvoluntarily = false;
const autoReopenTries = new Map<string, number>();
const MAX_AUTO_REOPEN_TRIES = 3;

function involuntaryExitViewer(): void {
  exitInvoluntarily = true;
  try {
    exitViewer();
  } finally {
    exitInvoluntarily = false;
  }
}

function autoOpenIdentity(): string {
  if (isYouTube()) {
    const id = youTubeVideoId();
    if (id) return `youtube:${id}`;
  }

  // Hash changes don't normally replace media. Keep the query because generic
  // SPA players commonly put their content id there.
  try {
    const url = new URL(location.href);
    url.hash = "";
    return `page:${url.href}`;
  } catch {
    // Some tests and embedded pages expose only a partial Location object.
    const hostname = typeof location.hostname === "string" ? location.hostname : "";
    const pathname = typeof location.pathname === "string" ? location.pathname : "";
    const search = typeof location.search === "string" ? location.search : "";
    return `page:${hostname}${pathname}${search}`;
  }
}

function rememberAutoOpen(t: HTMLVideoElement, identity: string): void {
  const seen = autoSeen.get(t) ?? new Set<string>();
  seen.add(identity);
  autoSeen.set(t, seen);
}

function forgetAutoOpen(t: HTMLVideoElement, identity: string): void {
  const seen = autoSeen.get(t);
  seen?.delete(identity);
  if (seen?.size === 0) autoSeen.delete(t);
}

// A manual format switch turns an auto-opened session into a user-driven one.
// Playback-follow must stop and this URL's auto-open stays consumed — otherwise
// pause/play would keep snapping the viewer back to the configured auto mode
// over the user's explicit choice.
function markViewerSessionManual(): void {
  if (!autoOpenedSession) return;
  autoOpenedSession = false;
  playbackFollowArmed = false;
  if (playbackFollowArmTimer != null) {
    clearTimeout(playbackFollowArmTimer);
    playbackFollowArmTimer = null;
  }
  playbackPauseExit = false;
  playbackResume = null;
  if (video) rememberAutoOpen(video, videoAutoIdentity);
}

function autoOpenAllowedOnCurrentPage(): boolean {
  const host = location.hostname.toLowerCase();
  if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    // YouTube's home, search, feed and channel pages autoplay sizeable hover
    // previews. They are not playback pages and must never trigger an automatic
    // Viewer. Do not mark the element as seen here: YouTube can reuse that same
    // <video> after an SPA navigation to /watch.
    return location.pathname === "/watch" || location.pathname.startsWith("/live/");
  }
  return true;
}

export function maybeAutoOpenViewer(t: HTMLVideoElement): void {
  if (window.top !== window) return;
  // Our own mirror/backdrop videos live inside the overlay and are started
  // with .play() during enter(). Ignore them to avoid recursively opening a new
  // viewer for the viewer's own media.
  if (t.closest(`[${OVERLAY}]`)) return;
  const identity = autoOpenIdentity();
  if (!autoOpenAllowedOnCurrentPage()) return;
  if (!S.viewerAutoEnabled || S.viewerAuto === "off" || fmt || autoSeen.get(t)?.has(identity))
    return;
  const r = t.getBoundingClientRect();
  if (r.width < 200 || r.height < 112) return; // thumbnails/previews don't count
  // Resuming a video that playback-follow itself just closed: the play press is
  // an explicit gesture at a known-good video, so the "is playback stable?"
  // debounce below (an anti-preview-flicker measure) would only add lag.
  if (playbackResume && playbackResume.el === t && playbackResume.identity === identity) {
    playbackResume = null;
    rememberAutoOpen(t, identity);
    void enter(S.viewerAuto, t, { autoTriggered: true });
    return;
  }
  if (S.viewerAutoPlaybackOnly || isYouTube()) {
    const pending = pendingAutoOpen.get(t);
    if (pending?.identity === identity) return;
    if (pending) clearTimeout(pending.timer);
    const timer = setTimeout(() => {
      const current = pendingAutoOpen.get(t);
      if (!current || current.identity !== identity || current.timer !== timer) return;
      pendingAutoOpen.delete(t);
      if (
        t.paused ||
        t.ended ||
        !autoOpenAllowedOnCurrentPage() ||
        !S.viewerAutoEnabled ||
        S.viewerAuto === "off" ||
        fmt ||
        autoSeen.get(t)?.has(identity)
      )
        return;
      rememberAutoOpen(t, identity);
      void enter(S.viewerAuto, t, { autoTriggered: true });
    }, VIEWER_PLAYBACK_STABLE_MS);
    pendingAutoOpen.set(t, { identity, timer });
    return;
  }
  rememberAutoOpen(t, identity);
  void enter(S.viewerAuto, t, { autoTriggered: true });
}

export function maybeAutoOpenPlayingPrimary(): void {
  if (!autoOpenAllowedOnCurrentPage()) return;
  const t = primaryVideo();
  // A YouTube hover preview can keep playing while the SPA changes `/` to
  // `/watch`. No second `play` event is guaranteed, so re-evaluate the already
  // playing primary video once navigation has committed. Never open a paused
  // poster merely because the route changed.
  if (!t || t.paused || t.ended) return;
  maybeAutoOpenViewer(t);
}

// YouTube keeps the same document (and sometimes the same <video>) while
// navigating from a home/feed preview to the actual watch page. Its
// `yt-navigate-finish` event is the first reliable point where pathname and the
// main player agree. Check immediately, then once more after the player has had
// a frame to swap its preview surface for the watch surface.
document.addEventListener(
  "yt-navigate-finish",
  () => {
    maybeAutoOpenPlayingPrimary();
    requestAnimationFrame(maybeAutoOpenPlayingPrimary);
  },
  listenerOptions(),
);

document.addEventListener(
  "play",
  (e) => {
    const t = e.target;
    if (!(t instanceof HTMLVideoElement)) return;
    maybeAutoOpenViewer(t);
  },
  listenerOptions(true),
);

async function enter(
  format: ViewerFormat,
  target?: HTMLVideoElement,
  opts: { liveHint?: boolean; autoTriggered?: boolean } = {},
): Promise<void> {
  if (window.top !== window) return;
  const v = target ?? primaryVideo();
  if (!v || currentFullscreenElement() || fmt || exiting || overlay || isDrmVideo(v)) return;
  const wasPlayingAtEntry = !v.paused && !v.ended;
  // A previous close schedules one delayed pass for site players that settle
  // asynchronously. Once a new viewer session starts that pass is stale: it
  // must not re-layout the launcher against the new surface.
  cancelPostRestoreLayout();
  // Read this before DOM adoption: some site players temporarily clear their
  // MSE timeline while responding to the move.
  const targetLive = isLive(v);
  const atEntryEdge = nearLiveEdge(v);
  let hasEntrySeekableWindow = false;
  try {
    if (v.seekable?.length) {
      const start = v.seekable.start(v.seekable.length - 1);
      const end = v.seekable.end(v.seekable.length - 1);
      const len = end - start;
      hasEntrySeekableWindow = Number.isFinite(len) && len > 5 && len < MAX_REAL_DURATION;
    }
  } catch {
    // A MediaSource swap can make TimeRanges throw between length/start/end.
  }
  const entryTimelineUnavailable =
    (!Number.isFinite(v.duration) || v.duration <= 0 || v.duration >= MAX_REAL_DURATION) &&
    !hasEntrySeekableWindow;
  liveLayoutAtViewerEntry =
    opts.liveHint === true ||
    (isVkLiveChannelPage() && atEntryEdge) ||
    (onStreamPage() && (atEntryEdge || entryTimelineUnavailable));
  liveAtViewerEntry = liveLayoutAtViewerEntry || targetLive;
  const firstRect = v.getBoundingClientRect();
  document.dispatchEvent(new Event(CLOSE_EVENT));
  fmt = format;
  video = v;
  videoAutoIdentity = autoOpenIdentity();
  if (playbackFollowArmTimer != null) {
    clearTimeout(playbackFollowArmTimer);
    playbackFollowArmTimer = null;
  }
  autoOpenedSession = opts.autoTriggered === true;
  playbackFollowArmed = !autoOpenedSession || !S.viewerAutoPlaybackOnly;
  playbackPauseExit = false;
  playbackResume = null; // a session is opening — the pending resume is served or stale
  surfaceVideo = null;
  backdropEl = null;
  surfaceShell = null;
  playerSurface = null;
  playerSurfaceStyle = null;
  backdropStream = null;
  viewerSession++;
  surfaceReshows = 0;
  resumeSurfacePlaybackUntil = wasPlayingAtEntry ? Date.now() + 1800 : 0;
  resumeSurfacePlaybackUsed = false;
  sourceParent = null;
  sourceNextSibling = null;
  sourceRect = firstRect;
  normalBox = null;
  prevCss = v.style.cssText;
  prevControls = v.controls;
  overlay = document.createElement("div");
  overlay.setAttribute(OVERLAY, "");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", i18n("viewerDialogLabel") || "Pop-out video viewer");
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
  hookGlobal();
  // Chapters depend on the SITE player's UI, so read them before the video
  // leaves it.
  pendingChapters =
    isYouTube() && Number.isFinite(v.duration) ? readYouTubeChapters(v.duration) : [];
  const keepsNativePlayer = mountPlayerSurface(v);
  if (!keepsNativePlayer) {
    surfaceShell = document.createElement("div");
    Object.assign(surfaceShell.style, {
      position: "absolute",
      overflow: "hidden",
      zIndex: "1",
      background: "#000",
    } as Partial<CSSStyleDeclaration>);
    overlay.appendChild(surfaceShell);
    const loadingStyle = document.createElement("style");
    loadingStyle.textContent =
      `@keyframes vtp-viewer-spin{to{transform:rotate(360deg)}}` +
      `[data-vtp-viewer-loading]{position:absolute;left:50%;top:50%;width:54px;height:54px;` +
      `border-radius:999px;display:grid;place-items:center;pointer-events:none;z-index:4;` +
      `opacity:0;transform:translate(-50%,-50%) scale(.92);transition:opacity .18s ease,` +
      `transform .18s ease;background:rgb(20 20 22 / calc(0.34 * var(--glass-opacity,1)));` +
      `box-shadow:0 0 0 1px rgba(255,255,255,.16),0 14px 36px rgba(0,0,0,.28);` +
      `-webkit-backdrop-filter:${GLASS_REFRACTION}blur(8px) saturate(180%) brightness(1.04);` +
      `backdrop-filter:${GLASS_REFRACTION}blur(8px) saturate(180%) brightness(1.04)}` +
      `[data-vtp-viewer-loading]>i{width:24px;height:24px;border-radius:999px;` +
      `border:3px solid rgba(255,255,255,.34);border-top-color:#fff;` +
      `animation:vtp-viewer-spin .72s linear infinite}`;
    loadingEl = document.createElement("div");
    loadingEl.setAttribute("data-vtp-viewer-loading", "");
    loadingEl.appendChild(document.createElement("i"));
    loadingShown = false;
    surfaceShell.append(loadingStyle, loadingEl);
    sourceParent = v.parentNode;
    sourceNextSibling = v.nextSibling;
    holder = document.createComment("vtp-viewer-holder");
    v.parentNode?.insertBefore(holder, v);
    surfaceVideo = v;
    v.setAttribute(ADOPTED_VIDEO, "");
    surfaceShell.appendChild(v);
    v.controls = false; // ours replace them; the site's flag is restored on exit
    mountBar();
  }
  prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  // Session-scoped wiring, all dropped at once on exit.
  media = new AbortController();
  const opt = { signal: media.signal };
  wireVideo(v);
  // The one-shot resume in syncPlay() exists to undo the HOST player pausing
  // itself as a side effect of top-layer entry — a pause that arrives without
  // any user input. The moment real input happens, every later pause is the
  // user's intent (YouTube even flashes its pause bezel), so never fight it.
  for (const ev of ["pointerdown", "keydown", "touchstart"] as const) {
    window.addEventListener(
      ev,
      () => {
        resumeSurfacePlaybackUsed = true;
      },
      { capture: true, passive: true, signal: media.signal },
    );
  }
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
  const enterAnim: SurfaceTransition = playerSurface
    ? animateNativeSurfaceFrom(firstRect)
    : animateSurfaceFrom(frameFromRect(firstRect));
  syncPlay();
  syncVolume();
  syncTime();
  if (!playbackFollowArmed) {
    const session = viewerSession;
    playbackFollowArmTimer = setTimeout(() => {
      playbackFollowArmTimer = null;
      if (viewerSession === session && autoOpenedSession && !exiting) playbackFollowArmed = true;
    }, viewerAnimationMs() + 100);
  }
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
  const involuntary = exitInvoluntarily;
  exiting = true;
  // Stays paused for the whole close transition — same as enter() — so the
  // launcher doesn't reposition itself off a video mid-shrink/mid-restore.
  // finish() below clears it once the video is truly back in its original spot.
  layoutPaused = true;
  const exitingOverlay = overlay;
  // sourceRect was measured at entry; the page may have re-laid itself out
  // since (YouTube hydrates well past the auto-open). While the popover holds
  // the player, its home spot can't be measured directly — but the surface's
  // parent stays in normal flow and keeps the reserved player box. Prefer that
  // live rect so the return animation lands where the player will actually sit.
  let targetRect = sourceRect;
  if (playerSurface) {
    const home = playerSurface.parentElement;
    if (home?.isConnected) {
      const r = home.getBoundingClientRect();
      if (visibleRect(r)) targetRect = r;
    }
  }
  // A forced teardown means the page already reclaimed (or destroyed) the
  // video's spot — animating the surface back to a stale rect just flashes.
  // Restore instantly; only user-intended exits get the shrink transition.
  const surfaceAnim: SurfaceTransition = involuntary
    ? null
    : playerSurface
      ? animateNativeSurfaceTo(targetRect)
      : animateSurfaceTo(targetRect);
  const backdropAnim = involuntary ? null : animateBackdropOut(targetRect);
  const animated = !!surfaceAnim || !!backdropAnim;
  fmt = null;
  document.documentElement.removeAttribute(ATTR);
  document.documentElement.style.overflow = prevOverflow;
  notifyViewerState();
  bar?.animate?.([{ opacity: 1 }, { opacity: 0 }], {
    duration: Math.min(160, viewerAnimationMs()),
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
    if (playbackFollowArmTimer != null) {
      clearTimeout(playbackFollowArmTimer);
      playbackFollowArmTimer = null;
    }
    media?.abort();
    media = null;
    styleGuard?.disconnect();
    styleGuard = null;
    if (styleGuardFrame != null) {
      cancelAnimationFrame(styleGuardFrame);
      styleGuardFrame = null;
    }
    pendingChapters = [];
    marksLoaded = false;
    marksSourceKey = "";
    markerRanges = [];
    activeMarker = null;
    const restoredVideo = video;
    let shouldResumeAuto = playbackPauseExit;
    playbackResume =
      playbackPauseExit && restoredVideo
        ? { el: restoredVideo, identity: videoAutoIdentity }
        : null;
    if (!shouldResumeAuto && involuntary && autoOpenedSession) {
      const tries = autoReopenTries.get(videoAutoIdentity) ?? 0;
      if (tries < MAX_AUTO_REOPEN_TRIES) {
        autoReopenTries.set(videoAutoIdentity, tries + 1);
        shouldResumeAuto = true;
      }
    }
    if (video) {
      // Use the identity captured on entry. The URL may already point at the
      // next SPA video by the time the close animation finishes.
      if (shouldResumeAuto) forgetAutoOpen(video, videoAutoIdentity);
      else rememberAutoOpen(video, videoAutoIdentity);
      if (playerSurface) {
        unmountPlayerSurface();
      } else {
        video.removeAttribute(ADOPTED_VIDEO);
        video.controls = prevControls;
        video.style.cssText = prevCss;
        // Prefer the exact comment spot. If a site removed only that marker while
        // keeping the original parent, fall back to the saved parent/sibling so
        // closing the viewer does not discard the only page video with the overlay.
        if (holder?.isConnected && video.parentElement === surfaceShell) {
          holder.parentNode?.insertBefore(video, holder);
        } else if (sourceParent?.isConnected && video.parentElement === surfaceShell) {
          if (sourceNextSibling?.parentNode === sourceParent) {
            sourceParent.insertBefore(video, sourceNextSibling);
          } else {
            sourceParent.appendChild(video);
          }
        }
      }
    }
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
    playerSurface = null;
    playerSurfaceStyle = null;
    loadingEl = null;
    loadingShown = false;
    bar = null;
    playBtn = muteBtn = fmtBtn = null;
    seekEl = seekWrapEl = volEl = null;
    timeEl = null;
    fitMenu = null;
    fitBtn = null;
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
    viewerSession++;
    resumeSurfacePlaybackUntil = 0;
    resumeSurfacePlaybackUsed = false;
    surfaceVideo = null;
    liveAtViewerEntry = false;
    liveLayoutAtViewerEntry = false;
    video = null;
    videoAutoIdentity = "";
    autoOpenedSession = false;
    playbackFollowArmed = false;
    playbackPauseExit = false;
    // Players re-measure on resize — let the restored one lay itself out.
    window.dispatchEvent(new Event("resize"));
    notifyViewerLayout();
    if (shouldResumeAuto) {
      if (restoredVideo?.isConnected && !restoredVideo.paused && !restoredVideo.ended)
        maybeAutoOpenViewer(restoredVideo);
      // The page may have replaced the element while yanking the old one home
      // (a reload/SPA teardown). The replacement is often already playing, so
      // no further `play` event will arrive — re-check the primary directly.
      else if (involuntary) maybeAutoOpenPlayingPrimary();
    }
    // Some site players (YouTube's included) don't finish re-laying the
    // returned video out in the same tick — a launcher position measured right
    // now can grab a transitional rect and stick there. One more pass shortly
    // after catches it once the page has actually settled.
    cancelPostRestoreLayout();
    const restoredSession = viewerSession;
    postRestoreLayoutTimer = setTimeout(() => {
      postRestoreLayoutTimer = null;
      if (viewerSession !== restoredSession || fmt || overlay) return;
      notifyViewerLayout();
    }, 300);
  };

  if (animated)
    void Promise.all([waitSurfaceTransition(surfaceAnim), waitAnimation(backdropAnim)]).then(
      finish,
    );
  else finish();
}

// The hotkey/button entry point. Closed → open in `format`; open in the other
// format → switch; open in the same format → close. So V and T each toggle
// their own view and jump straight between the two.
export function toggleViewer(format: ViewerFormat): void {
  if (!S.viewerAutoEnabled) return;
  if (fmt) {
    if (fmt === format) exitViewer();
    else {
      markViewerSessionManual();
      setFormat(format);
    }
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
