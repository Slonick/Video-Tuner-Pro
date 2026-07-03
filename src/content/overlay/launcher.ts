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
import { toggleViewer, exitViewer, viewerFormat } from "../viewer.js";
import { ensureGlassFilter, GLASS_REFRACTION } from "../../shared/glass.js";

type Timer = ReturnType<typeof setTimeout>;

const FAB_SIZE = 44; // px — the button's box
const R_ITEM = 36; // px — one radial-menu item's box
const R_DIST = 62; // px — item centre's distance from the FAB centre
const R_SPREAD = Math.PI / 3.6; // 50° between neighbouring radial items
const R_HIDE_MS = 350; // grace period for the pointer to travel FAB → item
const MARGIN = 16; // px — default inset from the video's right edge
const POPUP_W = 684; // px — the popup's fixed width (popup base.css)
const FIT_MARGIN = 24; // px — keep the overlay this far from the viewport edges
const FALLBACK_H = 520; // px — height before the popup reports its real one

let host: HTMLDivElement | null = null; // shadow host (light DOM) we re-parent + mark
let shadow: ShadowRoot | null = null;
let fab: HTMLButtonElement | null = null;
// Radial menu around the FAB (revealed on hover): pop-out normal, pop-out
// theater, and — only while the viewer is open — exit.
let rItems: {
  normal: HTMLButtonElement;
  theater: HTMLButtonElement;
  exit: HTMLButtonElement;
} | null = null;
let radialOpen = false;
let radialTimer: Timer | undefined;
let radialIdleTimer: Timer | undefined;
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

function removeStaleHosts(): void {
  document.querySelectorAll("[data-vtp-launcher]").forEach((node) => {
    if (node !== host) node.remove();
  });
}

function eligible(): boolean {
  if (!fabVideo) return false;
  if (S.overlayButton === "always") return true;
  // In fullscreen mode the FAB also surfaces while the pop-out viewer is open,
  // so its radial menu (switch format / exit) stays reachable by mouse.
  if (S.overlayButton === "fullscreen") return !!document.fullscreenElement || !!viewerFormat();
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
  if (radialOpen) layoutRadial();
}

// The radial items currently on offer: both formats, plus exit while the viewer
// is open.
function radialList(): HTMLButtonElement[] {
  if (!rItems) return [];
  const items = [rItems.normal, rItems.theater];
  if (viewerFormat()) items.push(rItems.exit);
  return items;
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
  });
}

// Reflect the viewer's state on the items: the active format reads as pressed,
// and exit is only offered while something is open.
function syncRadial(): void {
  if (!rItems) return;
  const f = viewerFormat();
  rItems.normal.setAttribute("aria-pressed", f === "normal" ? "true" : "false");
  rItems.theater.setAttribute("aria-pressed", f === "theater" ? "true" : "false");
  rItems.exit.style.display = f ? "flex" : "none";
}

function openRadial(): void {
  if (!rItems || !fab) return;
  clearTimeout(radialTimer);
  clearTimeout(radialIdleTimer);
  radialOpen = true;
  syncRadial();
  layoutRadial();
  for (const b of radialList()) {
    b.style.opacity = "1";
    b.style.pointerEvents = "auto";
  }
  radialIdleTimer = setTimeout(() => closeRadial(true), 2600);
  flashFab(); // the menu holds the FAB up too
}

// `resumeHide` restarts the FAB's auto-hide countdown — wanted when the pointer
// wandered off (the FAB shouldn't stay lit forever), but not from the auto-hide
// timeout itself, which would re-show the FAB it just hid.
function closeRadial(resumeHide = false): void {
  radialOpen = false;
  clearTimeout(radialTimer);
  clearTimeout(radialIdleTimer);
  if (rItems) {
    for (const b of Object.values(rItems)) {
      b.style.opacity = "0";
      b.style.pointerEvents = "none";
    }
  }
  if (resumeHide) flashFab();
}

