// On-video launcher: a draggable round button placed over the video that opens
// the extension popup as an in-page overlay (an iframe of popup/popup.html, so
// the whole popup — its UI and its tab messaging — is reused unchanged). The
// content script can't open the real toolbar popup programmatically, hence the
// iframe. Visibility mirrors the badge: the button only appears while the pointer
// moves over the video (and stays up while the popup is open), then auto-hides.
import { S } from "../state.js";
import { getDomain } from "../core/domain.js";
import { badgeFraction } from "../core/badge-pos.js";
import { mutateStoredMap } from "../../shared/map-mutation.js";
import { api, ctxValid } from "../platform/browser.js";
import {
  addFullscreenChangeListener,
  currentFullscreenElement,
  fullscreenOverlayHost,
} from "../platform/fullscreen.js";
import { i18n } from "../platform/i18n.js";
import { isDrmVideo, primaryVideo } from "../videos.js";
import {
  VIEWER_LAYOUT_EVENT,
  toggleViewer,
  exitViewer,
  viewerAnchorVideo,
  viewerFormat,
  viewerLayoutPaused,
} from "../viewer.js";
import { ensureGlassFilter, GLASS_REFRACTION } from "../../shared/glass.js";
import { LAUNCHER_TOP_LAYER_ATTR, listenerObjectOptions, listenerOptions } from "../lifecycle.js";
import { subscribePointerMove } from "../pointer.js";

type Timer = ReturnType<typeof setTimeout>;

const FAB_SIZE = 44; // px — the button's box
const R_ITEM = 36; // px — one radial-menu item's box
const R_DIST = 62; // px — item centre's distance from the FAB centre
const R_SPREAD = Math.PI / 3.6; // 50° between neighbouring radial items
const R_HIDE_MS = 350; // grace period for the pointer to travel FAB → item
const R_CLOSE_MS = 240; // wait for the fan-in transition before hiding items
const R_ENABLE_MS = 230; // never let an item intercept the click while fanning out from the FAB
const RADIAL_TRANSITION =
  "left .22s cubic-bezier(.2,0,0,1), top .22s cubic-bezier(.2,0,0,1), opacity .18s ease, transform .22s cubic-bezier(.2,0,0,1)";
const MARGIN = 16; // px — default inset from the video's right edge
const POPUP_W = 684; // px — the popup's fixed width (popup base.css)
const FIT_MARGIN = 24; // px — keep the overlay this far from the viewport edges
const FALLBACK_H = 520; // px — height before the popup reports its real one
const HOST_ID = "vtp-launcher-host";

let host: HTMLDivElement | null = null; // shadow host (light DOM) we re-parent + mark
let shadow: ShadowRoot | null = null;
let fab: HTMLButtonElement | null = null;
// Radial menu around the FAB (revealed on hover): pop-out normal, pop-out
// theater, and — only while the viewer is open — exit.
let rItems: {
  normal: HTMLButtonElement;
  theater: HTMLButtonElement;
  pip: HTMLButtonElement;
  exit: HTMLButtonElement;
} | null = null;
let radialOpen = false;
let radialTimer: Timer | undefined;
let radialIdleTimer: Timer | undefined;
let radialCloseTimer: Timer | undefined;
let radialEnableTimer: Timer | undefined;
let radialFrame = 0;
let backdrop: HTMLDivElement | null = null;
let frame: HTMLIFrameElement | null = null;
// Panel-drag state. The press starts inside the popup iframe, which captures the
// pointer and posts the gesture here; we recompute the clamped centre on each move.
let pdSX = 0,
  pdSY = 0; // pointer screen coords at drag start
let pdCx0 = 0,
  pdCy0 = 0; // panel centre at drag start
let pdHW = 0,
  pdHH = 0; // panel half-extents (clamp bounds)
let pdCx = 0,
  pdCy = 0; // current clamped centre (saved on drop)
let frameH = FALLBACK_H;
let frameScale = 1; // last fit-scale from layoutFrame, reused by the open animation
let open = false;
let hideTimer: Timer | undefined;
let mouseHooked = false;
let fabVideo: HTMLElement | null = null; // cached video frame/anchor so mousemove stays cheap
let dragging = false;
let moved = false;
let dragPointerId: number | null = null;
let dragDX = 0,
  dragDY = 0;
let downX = 0,
  downY = 0;
// Captured at drag start, not re-read at drop: the viewer can close mid-drag
// (e.g. a site player's own DOM churn tripping our connectivity guard), which
// would otherwise silently swap fabVideo out from under an in-progress drag and
// save a fraction computed against the wrong box.
let dragVideo: HTMLElement | null = null;
let dragWasViewerOpen = false;
let fabDragDrop: ((save?: boolean) => void) | null = null;
let fabGlobalDragHooked = false;
const NATIVE_VIEWER_SURFACE_ATTR = "data-vtp-viewer-player";
const HOST_POPOVER_ATTR = "data-vtp-launcher-popover";

type PopoverHost = HTMLDivElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
};

function syncHostPopover(active: boolean): void {
  const popoverHost = host as PopoverHost | null;
  if (!popoverHost) return;
  if (
    typeof popoverHost.showPopover !== "function" ||
    typeof popoverHost.hidePopover !== "function"
  )
    return;
  let open = false;
  try {
    open = popoverHost.matches(":popover-open");
  } catch {}
  if (active) {
    popoverHost.setAttribute("popover", "manual");
    popoverHost.setAttribute(HOST_POPOVER_ATTR, "");
    if (!open) {
      try {
        popoverHost.showPopover();
      } catch {}
    }
  } else if (popoverHost.hasAttribute(HOST_POPOVER_ATTR)) {
    if (open) {
      try {
        popoverHost.hidePopover();
      } catch {}
    }
    popoverHost.removeAttribute(HOST_POPOVER_ATTR);
    popoverHost.removeAttribute("popover");
  }
}

