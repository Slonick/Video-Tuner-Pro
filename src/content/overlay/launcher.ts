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
import { ensureGlassFilter } from "../../shared/glass.js";

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
let panelOverlay: HTMLDivElement | null = null; // transient capture layer while dragging the panel
let lastHeaderClick = 0; // timestamp of the last no-move header press (for double-click → recentre)
let frameH = FALLBACK_H;
let frameScale = 1; // last fit-scale from layoutFrame, reused by the open animation
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
  frame.style.left = p ? Math.round(p.fx * window.innerWidth) + "px" : "50%";
  frame.style.top = p ? Math.round(p.fy * window.innerHeight) + "px" : "50%";
}

function savePanelPos(fx: number, fy: number): void {
  if (!ctxValid()) return;
  STORE.get(["overlayPanelPos"], (r) => {
    const map = (r.overlayPanelPos || {}) as Record<string, { fx: number; fy: number }>;
    map[getDomain()] = { fx, fy };
    STORE.set({ overlayPanelPos: map });
  });
}

function resetPanelPos(): void {
  S.overlayPanelPos = null;
  positionPanel();
  if (!ctxValid()) return;
  STORE.get(["overlayPanelPos"], (r) => {
    const map = (r.overlayPanelPos || {}) as Record<string, { fx: number; fy: number }>;
    delete map[getDomain()];
    STORE.set({ overlayPanelPos: map });
  });
}

