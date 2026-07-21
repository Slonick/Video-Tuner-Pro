// Overlay mode: the same platform popout chat as side mode, but in a floating
// draggable/resizable panel over the video. The iframe page is skinned by our
// content script running INSIDE it (see skin.ts, keyed off the URL hash):
// transparent background, readable text, optional message input. The panel
// itself provides the dark tint behind the transparent chat. Adjustments made
// on the panel — dragging, resizing, the tint slider in its hover-only head —
// persist per site through the facade's callbacks; the global settings from
// the options page act as the defaults.
import { S } from "../state.js";
import { i18n } from "../platform/i18n.js";
import {
  CHAT_PANEL_HEIGHT_MAX,
  CHAT_PANEL_HEIGHT_MIN,
  CHAT_PANEL_WIDTH_MAX,
  CHAT_PANEL_WIDTH_MIN,
} from "../../shared/chat-bounds.js";
import { anchorFromRect, positionFromAnchor, type PanelAnchor, type PanelBox } from "./anchor.js";
import { animateIn, animateOutAndRemove, glide } from "./motion.js";
import { sideChatUrl } from "./platform.js";
import { popoverElevation } from "./popover.js";

const EDGE_MARGIN = 12;
// Keeps the default spot clear of the viewer's bottom control bar.
const BAR_CLEARANCE = 96;
const HEAD_HEIGHT = 22;
// Fresh sites start at the video's bottom-left corner, above the bar.
const DEFAULT_ANCHOR: PanelAnchor = { h: "left", v: "bottom", dx: 24, dy: BAR_CLEARANCE };

// URL hash that tells the content script inside the popout frame to apply the
// overlay skin. Side mode embeds the same URL without it and stays native.
export const OVERLAY_SKIN_HASH = "#vtp-chat-overlay";

// Everything the panel remembers about a site. All fields optional — absent
// ones fall back to the global settings / the default anchor.
export interface ChatPanelPrefs {
  opacity?: number;
  width?: number;
  height?: number;
  h?: "left" | "right";
  v?: "top" | "bottom";
  dx?: number;
  dy?: number;
}

export interface ChatPanelCallbacks {
  // The current site's remembered prefs (empty object when none).
  prefs(): ChatPanelPrefs;
  // Merge a change into the site's entry and persist it.
  persist(patch: ChatPanelPrefs): void;
}

export interface ChatPanel {
  host: HTMLElement;
  // The viewer's layout pass reports the video box; the panel keeps its spot
  // relative to the box's nearest edges.
  layout(box: PanelBox): void;
  applySettings(): void;
  // On the native-player-surface path the site's player sits in the top layer —
  // promote the panel there too, after the player, so it paints above it.
  elevate(): void;
  // Guard-tick hook: re-show the popover if the page force-closed it.
  reelevate(): void;
  // Re-append to the top layer after the player itself was re-shown.
  raise(): void;
  // Transition window for the next layout()/applySettings() — see motion.ts.
  glide(ms: number): void;
  destroy(): void;
}