function syncTopLayerAttr(): void {
  if (open || radialOpen) document.documentElement.setAttribute(LAUNCHER_TOP_LAYER_ATTR, "");
  else document.documentElement.removeAttribute(LAUNCHER_TOP_LAYER_ATTR);
}

function fabLabel(): string {
  return open
    ? i18n("overlayBtnClose") || "Close Video Tuner"
    : i18n("overlayBtnAria") || "Open Video Tuner";
}

function syncFabExpanded(): void {
  fab?.setAttribute("aria-expanded", open || radialOpen ? "true" : "false");
  fab?.setAttribute("aria-label", fabLabel());
}

// True if a node belongs to our launcher — the media observer ignores our own
// DOM writes so they don't feed back into applyAll (mirrors ownsBadgeNode).
export function ownsLauncherNode(node: Node | null): boolean {
  if (!node) return false;
  return !!(host && (host === node || host.contains(node)));
}

function removeStaleHosts(): void {
  const stale = document.getElementById(HOST_ID);
  if (stale && stale !== host) stale.remove();
  let legacy = document.querySelector("[data-vtp-launcher]:not(#" + HOST_ID + ")");
  while (legacy && legacy !== host) {
    legacy.remove();
    legacy = document.querySelector("[data-vtp-launcher]:not(#" + HOST_ID + ")");
  }
}

function eligible(): boolean {
  if (!fabVideo) return false;
  if (S.overlayButton === "always") return true;
  // In fullscreen mode the FAB also surfaces while the pop-out viewer is open,
  // so its radial menu (switch format / exit) stays reachable by mouse.
  if (S.overlayButton === "fullscreen") return !!currentFullscreenElement() || !!viewerFormat();
  return false;
}

// The viewer's chat surfaces (side column, floating panel) can cover the
// button's spot. Steer clear of them for the moment WITHOUT saving anything:
// the stored fraction stays put, so the button returns to its usual place the
// instant the chat stops being in the way.
function avoidViewerChat(left: number, top: number, r: DOMRect): { left: number; top: number } {
  const pad = 8;
  const sel = "[data-vtp-viewer-chat-side],[data-vtp-viewer-chat-panel]";
  for (const el of document.querySelectorAll<HTMLElement>(sel)) {
    const c = el.getBoundingClientRect();
    if (!c.width || !c.height) continue;
    const overlaps =
      left < c.right + pad &&
      left + FAB_SIZE > c.left - pad &&
      top < c.bottom + pad &&
      top + FAB_SIZE > c.top - pad;
    if (!overlaps) continue;
    // Slide out horizontally toward the side of the video with room; failing
    // that, dodge above/below the surface.
    const leftRoom = c.left - r.left;
    const rightRoom = r.right - c.right;
    const need = FAB_SIZE + pad * 2;
    if (leftRoom >= need && (leftRoom >= rightRoom || rightRoom < need)) {
      left = c.left - FAB_SIZE - pad;
    } else if (rightRoom >= need) {
      left = c.right + pad;
    } else if (c.top - r.top >= r.bottom - c.bottom) {
      top = c.top - FAB_SIZE - pad;
    } else {
      top = c.bottom + pad;
    }
  }
  return { left, top };
}

// Place the button at its saved per-site fraction of the video, or the default
// right-center spot when it's never been moved.
function positionFab(v: HTMLElement): void {
  if (!fab) return;
  const r = v.getBoundingClientRect();
  const bw = FAB_SIZE;
  const bh = FAB_SIZE;
  const maxLeft = r.left + Math.max(0, r.width - bw);
  const maxTop = r.top + Math.max(0, r.height - bh);
  const place = (left: number, top: number) => {
    const dodged = avoidViewerChat(left, top, r);
    const nextLeft = Math.round(Math.min(Math.max(dodged.left, r.left), maxLeft)) + "px";
    const nextTop = Math.round(Math.min(Math.max(dodged.top, r.top), maxTop)) + "px";
    if (fab!.style.left !== nextLeft) fab!.style.left = nextLeft;
    if (fab!.style.top !== nextTop) fab!.style.top = nextTop;
  };
  if (S.overlayBtnPos) {
    place(r.left + S.overlayBtnPos.fx * r.width, r.top + S.overlayBtnPos.fy * r.height);
  } else {
    place(r.right - FAB_SIZE - MARGIN, r.top + (r.height - FAB_SIZE) / 2);
  }
  if (radialOpen) layoutRadial();
}

// The radial items currently on offer: both formats, plus exit while the viewer
// is open.
function radialList(): HTMLButtonElement[] {
  if (!rItems) return [];
  if (!S.viewerAutoEnabled) return [];
  if (isDrmVideo(primaryVideo())) return viewerFormat() ? [rItems.exit] : [];
  // The pop-out viewer cannot escape a child frame's viewport. Do not expose
  // dead format buttons there; native PiP remains useful when the embed allows it.
  if (window.top !== window) return canUseNativePiP() ? [rItems.pip] : [];
  const f = viewerFormat();
  const visual = [
    f === "theater" ? rItems.exit : rItems.theater,
    f === "normal" ? rItems.exit : rItems.normal,
  ];
  if (canUseNativePiP()) visual.push(rItems.pip);
  return visual.reverse();
}

function nativePiPVideo(): HTMLVideoElement | null {
  const v = primaryVideo();
  return v instanceof HTMLVideoElement ? v : null;
}

function canUseNativePiP(v = nativePiPVideo()): v is HTMLVideoElement {
  return !!(
    v &&
    !isDrmVideo(v) &&
    document.pictureInPictureEnabled !== false &&
    !v.disablePictureInPicture &&
    typeof v.requestPictureInPicture === "function"
  );
}

