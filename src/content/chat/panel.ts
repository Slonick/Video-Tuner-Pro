// Overlay mode: the same platform popout chat as side mode, but in a floating
// draggable/resizable panel over the video. The iframe page is skinned by our
// content script running INSIDE it (see skin.ts, keyed off the URL hash):
// transparent background, readable text, optional message input. The panel
// itself provides the dark tint behind the transparent chat — its alpha is the
// viewerChatOpacity setting.
import { S } from "../state.js";
import { i18n } from "../platform/i18n.js";
import { STORE } from "../platform/storage.js";
import {
  CHAT_PANEL_HEIGHT_MAX,
  CHAT_PANEL_HEIGHT_MIN,
  CHAT_PANEL_WIDTH_MAX,
  CHAT_PANEL_WIDTH_MIN,
} from "../../shared/chat-bounds.js";
import { sideChatUrl } from "./platform.js";
import { popoverElevation } from "./popover.js";

const EDGE_MARGIN = 12;
// Keeps the default spot clear of the viewer's bottom control bar.
const BAR_CLEARANCE = 96;

// URL hash that tells the content script inside the popout frame to apply the
// overlay skin. Side mode embeds the same URL without it and stays native.
export const OVERLAY_SKIN_HASH = "#vtp-chat-overlay";

export interface ChatPanel {
  host: HTMLElement;
  applySettings(): void;
  // On the native-player-surface path the site's player sits in the top layer —
  // promote the panel there too, after the player, so it paints above it.
  elevate(): void;
  // Guard-tick hook: re-show the popover if the page force-closed it.
  reelevate(): void;
  // Re-append to the top layer after the player itself was re-shown.
  raise(): void;
  destroy(): void;
}

export function mountChatPanel(overlay: HTMLElement): ChatPanel {
  const host = document.createElement("div");
  host.setAttribute("data-vtp-viewer-chat-panel", "");
  const w = S.viewerChatWidth;
  const h = S.viewerChatHeight;
  Object.assign(host.style, {
    position: "fixed",
    left: `${EDGE_MARGIN + 12}px`,
    top: `${Math.max(EDGE_MARGIN, window.innerHeight - h - BAR_CLEARANCE)}px`,
    width: `${w}px`,
    height: `${h}px`,
    zIndex: "3",
    // Popover UA styles (when elevated) reset inset/margin/border — pin them.
    margin: "0",
    border: "0",
    padding: "0",
    overflow: "visible",
    background: "transparent",
  } as Partial<CSSStyleDeclaration>);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent =
    `.panel{display:flex;flex-direction:column;width:100%;height:100%;box-sizing:border-box;` +
    `border-radius:14px;overflow:hidden;` +
    `background:rgb(10 10 12 / var(--vtp-chat-tint,0.4));` +
    `box-shadow:0 0 0 1px rgba(255,255,255,0.12),0 12px 40px rgba(0,0,0,0.4);` +
    `font:12px/1.2 -apple-system,system-ui,sans-serif;color:#fff}` +
    // A slim grab bar: the iframe below swallows pointer events, so dragging
    // works from here only.
    `.head{flex:none;display:flex;align-items:center;justify-content:center;height:18px;` +
    `cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;` +
    `color:rgba(255,255,255,0.5)}` +
    `.head::before{content:"";width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,0.35)}` +
    `.head:active{cursor:grabbing}` +
    `iframe{flex:1;min-height:0;width:100%;border:0;background:transparent}` +
    `.empty{margin:auto;color:rgba(255,255,255,0.55);font-size:13px}` +
    `.grip{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;` +
    `touch-action:none}` +
    `.grip::after{content:"";position:absolute;right:5px;bottom:5px;width:8px;height:8px;` +
    `border-right:2px solid rgba(255,255,255,0.45);border-bottom:2px solid rgba(255,255,255,0.45);` +
    `border-radius:1px}`;
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.style.setProperty("--vtp-chat-tint", String(S.viewerChatOpacity));
  const head = document.createElement("div");
  head.className = "head";
  head.title = i18n("chatModeLabel") || "Stream chat";
  const url = sideChatUrl();
  let body: HTMLElement;
  if (url) {
    const frame = document.createElement("iframe");
    frame.src = url + OVERLAY_SKIN_HASH;
    // Both ends pinned to dark (the skin pins the frame document): a
    // color-scheme mismatch makes Chrome paint an opaque canvas behind the
    // frame, killing the transparency.
    frame.style.colorScheme = "dark";
    body = frame;
  } else {
    body = document.createElement("div");
    body.className = "empty";
    body.textContent = i18n("chatUnavailable") || "Chat unavailable";
  }
  const grip = document.createElement("div");
  grip.className = "grip";
  panel.append(head, body, grip);
  shadow.append(style, panel);
  overlay.appendChild(host);

  const pop = popoverElevation(host);

  const clampPos = (): void => {
    const r = host.getBoundingClientRect();
    const left = Math.min(Math.max(r.left, EDGE_MARGIN - r.width + 48), window.innerWidth - 48);
    const top = Math.min(Math.max(r.top, 0), window.innerHeight - 32);
    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
  };

  // Grab-bar drag. Pointer capture keeps the move alive outside the panel.
  head.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const r = host.getBoundingClientRect();
    const move = (ev: PointerEvent): void => {
      host.style.left = `${Math.round(r.left + ev.clientX - startX)}px`;
      host.style.top = `${Math.round(r.top + ev.clientY - startY)}px`;
    };
    const up = (): void => {
      head.removeEventListener("pointermove", move);
      clampPos();
    };
    head.setPointerCapture(e.pointerId);
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up, { once: true });
    head.addEventListener("pointercancel", up, { once: true });
  });

  // Corner resize; the final size persists so the options sliders stay in sync.
  grip.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const r = host.getBoundingClientRect();
    const move = (ev: PointerEvent): void => {
      const w2 = Math.round(
        Math.min(
          CHAT_PANEL_WIDTH_MAX,
          Math.max(CHAT_PANEL_WIDTH_MIN, r.width + ev.clientX - startX),
        ),
      );
      const h2 = Math.round(
        Math.min(
          CHAT_PANEL_HEIGHT_MAX,
          Math.max(CHAT_PANEL_HEIGHT_MIN, r.height + ev.clientY - startY),
        ),
      );
      host.style.width = `${w2}px`;
      host.style.height = `${h2}px`;
    };
    const up = (): void => {
      grip.removeEventListener("pointermove", move);
      const rect = host.getBoundingClientRect();
      STORE.set({
        viewerChatWidth: Math.round(rect.width),
        viewerChatHeight: Math.round(rect.height),
      });
    };
    grip.setPointerCapture(e.pointerId);
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up, { once: true });
    grip.addEventListener("pointercancel", up, { once: true });
  });

  return {
    host,
    applySettings(): void {
      panel.style.setProperty("--vtp-chat-tint", String(S.viewerChatOpacity));
      host.style.width = `${S.viewerChatWidth}px`;
      host.style.height = `${S.viewerChatHeight}px`;
      clampPos();
    },
    elevate: pop.elevate,
    reelevate: pop.reelevate,
    raise: pop.raise,
    destroy(): void {
      pop.dispose();
      host.remove();
    },
  };
}