export function mountChatPanel(overlay: HTMLElement, cb: ChatPanelCallbacks): ChatPanel | null {
  // Like side mode: with no popout URL yet (e.g. YouTube's video id hasn't
  // arrived after navigation), stay unmounted so the facade's guard retries once
  // it resolves — rather than parking a panel that's stuck "unavailable" forever.
  const url = sideChatUrl();
  if (!url) return null;
  const effOpacity = (): number => cb.prefs().opacity ?? S.viewerChatOpacity;
  const effWidth = (): number => cb.prefs().width ?? S.viewerChatWidth;
  const effHeight = (): number => cb.prefs().height ?? S.viewerChatHeight;
  const effAnchor = (): PanelAnchor => {
    const p = cb.prefs();
    return p.h != null && p.v != null && p.dx != null && p.dy != null
      ? { h: p.h, v: p.v, dx: p.dx, dy: p.dy }
      : DEFAULT_ANCHOR;
  };

  const host = document.createElement("div");
  host.setAttribute("data-vtp-viewer-chat-panel", "");
  Object.assign(host.style, {
    position: "fixed",
    left: `${EDGE_MARGIN + 12}px`,
    top: `${Math.max(EDGE_MARGIN, window.innerHeight - effHeight() - BAR_CLEARANCE)}px`,
    width: `${effWidth()}px`,
    height: `${effHeight()}px`,
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
    // The control head floats over the chat's top edge and shows only while
    // the pointer is on it (an invisible element still hit-tests), so the
    // overlay stays chrome-free. The iframe below swallows pointer events, so
    // dragging works from here only.
    `.head{position:absolute;left:0;top:0;right:0;height:${HEAD_HEIGHT}px;z-index:1;` +
    `display:flex;align-items:center;gap:8px;padding:0 8px;box-sizing:border-box;` +
    `border-radius:14px 14px 0 0;background:rgba(10,10,12,0.65);` +
    `cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;` +
    `color:rgba(255,255,255,0.5);opacity:0;transform:translateY(-5px);` +
    `transition:opacity .28s ease,transform .28s ease}` +
    `.head:hover,.head:focus-within{opacity:1;transform:none}` +
    `.head:active{cursor:grabbing}` +
    `.pill{flex:1;display:flex;justify-content:center;pointer-events:none}` +
    `.pill::before{content:"";width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,0.35)}` +
    `.tint{flex:none;width:88px;height:12px;margin:0;cursor:pointer;accent-color:#0a84ff}` +
    `iframe{flex:1;min-height:0;width:100%;border:0;background:transparent}` +
    `.grip{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;` +
    `touch-action:none;z-index:1}` +
    `.grip::after{content:"";position:absolute;right:5px;bottom:5px;width:8px;height:8px;` +
    `border-right:2px solid rgba(255,255,255,0.45);border-bottom:2px solid rgba(255,255,255,0.45);` +
    `border-radius:1px}`;
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.style.setProperty("--vtp-chat-tint", String(effOpacity()));
  const head = document.createElement("div");
  head.className = "head";
  head.title = i18n("chatModeLabel") || "Stream chat";
  const pill = document.createElement("div");
  pill.className = "pill";
  const tint = document.createElement("input");
  tint.type = "range";
  tint.className = "tint";
  tint.min = "0";
  tint.max = "100";
  tint.step = "5";
  tint.value = String(Math.round(effOpacity() * 100));
  const tintLabel = i18n("optChatOpacityLabel") || "Background opacity";
  tint.title = tintLabel;
  tint.setAttribute("aria-label", tintLabel);
  head.append(pill, tint);
  const frame = document.createElement("iframe");
  frame.src = url + OVERLAY_SKIN_HASH;
  // Both ends pinned to dark (the skin pins the frame document): a color-scheme
  // mismatch makes Chrome paint an opaque canvas behind the frame, killing the
  // transparency.
  frame.style.colorScheme = "dark";
  const grip = document.createElement("div");
  grip.className = "grip";
  panel.append(head, frame, grip);
  shadow.append(style, panel);
  overlay.appendChild(host);
  animateIn(host, { opacity: 0, transform: "scale(.96) translateY(10px)" });

  const pop = popoverElevation(host);
  // The video box from the viewer's last layout pass; the anchored position is
  // recomputed from it whenever the box or the prefs change.
  let lastBox: PanelBox | null = null;

  const clampPos = (): void => {
    const r = host.getBoundingClientRect();
    const left = Math.min(Math.max(r.left, EDGE_MARGIN - r.width + 48), window.innerWidth - 48);
    const top = Math.min(Math.max(r.top, 0), window.innerHeight - 32);
    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
  };

  const place = (): void => {
    if (!lastBox) return;
    const pos = positionFromAnchor(
      effAnchor(),
      { width: host.offsetWidth, height: host.offsetHeight },
      lastBox,
    );
    host.style.left = `${pos.left}px`;
    host.style.top = `${pos.top}px`;
    clampPos();
  };

  // Remember where the panel ended up, relative to the video box's nearest
  // edges, together with its size — one write per gesture.
  const persistSpot = (): void => {
    if (!lastBox) return;
    const r = host.getBoundingClientRect();
    const a = anchorFromRect(
      { left: r.left, top: r.top, width: r.width, height: r.height },
      lastBox,
    );
    cb.persist({
      width: Math.round(r.width),
      height: Math.round(r.height),
      h: a.h,
      v: a.v,
      dx: a.dx,
      dy: a.dy,
    });
  };

  // Tint slider: live restyle while sliding; the per-site write is debounced
  // behind the last movement (plus the native change event) so a drag costs a
  // couple of storage writes, not one per pixel. The slider lives in the drag
  // head — keep its pointer stream to itself.
  tint.addEventListener("pointerdown", (e) => e.stopPropagation());
  let tintSave: ReturnType<typeof setTimeout> | null = null;
  const saveTint = (): void => {
    if (tintSave != null) clearTimeout(tintSave);
    tintSave = null;
    cb.persist({ opacity: Number(tint.value) / 100 });
  };
  tint.addEventListener("input", () => {
    panel.style.setProperty("--vtp-chat-tint", String(Number(tint.value) / 100));
    if (tintSave != null) clearTimeout(tintSave);
    tintSave = setTimeout(saveTint, 400);
  });
  tint.addEventListener("change", saveTint);

  // Grab-head drag. Pointer capture keeps the move alive outside the panel.
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
      persistSpot();
    };
    head.setPointerCapture(e.pointerId);
    head.addEventListener("pointermove", move);
    head.addEventListener("pointerup", up, { once: true });
    head.addEventListener("pointercancel", up, { once: true });
  });

  // Corner resize; the final size and the re-derived anchor persist per site.
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
      persistSpot();
    };
    grip.setPointerCapture(e.pointerId);
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up, { once: true });
    grip.addEventListener("pointercancel", up, { once: true });
  });

  return {
    host,
    layout(box: PanelBox): void {
      lastBox = box;
      place();
    },
    applySettings(): void {
      panel.style.setProperty("--vtp-chat-tint", String(effOpacity()));
      tint.value = String(Math.round(effOpacity() * 100));
      host.style.width = `${effWidth()}px`;
      host.style.height = `${effHeight()}px`;
      if (lastBox) place();
      else clampPos();
    },
    elevate: pop.elevate,
    reelevate: pop.reelevate,
    raise: pop.raise,
    glide: (ms: number) => glide(host, ms),
    destroy(): void {
      if (tintSave != null) clearTimeout(tintSave);
      // Drop the marker first so a replacement panel can mount while this one
      // is still fading out; the popover stays shown until the fade ends.
      host.removeAttribute("data-vtp-viewer-chat-panel");
      animateOutAndRemove(host, { transform: "scale(.96) translateY(8px)" }, () => pop.dispose());
    },
  };
}