function positionRadialAtFab(items = Object.values(rItems ?? {})): void {
  if (!fab) return;
  const fabLeft = parseFloat(fab.style.left);
  const fabTop = parseFloat(fab.style.top);
  if (!Number.isFinite(fabLeft) || !Number.isFinite(fabTop)) return;
  const left = fabLeft + (FAB_SIZE - R_ITEM) / 2;
  const top = fabTop + (FAB_SIZE - R_ITEM) / 2;
  for (const b of items) {
    b.style.left = Math.round(left) + "px";
    b.style.top = Math.round(top) + "px";
    b.style.transform = "scale(0.72)";
  }
}

function snapRadialAtFab(items = Object.values(rItems ?? {})): void {
  if (!fab) return;
  cancelAnimationFrame(radialFrame);
  radialFrame = 0;
  for (const b of items) {
    b.style.transition = "none";
    b.style.opacity = "0";
    b.style.visibility = "hidden";
    b.style.pointerEvents = "none";
  }
  positionRadialAtFab(items);
  // Commit the hidden origin before transitions return. Otherwise Chrome may
  // paint one frame at stale coordinates when YouTube churns the page.
  fab.getBoundingClientRect();
  for (const b of items) b.style.transition = RADIAL_TRANSITION;
}

// Fan the items around the FAB, centred on the direction toward the video's
// middle — so the menu opens into the frame wherever the FAB was dragged.
function layoutRadial(): void {
  if (!fab) return;
  const fx = parseFloat(fab.style.left) + FAB_SIZE / 2;
  const fy = parseFloat(fab.style.top) + FAB_SIZE / 2;
  let base = Math.PI; // fan left when there's no bearing to compute
  if (fabVideo) {
    const r = fabVideo.getBoundingClientRect();
    const dx = r.left + r.width / 2 - fx;
    const dy = r.top + r.height / 2 - fy;
    if (dx || dy) base = Math.atan2(dy, dx);
  }
  const items = radialList();
  items.forEach((b, i) => {
    const a = base + (i - (items.length - 1) / 2) * R_SPREAD;
    b.style.left = Math.round(fx + Math.cos(a) * R_DIST - R_ITEM / 2) + "px";
    b.style.top = Math.round(fy + Math.sin(a) * R_DIST - R_ITEM / 2) + "px";
    b.style.transform = "scale(1)";
  });
  const f = viewerFormat();
  if (rItems && f) {
    const active = f === "theater" ? rItems.theater : rItems.normal;
    active.style.left = rItems.exit.style.left;
    active.style.top = rItems.exit.style.top;
    active.style.transform = rItems.exit.style.transform;
  }
}

// Reflect the viewer's state on the items: the active format reads as pressed,
// and exit is only offered while something is open.
function syncRadial(): void {
  if (!rItems) return;
  const f = viewerFormat();
  rItems.normal.setAttribute("aria-pressed", f === "normal" ? "true" : "false");
  rItems.theater.setAttribute("aria-pressed", f === "theater" ? "true" : "false");
  rItems.pip.setAttribute(
    "aria-pressed",
    nativePiPVideo() && document.pictureInPictureElement === nativePiPVideo() ? "true" : "false",
  );
  rItems.exit.style.display = f ? "flex" : "none";
}

document.addEventListener("enterpictureinpicture", syncRadial, listenerOptions(true));
document.addEventListener("leavepictureinpicture", syncRadial, listenerOptions(true));

