// On-video launcher: a draggable round button placed over the video that opens
// the extension popup as an in-page overlay (an iframe of popup/popup.html, so
// the whole popup — its UI and its tab messaging — is reused unchanged). The
// content script can't open the real toolbar popup programmatically, hence the
// iframe. Visibility mirrors the badge: the button only appears while the pointer
// moves over the video (and stays up while the popup is open), then auto-hides.
import { S } from "../state.js";
import { getDomain } from "../core/domain.js";
import { badgeFraction } from "../core/badge-pos.js";
import { STORE } from "../platform/storage.js";
import { api, ctxValid } from "../platform/browser.js";
import { i18n } from "../platform/i18n.js";
import { primaryVideo } from "../videos.js";

type Timer = ReturnType<typeof setTimeout>;

const FAB_SIZE = 44; // px — the button's box
const MARGIN = 16; // px — default inset from the video's right edge
const POPUP_W = 684; // px — the popup's fixed width (popup base.css)
const FIT_MARGIN = 24; // px — keep the overlay this far from the viewport edges
const FALLBACK_H = 520; // px — height before the popup reports its real one

let host: HTMLDivElement | null = null; // shadow host (light DOM) we re-parent + mark
let shadow: ShadowRoot | null = null;
let fab: HTMLButtonElement | null = null;
let backdrop: HTMLDivElement | null = null;
let frame: HTMLIFrameElement | null = null;
let frameH = FALLBACK_H;
let open = false;
let hideTimer: Timer | undefined;
let mouseHooked = false;
let fabVideo: HTMLVideoElement | null = null; // cached primary video so mousemove stays cheap
let dragging = false;
let moved = false;
let dragDX = 0,
  dragDY = 0;
let downX = 0,
  downY = 0;

// True if a node belongs to our launcher — the media observer ignores our own
// DOM writes so they don't feed back into applyAll (mirrors ownsBadgeNode).
export function ownsLauncherNode(node: Node | null): boolean {
  if (!node) return false;
  return !!(host && (host === node || host.contains(node)));
}

function eligible(): boolean {
  if (!fabVideo) return false;
  if (S.overlayButton === "always") return true;
  if (S.overlayButton === "fullscreen") return !!document.fullscreenElement;
  return false;
}

// Place the button at its saved per-site fraction of the video, or the default
// right-center spot when it's never been moved.
function positionFab(v: HTMLVideoElement): void {
  if (!fab) return;
  const r = v.getBoundingClientRect();
  if (S.overlayBtnPos) {
    fab.style.left = Math.round(r.left + S.overlayBtnPos.fx * r.width) + "px";
    fab.style.top = Math.round(r.top + S.overlayBtnPos.fy * r.height) + "px";
  } else {
    fab.style.left = Math.round(r.right - FAB_SIZE - MARGIN) + "px";
    fab.style.top = Math.round(r.top + (r.height - FAB_SIZE) / 2) + "px";
  }
}

function saveFabPos(fx: number, fy: number): void {
  if (!ctxValid()) return;
  STORE.get(["overlayBtnPos"], (r) => {
    const map = (r.overlayBtnPos || {}) as Record<string, { fx: number; fy: number }>;
    map[getDomain()] = { fx, fy };
    STORE.set({ overlayBtnPos: map });
  });
}

function resetFabPos(): void {
  if (!ctxValid()) return;
  STORE.get(["overlayBtnPos"], (r) => {
    const map = (r.overlayBtnPos || {}) as Record<string, { fx: number; fy: number }>;
    delete map[getDomain()];
    STORE.set({ overlayBtnPos: map });
  });
}