// Drag the panel by its header (the embedded popup posts drag-start with screen
// coords). A transparent capture layer above the iframe tracks the pointer — the
// iframe would otherwise swallow the moves. Clamped so the panel stays on screen.
function startPanelDrag(sx: number, sy: number): void {
  if (!frame || !shadow || panelOverlay) return;
  const r = frame.getBoundingClientRect();
  const startCx = r.left + r.width / 2,
    startCy = r.top + r.height / 2;
  const hw = r.width / 2,
    hh = r.height / 2;
  let cx = startCx,
    cy = startCy,
    moved = false;
  const ov = document.createElement("div");
  Object.assign(ov.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    cursor: "grabbing",
  } as Partial<CSSStyleDeclaration>);
  const onMove = (e: PointerEvent) => {
    moved = true;
    cx = Math.min(window.innerWidth - hw, Math.max(hw, startCx + (e.screenX - sx)));
    cy = Math.min(window.innerHeight - hh, Math.max(hh, startCy + (e.screenY - sy)));
    if (frame) {
      frame.style.left = Math.round(cx) + "px";
      frame.style.top = Math.round(cy) + "px";
    }
  };
  const onUp = () => {
    ov.remove();
    panelOverlay = null;
    if (moved) {
      savePanelPos(cx / window.innerWidth, cy / window.innerHeight); // a click ≠ a move
      lastHeaderClick = 0;
      return;
    }
    // A press with no move is a click; two within 350ms = double-click → recentre.
    // (The capture layer eats the iframe's own dblclick, so we detect it here.)
    const now = Date.now();
    if (now - lastHeaderClick < 350) {
      lastHeaderClick = 0;
      resetPanelPos();
    } else {
      lastHeaderClick = now;
    }
  };
  ov.addEventListener("pointermove", onMove);
  ov.addEventListener("pointerup", onUp);
  ov.addEventListener("pointercancel", onUp);
  shadow.append(ov);
  panelOverlay = ov;
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
  open = true;
  fab?.setAttribute("aria-expanded", "true"); // morphs the icon play → ✕
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
    // Chrome makes the overlay iframe TRANSPARENT only when its color-scheme matches
    // the host's used scheme; a mismatch paints an opaque backdrop. And the host's
    // scheme isn't readable inside the iframe (Facebook forces it via <meta>, which
    // getComputedStyle doesn't surface). So compute it HERE and pass two things:
    //   host  → the popup sets color-scheme to match → transparent on any site;
    //   os    → the popup themes the glass to the OS (decoupled from color-scheme).
    frame.src = api.runtime.getURL("popup/popup.html") + overlaySchemeHash();
    // The panel blurs the video behind it — backdrop-filter on the iframe element
    // (in the page) is reliable, unlike a filter applied inside the iframe document.
    // The translucent tint lives in the popup's own CSS (html.vtp-embedded, theme
    // aware), so it's left off here; this element only supplies blur + the frame.
    Object.assign(frame.style, {
      position: "fixed",
      left: "50%",
      top: "50%",
      border: "1px solid rgba(255,255,255,0.14)", // hairline edge for the glass panel
      borderRadius: "16px",
      WebkitBackdropFilter: "blur(10px) saturate(180%) brightness(1.04)",
      backdropFilter: "blur(10px) saturate(180%) brightness(1.04) url(#vtp-glass)",
      boxShadow: "0 24px 70px rgba(0,0,0,0.5)",
      colorScheme: "normal",
      zIndex: "2147483647",
    } as Partial<CSSStyleDeclaration>);
    shadow.append(backdrop, frame);
  }
  backdrop!.style.display = "block";
  frame.style.display = "block";
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
  fab?.setAttribute("aria-expanded", "false"); // morphs the icon ✕ → play
  if (frame) frame.style.display = "none";
  if (backdrop) backdrop.style.display = "none";
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
  fabVideo = primaryVideo();
  if (!fabVideo) return; // nothing to overlay
  if (!host) mount();
  hookMouse();
  const fsEl = document.fullscreenElement;
  const parent: Element = fsEl && fsEl.tagName !== "VIDEO" ? fsEl : document.body;
  if (host && host.parentNode !== parent) parent.appendChild(host);
  if (!dragging) positionFab(fabVideo);
  togglePopup();
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
  host.style.setProperty("--glass-opacity", String(S.glassOpacity)); // scales the FAB glass
  shadow = host.attachShadow({ mode: "open" });
  ensureGlassFilter(shadow); // our liquid-glass displacement filter, scoped to this shadow
  fab = document.createElement("button");
  fab.type = "button";
  fab.setAttribute("aria-label", i18n("overlayBtnAria") || "Open Video Tuner");
  fab.setAttribute("aria-expanded", "false");
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
    WebkitBackdropFilter: "blur(7px) saturate(180%) brightness(1.04)",
    backdropFilter: "blur(7px) saturate(180%) brightness(1.04) url(#vtp-glass)",
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
    "button[aria-expanded='true'] .vtp-ico-play{opacity:0;transform:rotate(90deg) scale(.4)}" +
    "button[aria-expanded='true'] .vtp-ico-close{opacity:1;transform:none}" +
    "@media (prefers-reduced-motion:reduce){.vtp-ico{transition:none}}";
  shadow.append(iconStyle);
  fab.innerHTML =
    // Play triangle (brand mark), nudged right to sit optically centred.
    '<span class="vtp-ico vtp-ico-play"><svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 6.5v11l9-5.5z"/></svg></span>' +
    // Cross (shown while the overlay is open).
    '<span class="vtp-ico vtp-ico-close"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></span>';
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
    const d = e.data as {
      type?: string;
      height?: number;
      close?: boolean;
      drag?: string;
      sx?: number;
      sy?: number;
    } | null;
    if (!d || d.type !== "vtp-overlay") return;
    if (d.close) closePopup();
    else if (d.drag === "start" && typeof d.sx === "number" && typeof d.sy === "number")
      startPanelDrag(d.sx, d.sy);
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
  window.addEventListener(
    "resize",
    () => {
      if (!open) return;
      layoutFrame();
      positionPanel();
    },
    { passive: true },
  );
  document.addEventListener("fullscreenchange", () => {
    updateLauncher();
    if (eligible()) flashFab(); // surface it the moment fullscreen begins
  });
}

// Keep the launcher's eligibility, parent and position fresh (called each tick +
// on the relevant storage/fullscreen changes). Visibility itself is mouse-driven
// (flashFab), except while the popup is open.
function hideFab(): void {
  if (!fab) return;
  fab.style.opacity = "0";
  fab.style.pointerEvents = "none";
}

// Re-apply the glass-opacity multiplier (General setting) to the launcher glass.
export function applyLauncherGlass(): void {
  host?.style.setProperty("--glass-opacity", String(S.glassOpacity));
}

export function updateLauncher(): void {
  fabVideo = primaryVideo();
  // No video to overlay → nothing can show; close any open popup and hide the FAB.
  if (!fabVideo) {
    if (open) closePopup();
    hideFab();
    return;
  }
  if (S.overlayButton === "off" || !eligible()) {
    // The button is hidden in this mode, but a popup opened via the overlay hotkey
    // stays up (the hotkey is independent of the button). Keep its host attached to
    // the right parent (e.g. on entering fullscreen) and only hide the button.
    hideFab();
    if (open && host) {
      const fsEl = document.fullscreenElement;
      const parent: Element = fsEl && fsEl.tagName !== "VIDEO" ? fsEl : document.body;
      if (host.parentNode !== parent) parent.appendChild(host);
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