function toggleNativePiP(): void {
  const v = nativePiPVideo();
  if (!canUseNativePiP(v)) return;
  void (async () => {
    try {
      if (document.pictureInPictureElement === v) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {
      // Browsers/sites can reject PiP for policy/user-activation reasons.
    }
  })();
}

function openRadial(): void {
  if (!rItems || !fab) return;
  clearTimeout(radialTimer);
  clearTimeout(radialCloseTimer);
  radialTimer = undefined;
  radialCloseTimer = undefined;
  syncRadial();
  const items = radialList();
  for (const b of Object.values(rItems)) {
    if (items.includes(b)) continue;
    b.style.opacity = "0";
    b.style.visibility = "hidden";
    b.style.pointerEvents = "none";
  }
  if (!items.length) {
    radialOpen = false;
    clearTimeout(radialIdleTimer);
    snapRadialAtFab();
    syncTopLayerAttr();
    syncFabExpanded();
    return;
  }
  if (radialOpen) {
    for (const b of items) {
      b.style.visibility = "visible";
      b.style.opacity = "1";
      if (!radialEnableTimer) b.style.pointerEvents = "auto";
    }
    layoutRadial();
    flashFab();
    return;
  }
  radialOpen = true;
  syncTopLayerAttr();
  syncFabExpanded();
  clearTimeout(radialIdleTimer);
  snapRadialAtFab(items);
  radialFrame = requestAnimationFrame(() => {
    radialFrame = 0;
    if (!radialOpen) return;
    for (const b of items) {
      b.style.visibility = "visible";
      b.style.opacity = "1";
    }
    layoutRadial();
    radialEnableTimer = setTimeout(() => {
      radialEnableTimer = undefined;
      if (!radialOpen) return;
      for (const b of radialList()) b.style.pointerEvents = "auto";
    }, R_ENABLE_MS);
  });
  radialIdleTimer = setTimeout(() => closeRadial(true), 2600);
  flashFab(); // the menu holds the FAB up too
}

// `resumeHide` restarts the FAB's auto-hide countdown — wanted when the pointer
// wandered off (the FAB shouldn't stay lit forever), but not from the auto-hide
// timeout itself, which would re-show the FAB it just hid.
function closeRadial(resumeHide = false): void {
  radialOpen = false;
  syncTopLayerAttr();
  syncFabExpanded();
  clearTimeout(radialTimer);
  clearTimeout(radialIdleTimer);
  clearTimeout(radialCloseTimer);
  clearTimeout(radialEnableTimer);
  radialTimer = undefined;
  radialIdleTimer = undefined;
  radialCloseTimer = undefined;
  radialEnableTimer = undefined;
  cancelAnimationFrame(radialFrame);
  radialFrame = 0;
  if (rItems) {
    const closingItems = Object.values(rItems).filter((b) => b.style.visibility !== "hidden");
    for (const b of closingItems) {
      b.style.visibility = "visible";
      b.style.pointerEvents = "none";
    }
    fab?.getBoundingClientRect();
    radialFrame = requestAnimationFrame(() => {
      radialFrame = 0;
      if (radialOpen || !rItems) return;
      for (const b of closingItems) b.style.opacity = "0";
      positionRadialAtFab(closingItems);
      radialCloseTimer = setTimeout(() => {
        radialCloseTimer = undefined;
        if (radialOpen || !rItems) return;
        for (const b of closingItems) b.style.visibility = "hidden";
      }, R_CLOSE_MS);
    });
  }
  if (resumeHide) flashFab();
}

// Leaving the FAB or an item starts a short countdown, so the pointer can hop
// between them without the menu collapsing mid-travel.
function scheduleRadialClose(): void {
  if (radialTimer) return;
  radialTimer = setTimeout(() => {
    radialTimer = undefined;
    closeRadial(true);
  }, R_HIDE_MS);
}

function keepRadialOpen(): void {
  clearTimeout(radialTimer);
  radialTimer = undefined;
}

function focusRadialItem(delta = 0): void {
  const items = radialList().filter((b) => b.style.visibility !== "hidden");
  if (!items.length) return;
  const active = shadow?.activeElement;
  const current = active instanceof HTMLButtonElement ? items.indexOf(active) : -1;
  const next = current < 0 ? 0 : (current + delta + items.length) % items.length;
  items[next]?.focus();
}

function ownsRadialEvent(e: Event): boolean {
  const path = e.composedPath();
  return !!(fab && path.includes(fab)) || radialList().some((b) => path.includes(b));
}

function saveFabPos(fx: number, fy: number): void {
  if (!ctxValid()) return;
  mutateStoredMap("overlayBtnPos", { [getDomain()]: { fx, fy } }, []);
}

function resetFabPos(): void {
  if (!ctxValid()) return;
  mutateStoredMap("overlayBtnPos", {}, [getDomain()]);
}

function flashFab(): void {
  if (!fab) return;
  fab.style.opacity = "1";
  fab.style.pointerEvents = "auto";
  clearTimeout(hideTimer);
  if (open || dragging || radialOpen) return; // popup/menu open or mid-drag → stay lit
  hideTimer = setTimeout(() => {
    if (!fab || dragging || open || radialOpen) return;
    fab.style.opacity = "0";
    fab.style.pointerEvents = "none";
    closeRadial();
  }, 2600);
}

// Size + center the popup overlay, scaling it down if the viewport is too small
// to hold its natural 684×height box.
function layoutFrame(): void {
  if (!frame) return;
  const k = Math.min(
    1,
    (window.innerWidth - FIT_MARGIN * 2) / POPUP_W,
    (window.innerHeight - FIT_MARGIN * 2) / frameH,
  );
  frameScale = k > 0 ? k : 1;
  frame.style.width = POPUP_W + "px";
  frame.style.height = frameH + "px";
  frame.style.transform = `translate(-50%, -50%) scale(${frameScale})`;
}

// Place the panel's centre: the saved per-site spot (fraction of the viewport) or
// the middle when never moved. Paired with the translate(-50%) in layoutFrame.
function positionPanel(): void {
  if (!frame) return;
  const p = S.overlayPanelPos;
  const fx = p && Number.isFinite(p.fx) ? p.fx : 0.5;
  const fy = p && Number.isFinite(p.fy) ? p.fy : 0.5;
  // Saved fractions can outlive a monitor/layout, and older versions could
  // persist malformed values. Never trust them as coordinates: an off-screen
  // iframe still leaves the launcher in its "open" state, which looks exactly
  // like a dead popup to the user.
  // Use layout dimensions, not getBoundingClientRect(): the opening animation
  // temporarily reports a 0.9-scaled box. Clamping against that transient size
  // leaves the final panel a few pixels outside the viewport once it reaches 1x.
  const finalW = (frame.offsetWidth || POPUP_W + 2) * frameScale;
  const finalH = (frame.offsetHeight || frameH + 2) * frameScale;
  // Leave a one-pixel inset for transformed borders and compositor rounding;
  // otherwise an edge-aligned panel can report a tiny negative/overflowing
  // coordinate even when its layout dimensions are mathematically clamped.
  const halfW = Math.min(window.innerWidth / 2, finalW / 2 + 1);
  const halfH = Math.min(window.innerHeight / 2, finalH / 2 + 1);
  const cx = Math.min(window.innerWidth - halfW, Math.max(halfW, fx * window.innerWidth));
  const cy = Math.min(window.innerHeight - halfH, Math.max(halfH, fy * window.innerHeight));
  // Preserve the clamped sub-pixel centre. Rounding an edge-aligned panel can
  // move its transformed border fractionally outside a small viewport.
  frame.style.left = cx + "px";
  frame.style.top = cy + "px";

  if (p) {
    const healed = { fx: cx / window.innerWidth, fy: cy / window.innerHeight };
    if (
      !Number.isFinite(p.fx) ||
      !Number.isFinite(p.fy) ||
      Math.abs(healed.fx - p.fx) > 0.0001 ||
      Math.abs(healed.fy - p.fy) > 0.0001
    ) {
      S.overlayPanelPos = healed;
      savePanelPos(healed.fx, healed.fy);
    }
  }
}

function savePanelPos(fx: number, fy: number): void {
  if (!ctxValid()) return;
  mutateStoredMap("overlayPanelPos", { [getDomain()]: { fx, fy } }, []);
}

function resetPanelPos(): void {
  S.overlayPanelPos = null;
  positionPanel();
  if (!ctxValid()) return;
  mutateStoredMap("overlayPanelPos", {}, [getDomain()]);
}

// Drag the panel by its header. The embedded popup captures the pointer (so the
// moves keep arriving even when the cursor leaves the iframe) and posts the
// gesture; we just reposition + clamp the panel so it stays on screen, then save
// on drop. Screen coords cross the frame boundary unchanged → no scale math.
function panelDragStart(sx: number, sy: number): void {
  if (!frame) return;
  const r = frame.getBoundingClientRect();
  pdCx0 = r.left + r.width / 2;
  pdCy0 = r.top + r.height / 2;
  pdHW = r.width / 2;
  pdHH = r.height / 2;
  pdSX = sx;
  pdSY = sy;
  pdCx = pdCx0;
  pdCy = pdCy0;
}

function panelDragMove(sx: number, sy: number): void {
  if (!frame) return;
  pdCx = Math.min(window.innerWidth - pdHW, Math.max(pdHW, pdCx0 + (sx - pdSX)));
  pdCy = Math.min(window.innerHeight - pdHH, Math.max(pdHH, pdCy0 + (sy - pdSY)));
  frame.style.left = pdCx + "px";
  frame.style.top = pdCy + "px";
}

function panelDragEnd(moved: boolean): void {
  if (moved) savePanelPos(pdCx / window.innerWidth, pdCy / window.innerHeight);
}

// The overlay iframe must declare the host's USED color-scheme to stay transparent
// (a mismatch makes Chrome paint an opaque backdrop). The host scheme isn't visible
// from inside the iframe, so resolve it here (CSS color-scheme, then <meta>, else the
// page default of light) and pass it plus the real OS scheme as a URL hash.
function overlaySchemeHash(): string {
  const osDark = matchMedia("(prefers-color-scheme: dark)").matches;
  const comp = getComputedStyle(document.documentElement).colorScheme.toLowerCase();
  const meta = (
    document.querySelector('meta[name="color-scheme"]') as HTMLMetaElement | null
  )?.content.toLowerCase();
  const decl = comp !== "normal" ? comp : meta || "";
  const dark = /dark/.test(decl);
  const light = /light/.test(decl);
  const host =
    dark && !light
      ? "dark"
      : light && !dark
        ? "light"
        : dark && light
          ? osDark
            ? "dark"
            : "light"
          : "light";
  return `#vtp-${host}-${osDark ? "dark" : "light"}`;
}

function openPopup(): void {
  if (open || !shadow) return;
  let popupUrl: string;
  try {
    // Resolve the extension URL before mutating any UI state. An orphaned content
    // script (after an extension reload) or an unrelated page `browser` global
    // must not leave a transparent backdrop and a permanently "open" FAB behind.
    popupUrl = api.runtime.getURL("popup/popup.html") + overlaySchemeHash();
  } catch (error) {
    console.error("[Video Tuner] unable to open embedded popup", error);
    return;
  }
  closeRadial();
  open = true;
  fab?.setAttribute("data-popup-open", "true"); // morphs the icon play → ✕
  syncFabExpanded();
  if (!backdrop) {
    backdrop = document.createElement("div");
    // Transparent click-catcher (close on outside click); the frost lives on the
    // panel itself, not a full-screen scrim.
    Object.assign(backdrop.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.001)",
      zIndex: "2147483646",
    } as Partial<CSSStyleDeclaration>);
    backdrop.addEventListener("pointerdown", closePopup);
    shadow.append(backdrop);
  }
  // Recreate the iframe on every open so it always loads the current popup/popup.html
  // — the toolbar popup is recreated by the browser each open; this mirrors that. The
  // old frame is removed first to drop its document (timers, graph samplers) and avoid
  // leaks. frameH (module-level) carries the last reported height across opens so the
  // panel starts at its real size with no flicker; layoutFrame() refits it.
  if (frame) frame.remove();
  frame = document.createElement("iframe");
  // Chrome makes the overlay iframe TRANSPARENT only when its color-scheme matches
  // the host's used scheme; a mismatch paints an opaque backdrop. And the host's
  // scheme isn't readable inside the iframe (Facebook forces it via <meta>, which
  // getComputedStyle doesn't surface). So compute it HERE and pass two things:
  //   host  → the popup sets color-scheme to match → transparent on any site;
  //   os    → the popup themes the glass to the OS (decoupled from color-scheme).
  frame.src = popupUrl;
  // The panel blurs the video behind it — backdrop-filter on the iframe element
  // (in the page) is reliable, unlike a filter applied inside the iframe document.
  // The translucent tint lives in the popup's own CSS (html.vtp-embedded, theme
  // aware), so it's left off here; this element only supplies blur + the frame.
  Object.assign(frame.style, {
    position: "fixed",
    left: "50%",
    top: "50%",
    border: "1px solid rgba(255,255,255,0.16)", // hairline edge for the glass panel
    borderRadius: "16px",
    WebkitBackdropFilter: GLASS_REFRACTION + "blur(10px) saturate(180%) brightness(1.04)",
    backdropFilter: GLASS_REFRACTION + "blur(10px) saturate(180%) brightness(1.04)",
    boxShadow: "0 24px 70px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.2)",
    colorScheme: "normal",
    zIndex: "2147483647",
  } as Partial<CSSStyleDeclaration>);
  shadow.append(frame);
  frame.style.display = "block";
  backdrop.style.display = "block"; // cached backdrop is hidden on close — re-show it
  syncTopLayerAttr();
  layoutFrame();
  positionPanel();
  // Entrance: the panel scales up + fades in about its centre (the translate keeps
  // it centred while it grows). Composed with the fit-scale so it lands exactly on
  // layoutFrame's transform; skipped under reduced motion.
  if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    frame.animate(
      [
        { opacity: 0, transform: `translate(-50%, -50%) scale(${frameScale * 0.9})` },
        { opacity: 1, transform: `translate(-50%, -50%) scale(${frameScale})` },
      ],
      { duration: 190, easing: "cubic-bezier(0.2, 0.72, 0.2, 1)" },
    );
  }
  flashFab();
}