// Leaving the FAB or an item starts a short countdown, so the pointer can hop
// between them without the menu collapsing mid-travel.
function scheduleRadialClose(): void {
  clearTimeout(radialTimer);
  radialTimer = setTimeout(() => closeRadial(true), R_HIDE_MS);
}

function ownsRadialEvent(e: Event): boolean {
  const path = e.composedPath();
  return !!(fab && path.includes(fab)) || radialList().some((b) => path.includes(b));
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
  frame.style.left = Math.round(pdCx) + "px";
  frame.style.top = Math.round(pdCy) + "px";
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
  closeRadial();
  open = true;
  fab?.setAttribute("aria-expanded", "true"); // morphs the icon play → ✕
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
    backdropFilter: "blur(10px) saturate(180%) brightness(1.04)" + GLASS_REFRACTION,
    boxShadow: "0 24px 70px rgba(0,0,0,0.5)",
    colorScheme: "normal",
    zIndex: "2147483647",
  } as Partial<CSSStyleDeclaration>);
  shadow.append(frame);
  frame.style.display = "block";
  backdrop.style.display = "block"; // cached backdrop is hidden on close — re-show it
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
    closeRadial(); // repositioning — the menu would lag behind the button
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
  removeStaleHosts();
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
    backdropFilter: "blur(7px) saturate(180%) brightness(1.04)" + GLASS_REFRACTION,
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
  // The radial menu items (same glass as the FAB, revealed on hover). Clicking
  // an item acts and re-opens the menu so its state (pressed format, the exit
  // item appearing/disappearing) refreshes in place.
  const act = (fn: () => void) => () => {
    fn();
    openRadial();
  };
  rItems = {
    normal: radialButton(
      // Pop-out mark: a frame with an arrow leaving through its top-right corner.
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5M14 4h6v6M20 4l-9 9"/></svg>',
      i18n("viewerBtnAria") || "Pop out video",
      act(() => toggleViewer("normal")),
    ),
    theater: radialButton(
      // Theater mark: a wide letterboxed frame.
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"/></svg>',
      i18n("viewerTheaterAria") || "Pop out in theater format",
      act(() => toggleViewer("theater")),
    ),
    exit: radialButton(
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
      i18n("viewerCloseAria") || "Close the pop-out viewer",
      act(exitViewer),
    ),
  };
  shadow.append(rItems.normal, rItems.theater, rItems.exit);
  fab.addEventListener("mouseenter", openRadial);
  fab.addEventListener("mouseleave", scheduleRadialClose);
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
    WebkitBackdropFilter: "blur(7px) saturate(180%) brightness(1.04)",
    backdropFilter: "blur(7px) saturate(180%) brightness(1.04)" + GLASS_REFRACTION,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: "0",
    transition: "opacity .2s",
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
  return b;
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
    }
  });
  // Esc with focus on the page (the in-iframe case is covered by the message above).
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      if (open) closePopup();
      else closeRadial();
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
    closeRadial();
    updateLauncher();
    if (eligible()) flashFab(); // surface it the moment fullscreen begins
  });
  document.addEventListener(
    "pointermove",
    (e) => {
      if (!radialOpen) return;
      if (ownsRadialEvent(e)) openRadial();
      else scheduleRadialClose();
    },
    { passive: true, capture: true },
  );
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (radialOpen && !ownsRadialEvent(e)) closeRadial(true);
    },
    true,
  );
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) closeRadial();
  });
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

// Re-apply the glass-opacity multiplier (General setting) to the launcher glass.
export function applyLauncherGlass(): void {
  host?.style.setProperty("--glass-opacity", String(S.glassOpacity));
}

export function updateLauncher(): void {
  removeStaleHosts();
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
  // The viewer can close behind our back (Esc, backdrop click) — refresh an
  // open menu so its pressed states and exit item stay honest.
  if (radialOpen) openRadial();
  if (open) flashFab(); // keep it up while the popup is showing
}
