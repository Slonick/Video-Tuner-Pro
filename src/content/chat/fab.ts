// On-video chat button: a small glass FAB pinned to the top-right of the video
// inside the viewer, shown only on supported live streams. Clicking it toggles
// the chat off/on (returning to the last used mode); hovering it fans out a
// two-item menu that picks the mode (side / overlay) directly.
import { S } from "../state.js";
import { i18n } from "../platform/i18n.js";
import { ensureGlassFilter, GLASS_REFRACTION } from "../../shared/glass.js";
import { animateIn, glide } from "./motion.js";
import { popoverElevation } from "./popover.js";
import type { ViewerChatMode } from "./index.js";

const FAB_SIZE = 40;
const EDGE = 12;
const MENU_HIDE_MS = 500;
// Auto-hide on pointer inactivity, mirroring the viewer bar's cadence.
const IDLE_HIDE_MS = 2600;
const HIDDEN_ATTR = "data-vtp-fab-hidden";

const I_CHAT =
  '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.5A8 8 0 1 1 21 12z"/><path d="M8.5 10.5h7M8.5 14h4.5"/></svg>';
const I_SIDE =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M15 5v14" /><path d="M17.5 9h1M17.5 12h1" stroke-width="1.8"/></svg>';
const I_OVERLAY =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="6" y="11" width="8" height="6" rx="1.5" fill="currentColor" stroke="none" opacity=".85"/></svg>';

export interface ChatFab {
  host: HTMLElement;
  // Pin the button inside the video box's top-right corner. `right` is the
  // video's right edge in viewport px, `top` its top edge.
  layout(box: { right: number; top: number }): void;
  // Reflect the current mode on the toggle + menu buttons.
  applyMode(): void;
  elevate(): void;
  reelevate(): void;
  // Re-append to the top layer after the player itself was re-shown.
  raise(): void;
  // Transition window for the next layout() — see motion.ts.
  glide(ms: number): void;
  destroy(): void;
}