function closePopup(): void {
  if (!open) return;
  open = false;
  fab?.setAttribute("data-popup-open", "false"); // morphs the icon ✕ → play
  syncFabExpanded();
  if (frame) frame.style.display = "none";
  if (backdrop) backdrop.style.display = "none";
  syncTopLayerAttr();
  flashFab(); // resume the auto-hide countdown
}

function togglePopup(): void {
  if (open) closePopup();
  else openPopup();
}

// Open/close the overlay popup from the keyboard, independent of the launcher
// button's visibility setting — mounts the machinery on demand so the hotkey
// works even when the button is turned off.
export function toggleOverlayPopup(): void {
  if (!ctxValid()) return;
  fabVideo = viewerAnchorVideo() ?? primaryVideo();
  if (!fabVideo) return; // nothing to overlay
  if (!host) mount();
  hookMouse();
  const parent = fullscreenOverlayHost();
  if (host && host.parentNode !== parent) parent.appendChild(host);
  if (!dragging) positionFab(fabVideo);
  togglePopup();
}

function hookGlobalFabDrag(): void {
  if (fabGlobalDragHooked) return;
  fabGlobalDragHooked = true;
  const finishFromOutside = (e: PointerEvent) => {
    if (dragPointerId == null || (e.pointerId ?? -1) !== dragPointerId) return;
    fabDragDrop?.();
  };
  const cancelFromOutside = (e: PointerEvent) => {
    if (dragPointerId == null || (e.pointerId ?? -1) !== dragPointerId) return;
    fabDragDrop?.(false);
  };
  document.addEventListener("pointerup", finishFromOutside, listenerOptions(true));
  document.addEventListener("pointercancel", cancelFromOutside, listenerOptions(true));
  window.addEventListener("pointerup", finishFromOutside, listenerOptions(true));
  window.addEventListener("pointercancel", cancelFromOutside, listenerOptions(true));
  window.addEventListener("blur", () => fabDragDrop?.(false), listenerOptions(true));
}