function flashFab(): void {
  if (!fab) return;
  fab.style.opacity = "1";
  fab.style.pointerEvents = "auto";
  clearTimeout(hideTimer);
  if (open || dragging) return; // popup open or mid-drag → stay lit
  hideTimer = setTimeout(() => {
    if (!fab || dragging || open) return;
    fab.style.opacity = "0";
    fab.style.pointerEvents = "none";
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
  frame.style.width = POPUP_W + "px";
  frame.style.height = frameH + "px";
  frame.style.transform = `translate(-50%, -50%) scale(${k > 0 ? k : 1})`;
}

function openPopup(): void {
  if (open || !shadow) return;
  open = true;
  if (!frame) {
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
    frame = document.createElement("iframe");
    frame.src = api.runtime.getURL("popup/popup.html");
    // The panel blurs the video behind it — backdrop-filter on the iframe element
    // (in the page) is reliable, unlike a filter applied inside the iframe document.
    // The translucent tint lives in the popup's own CSS (html.vtp-embedded, theme
    // aware), so it's left off here; this element only supplies blur + the frame.
    Object.assign(frame.style, {
      position: "fixed",
      left: "50%",
      top: "50%",
      border: "1px solid rgba(255,255,255,0.12)", // hairline edge for the glass panel
      borderRadius: "16px",
      WebkitBackdropFilter: "blur(16px) saturate(160%)",
      backdropFilter: "blur(16px) saturate(160%)",
      boxShadow: "0 24px 70px rgba(0,0,0,0.5)",
      colorScheme: "normal",
      zIndex: "2147483647",
    } as Partial<CSSStyleDeclaration>);
    shadow.append(backdrop, frame);
  }
  backdrop!.style.display = "block";
  frame.style.display = "block";
  layoutFrame();
  flashFab();
}

function closePopup(): void {
  if (!open) return;
  open = false;
  if (frame) frame.style.display = "none";
  if (backdrop) backdrop.style.display = "none";
  flashFab(); // resume the auto-hide countdown
}

function togglePopup(): void {
  if (open) closePopup();
  else openPopup();
}

// Drag anywhere over the video; a press without a drag toggles the popup. Mirrors
// the badge's drag handling so the two controls behave identically.
function hookFabDrag(el: HTMLElement): void {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    moved = false;
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
    el.style.left = Math.round(e.clientX - dragDX) + "px";
    el.style.top = Math.round(e.clientY - dragDY) + "px";
    flashFab();
  });
  const drop = () => {
    if (!dragging) return;
    dragging = false;
    el.style.cursor = "pointer";
    if (!moved) {
      togglePopup();
      return;
    }
    if (!fabVideo) return;
    const pos = badgeFraction(el.getBoundingClientRect(), fabVideo.getBoundingClientRect());
    S.overlayBtnPos = pos;
    positionFab(fabVideo); // snap to the clamped spot
    saveFabPos(pos.fx, pos.fy);
  };
  el.addEventListener("pointerup", drop);
  el.addEventListener("pointercancel", drop);
  el.addEventListener("dblclick", (e) => {
    e.preventDefault();
    dragging = false;
    S.overlayBtnPos = null;
    if (fabVideo) positionFab(fabVideo);
    resetFabPos();
  });
}

function mount(): void {
  host = document.createElement("div");
  host.setAttribute("data-vtp-launcher", "");
  shadow = host.attachShadow({ mode: "open" });
  fab = document.createElement("button");
  fab.type = "button";
  fab.setAttribute("aria-label", i18n("overlayBtnAria") || "Open Video Tuner");
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
    background: "rgba(20,20,22,0.45)",
    boxShadow: "0 0 0 1px rgba(255,255,255,0.12), 0 6px 20px rgba(0,0,0,0.35)",
    WebkitBackdropFilter: "blur(12px) saturate(160%)",
    backdropFilter: "blur(12px) saturate(160%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: "0",
    transition: "opacity .25s",
    pointerEvents: "none",
  } as Partial<CSSStyleDeclaration>);
  // The play triangle from the toolbar icon (its brand mark), nudged right to
  // sit optically centered in the circle.
  fab.innerHTML =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M9 6.5v11l9-5.5z"/></svg>';
  shadow.append(fab);
  hookFabDrag(fab);
}

function hookMouse(): void {
  if (mouseHooked) return;
  mouseHooked = true;
  document.addEventListener(
    "mousemove",
    (e) => {
      const v = fabVideo;
      if (!eligible() || !fab || !v) return;
      const r = v.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        return;
      flashFab();
    },
    { passive: true },
  );
  // The embedded popup reports its content height (so the iframe grows like the
  // real popup) and asks to close on Escape. Only trust messages from our frame.
  window.addEventListener("message", (e) => {
    if (!frame || e.source !== frame.contentWindow) return;
    const d = e.data as { type?: string; height?: number; close?: boolean } | null;
    if (!d || d.type !== "vtp-overlay") return;
    if (d.close) closePopup();
    else if (typeof d.height === "number" && d.height > 0) {
      frameH = Math.round(d.height);
      layoutFrame();
    }
  });
  // Esc with focus on the page (the in-iframe case is covered by the message above).
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && open) closePopup();
    },
    true,
  );
  window.addEventListener("resize", () => open && layoutFrame(), { passive: true });
  document.addEventListener("fullscreenchange", () => {
    updateLauncher();
    if (eligible()) flashFab(); // surface it the moment fullscreen begins
  });
}

// Keep the launcher's eligibility, parent and position fresh (called each tick +
// on the relevant storage/fullscreen changes). Visibility itself is mouse-driven
// (flashFab), except while the popup is open.
export function updateLauncher(): void {
  fabVideo = primaryVideo();
  if (S.overlayButton === "off" || !eligible()) {
    if (open) closePopup();
    if (fab) {
      fab.style.opacity = "0";
      fab.style.pointerEvents = "none";
    }
    return;
  }
  if (!host) mount();
  hookMouse();
  const fsEl = document.fullscreenElement;
  const parent: Element = fsEl && fsEl.tagName !== "VIDEO" ? fsEl : document.body;
  if (host && host.parentNode !== parent) parent.appendChild(host);
  if (fabVideo && !dragging) positionFab(fabVideo);
  if (open) flashFab(); // keep it up while the popup is showing
}
