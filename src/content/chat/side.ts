// Side mode: the platform's own popout chat in an iframe, docked inside the
// viewer overlay. Same-origin with the page, so the user's session applies —
// they can write, use emotes, etc. The viewer drives its geometry via layout():
// theater fills the right edge top-to-bottom; normal sits beside the video card
// and matches its height. The frame gets the same overlay skin as the floating
// panel (no header chrome, transparent chat) over a denser tint of its own.
// Dragging the left edge resizes the column; the facade persists the width per
// site and per format.
import { S } from "../state.js";
import { i18n } from "../platform/i18n.js";
import { animateIn, animateOutAndRemove, glide } from "./motion.js";
import { SIDE_CHAT_MAX, SIDE_CHAT_MIN, SIDE_CHAT_WIDTH } from "../../shared/chat-bounds.js";
import { sideChatUrl } from "./platform.js";
import { SIDE_SKIN_HASH } from "./panel.js";

export { SIDE_CHAT_WIDTH, SIDE_CHAT_MIN, SIDE_CHAT_MAX };

function sideTint(): string {
  // A step darker than the floating panel, proportionally — a quarter of the
  // way toward opaque — so the column never saturates into a solid plate.
  const tint = S.viewerChatOpacity + (1 - S.viewerChatOpacity) * 0.25;
  return `rgb(10 10 12 / ${Math.round(tint * 100) / 100})`;
}

// Where the column goes: "fill" = full-height dock at the right edge (theater);
// a box = a panel glued to the video card's right edge (normal format). The
// width always comes from the viewer's layout pass.
export type SideChatBox =
  | { fill: true; width: number }
  | { left: number; top: number; height: number; width: number };

export interface SideChatCallbacks {
  // Live width while the left edge is being dragged (already clamped).
  onResize(width: number): void;
  // The drag ended — persist the final width.
  onResizeEnd(width: number): void;
}

export interface SideChat {
  el: HTMLElement;
  layout(box: SideChatBox): void;
  applySettings(): void;
  // Open a short transition window so the next layout() glides along with the
  // viewer's own video animation instead of snapping.
  glide(ms: number): void;
  // `instant` removes the column without its slide-out — used on a full viewer
  // exit so it doesn't animate on a different clock than the video's FLIP.
  destroy(instant?: boolean): void;
}

export function mountSideChat(overlay: HTMLElement, cb: SideChatCallbacks): SideChat | null {
  const url = sideChatUrl();
  if (!url) return null;
  const col = document.createElement("div");
  col.setAttribute("data-vtp-viewer-chat-side", "");
  Object.assign(col.style, {
    position: "absolute",
    top: "0",
    right: "0",
    bottom: "0",
    width: `${SIDE_CHAT_WIDTH}px`,
    zIndex: "2",
    background: sideTint(),
    overflow: "hidden",
    boxShadow: "-1px 0 0 rgba(255,255,255,0.12)",
  } as Partial<CSSStyleDeclaration>);
  // Sits behind the iframe: visible while the frame loads, or if the platform
  // refuses to render (a blocked frame can't be detected reliably — best
  // effort). The skinned frame is transparent, so it must go once the frame
  // actually loads or it shows through the chat.
  const fallback = document.createElement("div");
  fallback.textContent = i18n("chatUnavailable") || "Chat unavailable";
  Object.assign(fallback.style, {
    position: "absolute",
    inset: "0",
    display: "grid",
    placeItems: "center",
    color: "rgba(255,255,255,0.55)",
    font: "13px/1.4 -apple-system,system-ui,sans-serif",
  } as Partial<CSSStyleDeclaration>);
  const frame = document.createElement("iframe");
  frame.src = url + SIDE_SKIN_HASH;
  // Both ends pinned to dark (the skin pins the frame document): a color-scheme
  // mismatch makes Chrome paint an opaque canvas behind the frame.
  frame.style.colorScheme = "dark";
  Object.assign(frame.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    border: "0",
    background: "transparent",
  } as Partial<CSSStyleDeclaration>);
  frame.addEventListener("load", () => fallback.remove(), { once: true });
  // Left-edge resize handle. The iframe swallows pointer events, so the strip
  // sits above it; pointer capture keeps the drag alive over the frame.
  const grip = document.createElement("div");
  Object.assign(grip.style, {
    position: "absolute",
    left: "0",
    top: "0",
    bottom: "0",
    width: "6px",
    cursor: "ew-resize",
    zIndex: "3",
    touchAction: "none",
  } as Partial<CSSStyleDeclaration>);
  grip.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = col.getBoundingClientRect().width;
    let lastW = Math.round(startW);
    let moved = false;
    // One controller per gesture: whichever of pointerup/pointercancel ends it
    // drops all three listeners, so no leftover handler replays on a later one.
    const gesture = new AbortController();
    const move = (ev: PointerEvent): void => {
      moved = true;
      lastW = Math.round(
        Math.min(SIDE_CHAT_MAX, Math.max(SIDE_CHAT_MIN, startW + (startX - ev.clientX))),
      );
      cb.onResize(lastW);
    };
    const up = (): void => {
      gesture.abort();
      if (moved) cb.onResizeEnd(lastW); // a plain press saves nothing
    };
    const opt = { signal: gesture.signal };
    grip.setPointerCapture(e.pointerId);
    grip.addEventListener("pointermove", move, opt);
    grip.addEventListener("pointerup", up, opt);
    grip.addEventListener("pointercancel", up, opt);
  });
  col.append(fallback, frame, grip);
  overlay.appendChild(col);
  animateIn(col, { opacity: 0, transform: "translateX(32px)" });
  return {
    el: col,
    layout(box: SideChatBox): void {
      if ("fill" in box) {
        Object.assign(col.style, {
          left: "auto",
          top: "0",
          right: "0",
          bottom: "0",
          height: "auto",
          width: `${Math.round(box.width)}px`,
          borderRadius: "0",
          boxShadow: "-1px 0 0 rgba(255,255,255,0.12)",
        } as Partial<CSSStyleDeclaration>);
      } else {
        Object.assign(col.style, {
          left: `${Math.round(box.left)}px`,
          top: `${Math.round(box.top)}px`,
          right: "auto",
          bottom: "auto",
          height: `${Math.round(box.height)}px`,
          width: `${Math.round(box.width)}px`,
          // Flush with the card: only the outer corners are rounded.
          borderRadius: "0 12px 12px 0",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.14),0 12px 40px rgba(0,0,0,0.4)",
        } as Partial<CSSStyleDeclaration>);
      }
    },
    applySettings(): void {
      col.style.background = sideTint();
    },
    glide: (ms: number) => glide(col, ms),
    destroy(instant = false): void {
      // Drop the marker first so a replacement column can mount while this one
      // is still fading out.
      col.removeAttribute("data-vtp-viewer-chat-side");
      if (instant) {
        col.remove();
        return;
      }
      animateOutAndRemove(col, { transform: "translateX(24px)" });
    },
  };
}