// Drag anywhere over the video; a press without a drag toggles the popup. Mirrors
// the badge's drag handling so the two controls behave identically.
function hookFabDrag(el: HTMLElement): void {
  hookGlobalFabDrag();
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    moved = false;
    dragPointerId = e.pointerId ?? -1;
    dragVideo = fabVideo;
    dragWasViewerOpen = !!dragVideo && dragVideo !== primaryVideo();
    try {
      el.setPointerCapture(e.pointerId);
    } catch (x) {
      /* ignore */
    }
    el.style.cursor = "grabbing";
    const r = el.getBoundingClientRect();
    dragDX = e.clientX - r.left;
    dragDY = e.clientY - r.top;
    downX = e.clientX;
    downY = e.clientY;
    e.preventDefault();
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    // A few px of slop so a click's micro-jitter still counts as a click (toggle),
    // not a drag (reposition).
    if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) < 4) return;
    moved = true;
    closeRadial(); // repositioning — the menu would lag behind the button
    el.style.left = Math.round(e.clientX - dragDX) + "px";
    el.style.top = Math.round(e.clientY - dragDY) + "px";
    flashFab();
  });
  const drop = (save = true) => {
    if (!dragging) return;
    dragging = false;
    dragPointerId = null;
    el.style.cursor = "pointer";
    if (!moved) {
      if (save) togglePopup();
      return;
    }
    // Use what was true when the drag STARTED, not a fresh read: the viewer can
    // close mid-drag (a site player's own DOM churn tripping our connectivity
    // guard), which would otherwise silently swap fabVideo to the page video
    // while el's on-screen position still reflects the popped-out box — an
    // end-of-drag re-check would then compute garbage against a box the drag
    // never actually happened over.
    if (!save || !dragVideo) return;
    const r = dragVideo.getBoundingClientRect();
    const pos = badgeFraction(el.getBoundingClientRect(), r);
    // While the viewer is open, fabVideo is the popped-out surface, not the page
    // video — a fraction saved against that box is meaningless (and would
    // misplace the button) once the viewer closes and positioning reverts to
    // the real video's differently sized rect. Snap to the clamped drop spot
    // either way, but only persist a drag that happened against the real video.
    if (dragWasViewerOpen) {
      el.style.left = Math.round(r.left + pos.fx * r.width) + "px";
      el.style.top = Math.round(r.top + pos.fy * r.height) + "px";
    } else {
      S.overlayBtnPos = pos;
      saveFabPos(pos.fx, pos.fy);
      if (fabVideo) positionFab(fabVideo);
    }
  };
  el.addEventListener("pointerup", () => drop());
  el.addEventListener("pointercancel", () => drop(false));
  fabDragDrop = drop;
  el.addEventListener("dblclick", (e) => {
    e.preventDefault();
    dragging = false;
    dragPointerId = null;
    S.overlayBtnPos = null;
    if (fabVideo) positionFab(fabVideo);
    resetFabPos();
  });
}