export function mountChatFab(
  overlay: HTMLElement,
  setMode: (mode: ViewerChatMode) => void,
): ChatFab {
  const host = document.createElement("div");
  host.setAttribute("data-vtp-viewer-chat-fab", "");
  Object.assign(host.style, {
    position: "fixed",
    top: `${EDGE}px`,
    right: `${EDGE}px`,
    // Pin the UA popover inset (left/bottom would otherwise stay 0 when the
    // host is elevated to the top layer).
    left: "auto",
    bottom: "auto",
    width: `${FAB_SIZE}px`,
    // Tall enough to hold the fanned-out menu; clicks only land on buttons.
    height: `${FAB_SIZE * 3 + 16}px`,
    zIndex: "4",
    margin: "0",
    border: "0",
    padding: "0",
    background: "transparent",
    overflow: "visible",
    pointerEvents: "none",
  } as Partial<CSSStyleDeclaration>);
  const shadow = host.attachShadow({ mode: "open" });
  ensureGlassFilter(shadow);
  const style = document.createElement("style");
  style.textContent =
    `:host{transition:opacity .25s}` +
    `:host([${HIDDEN_ATTR}]){opacity:0}` +
    `:host([${HIDDEN_ATTR}]) button{pointer-events:none!important}` +
    `button{pointer-events:auto;width:${FAB_SIZE}px;height:${FAB_SIZE}px;border:0;border-radius:999px;` +
    `display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;` +
    `background:rgb(20 20 22 / calc(0.4 * var(--glass-opacity,1)));` +
    `box-shadow:0 0 0 1px rgba(255,255,255,0.14),0 8px 24px rgba(0,0,0,0.35);` +
    `-webkit-backdrop-filter:${GLASS_REFRACTION}blur(10px) saturate(180%) brightness(1.04);` +
    `backdrop-filter:${GLASS_REFRACTION}blur(10px) saturate(180%) brightness(1.04);` +
    `transition:background .15s,opacity .18s,transform .18s}` +
    `button:hover{background:rgb(40 40 44 / calc(0.55 * var(--glass-opacity,1)))}` +
    `button:focus-visible{outline:0;box-shadow:0 0 0 3px rgba(10,132,255,0.72)}` +
    `.fab[aria-pressed="true"]{box-shadow:0 0 0 1px rgba(10,132,255,0.9),0 8px 24px rgba(0,0,0,0.35)}` +
    `.mode{position:absolute;left:0;width:${FAB_SIZE}px;height:${FAB_SIZE}px;` +
    `opacity:0;transform:translateY(-6px) scale(.85);pointer-events:none!important}` +
    `.mode.show{opacity:1;transform:none;pointer-events:auto!important}` +
    `.mode[aria-pressed="true"]{background:rgb(10 132 255 / 0.55)}` +
    `.m-side{top:${FAB_SIZE + 8}px}` +
    `.m-overlay{top:${FAB_SIZE * 2 + 16}px}`;
  const fab = document.createElement("button");
  fab.className = "fab";
  fab.title = i18n("chatModeLabel") || "Stream chat";
  fab.setAttribute("aria-label", i18n("chatModeLabel") || "Stream chat");
  fab.innerHTML = I_CHAT;
  const mkMode = (
    cls: string,
    svg: string,
    label: string,
    mode: ViewerChatMode,
  ): HTMLButtonElement => {
    const b = document.createElement("button");
    b.className = `mode ${cls}`;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.innerHTML = svg;
    b.addEventListener("click", () => setMode(mode));
    return b;
  };
  const sideBtn = mkMode("m-side", I_SIDE, i18n("chatModeSide") || "Side", "side");
  const overlayBtn = mkMode(
    "m-overlay",
    I_OVERLAY,
    i18n("chatModeOverlay") || "Overlay",
    "overlay",
  );
  shadow.append(style, fab, sideBtn, overlayBtn);
  overlay.appendChild(host);
  animateIn(host, { opacity: 0, transform: "scale(.85)" });

  // The last non-off mode is what the toggle returns to.
  let lastOn: Exclude<ViewerChatMode, "off"> = S.viewerChatMode === "overlay" ? "overlay" : "side";
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  const pop = popoverElevation(host);
  let hovering = false;

  // Idle auto-hide, like the viewer's control bar: any pointer movement shows
  // the button; stillness fades it out (unless the pointer rests on it).
  // pointermove fires continuously, so the mover only stamps a timestamp and
  // one self-rescheduling timer does the work — no timer churn per event.
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastMove = performance.now();
  let hidden = false;
  const idleCheck = (): void => {
    const left = IDLE_HIDE_MS - (performance.now() - lastMove);
    if (hovering || left > 0) {
      idleTimer = setTimeout(idleCheck, Math.max(100, left));
      return;
    }
    idleTimer = null;
    hidden = true;
    host.setAttribute(HIDDEN_ATTR, "");
  };
  const wake = (): void => {
    lastMove = performance.now();
    if (hidden) {
      hidden = false;
      host.removeAttribute(HIDDEN_ATTR);
    }
    if (idleTimer == null) idleTimer = setTimeout(idleCheck, IDLE_HIDE_MS);
  };
  window.addEventListener("pointermove", wake, { passive: true });
  idleTimer = setTimeout(idleCheck, IDLE_HIDE_MS);

  const showMenu = (show: boolean): void => {
    sideBtn.classList.toggle("show", show);
    overlayBtn.classList.toggle("show", show);
  };
  const scheduleHide = (): void => {
    if (hideTimer != null) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => showMenu(false), MENU_HIDE_MS);
  };
  const cancelHide = (): void => {
    if (hideTimer != null) clearTimeout(hideTimer);
    hideTimer = null;
  };
  for (const el of [fab, sideBtn, overlayBtn]) {
    el.addEventListener("mouseenter", () => {
      hovering = true;
      cancelHide();
      showMenu(true);
    });
    el.addEventListener("mouseleave", () => {
      hovering = false;
      scheduleHide();
    });
  }
  fab.addEventListener("click", () => {
    setMode(S.viewerChatMode === "off" ? lastOn : "off");
  });

  return {
    host,
    layout(box: { right: number; top: number }): void {
      host.style.left = `${Math.round(box.right - FAB_SIZE - EDGE)}px`;
      host.style.right = "auto";
      host.style.top = `${Math.round(box.top + EDGE)}px`;
    },
    applyMode(): void {
      if (S.viewerChatMode !== "off") lastOn = S.viewerChatMode;
      fab.setAttribute("aria-pressed", S.viewerChatMode === "off" ? "false" : "true");
      sideBtn.setAttribute("aria-pressed", S.viewerChatMode === "side" ? "true" : "false");
      overlayBtn.setAttribute("aria-pressed", S.viewerChatMode === "overlay" ? "true" : "false");
    },
    elevate: pop.elevate,
    reelevate: pop.reelevate,
    raise: pop.raise,
    glide: (ms: number) => glide(host, ms),
    destroy(): void {
      cancelHide();
      window.removeEventListener("pointermove", wake);
      if (idleTimer != null) clearTimeout(idleTimer);
      pop.dispose();
      host.remove();
    },
  };
}