function mount(): void {
  removeStaleHosts();
  radialOpen = false;
  clearTimeout(radialTimer);
  clearTimeout(radialIdleTimer);
  clearTimeout(radialCloseTimer);
  clearTimeout(radialEnableTimer);
  cancelAnimationFrame(radialFrame);
  radialFrame = 0;
  host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-vtp-launcher", "");
  // Give the shadow tree its own top-level stacking context. A z-index on the
  // fixed descendants alone is not enough when Viewer is appended later: the
  // viewer surface can otherwise win hit-testing and swallow radial-menu clicks.
  // A zero-sized host keeps the page beneath clickable outside our own controls.
  Object.assign(host.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "0",
    height: "0",
    margin: "0",
    padding: "0",
    border: "0",
    overflow: "visible",
    background: "transparent",
    zIndex: "2147483647",
  } as Partial<CSSStyleDeclaration>);
  host.style.setProperty("--glass-opacity", String(S.glassOpacity)); // scales the FAB glass
  shadow = host.attachShadow({ mode: "open" });
  ensureGlassFilter(shadow); // our liquid-glass displacement filter, scoped to this shadow
  fab = document.createElement("button");
  fab.type = "button";
  fab.setAttribute("aria-label", fabLabel());
  fab.setAttribute("aria-haspopup", "menu");
  fab.setAttribute("aria-expanded", "false");
  fab.setAttribute("data-popup-open", "false");
  Object.assign(fab.style, {
    position: "fixed",
    zIndex: "2147483647",
    width: FAB_SIZE + "px",
    height: FAB_SIZE + "px",
    padding: "0",
    margin: "0",
    border: "0",
    borderRadius: "50%",
    cursor: "pointer",
    touchAction: "none",
    color: "#fff",
    background: "rgb(20 20 22 / calc(0.32 * var(--glass-opacity, 1)))",
    boxShadow: "0 0 0 1px rgba(255,255,255,0.14)",
    WebkitBackdropFilter: GLASS_REFRACTION + "blur(7px) saturate(180%) brightness(1.04)",
    backdropFilter: GLASS_REFRACTION + "blur(7px) saturate(180%) brightness(1.04)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: "0",
    transition: "opacity .25s",
    pointerEvents: "none",
  } as Partial<CSSStyleDeclaration>);
  // Two stacked icons — the play triangle (closed) and a cross (open) — that rotate +
  // scale through each other so the button morphs play→✕ on open and back on close.
  const iconStyle = document.createElement("style");
  iconStyle.textContent =
    ".vtp-ico{position:absolute;inset:0;display:grid;place-items:center;" +
    "transition:opacity .2s ease,transform .3s cubic-bezier(.34,1.2,.64,1)}" +
    ".vtp-ico svg{display:block}" +
    ".vtp-ico-close{opacity:0;transform:rotate(-90deg) scale(.4)}" +
    "button[data-popup-open='true'] .vtp-ico-play{opacity:0;transform:rotate(90deg) scale(.4)}" +
    "button[data-popup-open='true'] .vtp-ico-close{opacity:1;transform:none}" +
    "@media (prefers-reduced-motion:reduce){.vtp-ico{transition:none}}";
  shadow.append(iconStyle);
  // Two stacked icons, built via DOMParser rather than innerHTML (the AMO linter
  // flags every innerHTML assignment; these are static, trusted markup).
  const FAB_ICONS =
    // Play triangle (brand mark), nudged right to sit optically centred.
    '<span class="vtp-ico vtp-ico-play"><svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 6.5v11l9-5.5z"/></svg></span>' +
    // Cross (shown while the overlay is open).
    '<span class="vtp-ico vtp-ico-close"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></span>';
  const icons = new DOMParser().parseFromString(FAB_ICONS, "text/html").body;
  while (icons.firstChild) fab.appendChild(icons.firstChild);
  shadow.append(fab);
  hookFabDrag(fab);
  const act = (fn: () => void) => () => {
    closePopup();
    closeRadial();
    fn();
  };
  rItems = {
    normal: radialButton(
      '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><rect x="7" y="8" width="10" height="7" rx="1.5" fill="currentColor" stroke="none" opacity=".9"/></svg>',
      i18n("viewerBtnAria") || "Pop out video",
      act(() => toggleViewer("normal")),
    ),
    theater: radialButton(
      // Theater mark: a bold wide letterboxed frame.
      '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"/></svg>',
      i18n("viewerTheaterAria") || "Pop out in theater format",
      act(() => toggleViewer("theater")),
    ),
    pip: radialButton(
      '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12.5" y="11.5" width="7" height="5" rx="1" fill="currentColor" stroke="none"/></svg>',
      i18n("viewerPiPAria") || "Picture in Picture",
      act(toggleNativePiP),
    ),
    exit: radialButton(
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
      i18n("viewerCloseAria") || "Close the pop-out viewer",
      act(exitViewer),
    ),
  };
  shadow.append(rItems.theater, rItems.normal, rItems.pip, rItems.exit);
  fab.addEventListener("mouseenter", openRadial);
  fab.addEventListener("mouseleave", scheduleRadialClose);
  fab.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (open || radialOpen)) {
      e.preventDefault();
      e.stopPropagation();
      if (open) closePopup();
      else closeRadial(true);
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    openRadial();
    requestAnimationFrame(() => focusRadialItem());
  });
}

// One radial-menu item: a smaller glass sibling of the FAB, hidden until the
// menu opens. Hovering an item keeps the menu up (cancels the pending close).
function radialButton(svg: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.title = label;
  Object.assign(b.style, {
    position: "fixed",
    zIndex: "2147483647",
    width: R_ITEM + "px",
    height: R_ITEM + "px",
    padding: "0",
    margin: "0",
    border: "0",
    borderRadius: "50%",
    cursor: "pointer",
    color: "#fff",
    background: "rgb(20 20 22 / calc(0.32 * var(--glass-opacity, 1)))",
    boxShadow: "0 0 0 1px rgba(255,255,255,0.14)",
    WebkitBackdropFilter: GLASS_REFRACTION + "blur(7px) saturate(180%) brightness(1.04)",
    backdropFilter: GLASS_REFRACTION + "blur(7px) saturate(180%) brightness(1.04)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: "0",
    transform: "scale(0.72)",
    transformOrigin: "50% 50%",
    transition: RADIAL_TRANSITION,
    visibility: "hidden",
    pointerEvents: "none",
  } as Partial<CSSStyleDeclaration>);
  const body = new DOMParser().parseFromString(svg, "text/html").body;
  while (body.firstChild) b.appendChild(body.firstChild);
  b.addEventListener("mouseenter", openRadial);
  b.addEventListener("mouseleave", scheduleRadialClose);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  b.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeRadial(true);
      fab?.focus();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      focusRadialItem(-1);
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      focusRadialItem(1);
    }
  });
  return b;
}

function hookMouse(): void {
  if (mouseHooked) return;
  mouseHooked = true;
  subscribePointerMove(({ x, y }) => {
    const v = fabVideo;
    if (!eligible() || !fab || !v) return;
    const r = v.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
    // Self-heal here, not just on resize/viewer-layout events: a site player
    // can resize/relayout its video for reasons we have no hook into (an ad,
    // a quality switch, its own transition), silently leaving the button
    // stuck over stale geometry until something else happens to trigger a
    // reposition. Hovering the video is the one moment we know for certain
    // the real, current rect is worth reading.
    if (fabVideo !== v) return;
    if (!dragging) positionFab(v);
    flashFab();
  });
  // The embedded popup reports its content height (so the iframe grows like the
  // real popup) and asks to close on Escape. Only trust messages from our frame.
  window.addEventListener(
    "message",
    (e) => {
      if (!frame || e.source !== frame.contentWindow) return;
      const d = e.data as {
        type?: string;
        height?: number;
        close?: boolean;
        drag?: string;
        sx?: number;
        sy?: number;
        moved?: boolean;
      } | null;
      if (!d || d.type !== "vtp-overlay") return;
      if (d.close) closePopup();
      else if (d.drag === "start" && typeof d.sx === "number" && typeof d.sy === "number")
        panelDragStart(d.sx, d.sy);
      else if (d.drag === "move" && typeof d.sx === "number" && typeof d.sy === "number")
        panelDragMove(d.sx, d.sy);
      else if (d.drag === "end") panelDragEnd(d.moved === true);
      else if (d.drag === "reset") resetPanelPos();
      else if (typeof d.height === "number" && d.height > 0) {
        frameH = Math.round(d.height);
        layoutFrame();
        // The popup reports its real height after first paint. Re-clamp the
        // saved centre against that final box; otherwise a position that was
        // valid for FALLBACK_H can expand beyond the viewport while the button
        // still reports the panel as open.
        positionPanel();
      }
    },
    listenerOptions(),
  );
  // Esc with focus on the page (the in-iframe case is covered by the message above).
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      if (!open && !radialOpen) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (open) closePopup();
      else closeRadial();
    },
    listenerOptions(true),
  );
  window.addEventListener(
    "resize",
    () => {
      if (open) {
        layoutFrame();
        positionPanel();
      }
      updateLauncher();
    },
    listenerOptions({ passive: true }),
  );
  addFullscreenChangeListener(() => {
    closeRadial();
    updateLauncher();
    if (eligible()) flashFab(); // surface it the moment fullscreen begins
  }, listenerObjectOptions());
  document.addEventListener(
    "pointermove",
    (e) => {
      if (!radialOpen) return;
      if (ownsRadialEvent(e)) keepRadialOpen();
      else scheduleRadialClose();
    },
    listenerOptions({ passive: true, capture: true }),
  );
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (radialOpen && !ownsRadialEvent(e)) closeRadial(true);
    },
    listenerOptions(true),
  );
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) closeRadial();
    },
    listenerOptions(),
  );
}

// Keep the launcher's eligibility, parent and position fresh (called each tick +
// on the relevant storage/fullscreen changes). Visibility itself is mouse-driven
// (flashFab), except while the popup is open.
function hideFab(): void {
  if (!fab) return;
  fab.style.opacity = "0";
  fab.style.pointerEvents = "none";
  closeRadial();
}

function resetDetachedHost(): void {
  if (!host || host.isConnected) return;
  radialOpen = false;
  open = false;
  syncTopLayerAttr();
  dragging = false;
  dragPointerId = null;
  clearTimeout(radialTimer);
  clearTimeout(radialIdleTimer);
  clearTimeout(radialCloseTimer);
  clearTimeout(radialEnableTimer);
  cancelAnimationFrame(radialFrame);
  radialFrame = 0;
  host = null;
  shadow = null;
  fab = null;
  rItems = null;
  backdrop = null;
  frame = null;
}

// Re-apply the glass-opacity multiplier (General setting) to the launcher glass.
export function applyLauncherGlass(): void {
  host?.style.setProperty("--glass-opacity", String(S.glassOpacity));
}

export function updateLauncher(snapshot: { primary?: HTMLVideoElement | null } = {}): void {
  resetDetachedHost();
  const paused = viewerLayoutPaused();
  const viewerAnchor = viewerAnchorVideo();
  if (viewerAnchor) {
    fabVideo = viewerAnchor;
  } else if (!paused || !fabVideo) {
    fabVideo = snapshot.primary !== undefined ? snapshot.primary : primaryVideo();
  }
  // No video to overlay → nothing can show; close any open popup and hide the FAB.
  if (!fabVideo) {
    syncHostPopover(false);
    if (open) closePopup();
    hideFab();
    return;
  }
  if (S.overlayButton === "off" || !eligible()) {
    // The button is hidden in this mode, but a popup opened via the overlay hotkey
    // stays up (the hotkey is independent of the button). Keep its host attached to
    // the right parent (e.g. on entering fullscreen) and only hide the button.
    hideFab();
    syncHostPopover(false);
    if (open && host) {
      const parent = fullscreenOverlayHost();
      if (host.parentNode !== parent) parent.appendChild(host);
    }
    return;
  }
  if (!host) mount();
  hookMouse();
  const parent = fullscreenOverlayHost();
  if (host && host.parentNode !== parent) parent.appendChild(host);
  syncHostPopover(
    !!(
      viewerAnchor as (HTMLElement & { hasAttribute?: (name: string) => boolean }) | null
    )?.hasAttribute?.(NATIVE_VIEWER_SURFACE_ATTR),
  );
  if (fabVideo && !dragging && (!paused || viewerAnchor)) positionFab(fabVideo);
  // The viewer can close behind our back (Esc, backdrop click) — refresh an
  // open menu so its pressed states and exit item stay honest.
  if (radialOpen) openRadial();
  if (open) flashFab(); // keep it up while the popup is showing
}

document.addEventListener(VIEWER_LAYOUT_EVENT, () => updateLauncher(), listenerOptions());
