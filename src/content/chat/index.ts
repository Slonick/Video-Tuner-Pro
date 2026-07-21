// Facade the viewer drives. It owns the chat sub-surfaces (side column / the
// floating overlay panel — both iframes of the platform's popout chat) for the
// current viewer session and keeps them matched to S.viewerChatMode. Never
// imports viewer.ts — the viewer calls down, and settings changes reach here
// through the viewer's apply exports.
import { S } from "../state.js";
import { STORE } from "../platform/storage.js";
import { getDomain } from "../core/domain.js";
import { onStreamPage } from "../live/detection.js";
import { chatPlatform } from "./platform.js";
import {
  mountSideChat,
  SIDE_CHAT_WIDTH,
  SIDE_CHAT_MIN,
  SIDE_CHAT_MAX,
  type SideChat,
  type SideChatBox,
} from "./side.js";
import { mountChatPanel, type ChatPanel, type ChatPanelPrefs } from "./panel.js";
import type { PanelBox } from "./anchor.js";
import { mountChatFab, type ChatFab } from "./fab.js";

export type ViewerChatMode = "off" | "side" | "overlay";
export type ViewerChatFormat = "normal" | "theater";

interface ChatContext {
  overlay: HTMLElement;
  nativeSurface: boolean;
  // The viewer's own live verdict at entry — onStreamPage() alone can flip
  // while the page sits behind the overlay.
  liveHint: boolean;
  // The viewer's current format — the side width is remembered per format.
  format(): ViewerChatFormat;
  // Re-run the viewer's layout pass (sizeVideo) — the gutter changed. Used
  // continuously (drag-resize), so it must stay instant.
  relayout(): void;
  // Same, but animated: the video FLIPs to its new box and the chat surfaces
  // glide along. Used for discrete changes (mode switches).
  relayoutSmooth(): void;
}

let ctx: ChatContext | null = null;
let side: SideChat | null = null;
let panel: ChatPanel | null = null;
let fab: ChatFab | null = null;
// Width override while the left-edge drag is in flight (not yet persisted).
let liveSideWidth: number | null = null;
// Coalesces the drag's relayout calls to one viewer layout pass per frame.
let resizeRaf = 0;

// Chat exists only on live pages of the supported platforms.
export function chatAvailable(liveHint = false): boolean {
  return chatPlatform() !== null && (liveHint || onStreamPage());
}

// Whether the configured mode is fully realized — the viewer's guard retries
// the mount while a session is open but live detection hasn't settled yet, or
// while the popout URL can't be built yet (e.g. YouTube's video id arrives
// after navigation).
export function chatSatisfied(): boolean {
  if (!ctx || !chatAvailable(ctx.liveHint)) return true;
  if (!fab) return false;
  const want = desiredMode();
  if (want === "side") return !!side;
  if (want === "overlay") return !!panel;
  return true;
}

function clampSideWidth(w: number): number {
  return Math.round(Math.min(SIDE_CHAT_MAX, Math.max(SIDE_CHAT_MIN, w)));
}

// The side column's width for a format: mid-drag value, then the per-site
// per-format remembered one, then the default.
function sideChatWidth(format: ViewerChatFormat): number {
  if (liveSideWidth != null) return liveSideWidth;
  const saved = S.viewerChatSideWidths[getDomain()]?.[format];
  return saved != null ? clampSideWidth(saved) : SIDE_CHAT_WIDTH;
}

// How much horizontal space the mounted side column actually occupies — the
// viewer subtracts this from the viewport in sizeVideo().
export function chatGutterWidth(format: ViewerChatFormat): number {
  return side ? sideChatWidth(format) : 0;
}

// The viewer's layout pass positions the mounted side column: "fill" docks it
// to the right edge (theater), a box attaches it beside the video card (normal).
export function layoutSideChat(box: SideChatBox): void {
  side?.layout(box);
}

// Pin the on-video chat button to the video box's top-right corner.
export function layoutChatFab(box: { right: number; top: number }): void {
  fab?.layout(box);
}

// Report the video box to the floating panel — it keeps its remembered spot
// relative to the box's nearest edges.
export function layoutChatPanel(box: PanelBox): void {
  panel?.layout(box);
}

function desiredMode(): ViewerChatMode {
  if (!ctx || !chatAvailable(ctx.liveHint)) return "off";
  return S.viewerChatMode;
}

function panelPrefs(): ChatPanelPrefs {
  return S.viewerChatPanelSites[getDomain()] ?? {};
}

function persistPanelPrefs(patch: ChatPanelPrefs): void {
  const domain = getDomain();
  const map = {
    ...S.viewerChatPanelSites,
    [domain]: { ...S.viewerChatPanelSites[domain], ...patch },
  };
  S.viewerChatPanelSites = map;
  STORE.set({ viewerChatPanelSites: map });
}

function persistSideWidth(width: number): void {
  const domain = getDomain();
  const format = ctx?.format() ?? "theater";
  const map = {
    ...S.viewerChatSideWidths,
    [domain]: { ...S.viewerChatSideWidths[domain], [format]: clampSideWidth(width) },
  };
  S.viewerChatSideWidths = map;
  STORE.set({ viewerChatSideWidths: map });
}

// Set the chat mode directly (the on-video button and its mode menu). Persists
// and applies in the same frame; the storage echo re-runs the same idempotent
// apply.
export function setChatMode(mode: ViewerChatMode): void {
  S.viewerChatMode = mode;
  STORE.set({ viewerChatMode: mode });
  updateViewerChat();
  ctx?.relayoutSmooth();
}

// Reconcile mounted surfaces with the configured mode. Idempotent — safe to
// call on mount, on a mode change, and on live-state flips.
export function updateViewerChat(): void {
  const want = desiredMode();
  if (want !== "side" && side) {
    side.destroy();
    side = null;
    liveSideWidth = null;
  }
  if (want !== "overlay" && panel) {
    panel.destroy();
    panel = null;
  }
  if (!ctx) return;
  if (want === "side" && !side) {
    side = mountSideChat(ctx.overlay, {
      onResize: (w) => {
        liveSideWidth = clampSideWidth(w);
        if (!resizeRaf) {
          resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0;
            ctx?.relayout();
          });
        }
      },
      onResizeEnd: (w) => {
        if (resizeRaf) {
          cancelAnimationFrame(resizeRaf);
          resizeRaf = 0;
        }
        liveSideWidth = null;
        persistSideWidth(w);
        ctx?.relayout();
      },
    });
  }
  if (want === "overlay" && !panel) {
    // null when the popout URL can't be built yet — chatSatisfied() stays false
    // and the viewer's guard retries, so overlay recovers like side mode.
    panel = mountChatPanel(ctx.overlay, { prefs: panelPrefs, persist: persistPanelPrefs });
    if (panel && ctx.nativeSurface) panel.elevate();
  }
  // The on-video toggle exists whenever chat COULD be shown, whatever the mode.
  if (chatAvailable(ctx.liveHint) && !fab) {
    fab = mountChatFab(ctx.overlay, setChatMode);
    if (ctx.nativeSurface) fab.elevate();
  }
  fab?.applyMode();
}

export function mountViewerChat(context: ChatContext): void {
  ctx = context;
  updateViewerChat();
}

export function unmountViewerChat(): void {
  ctx = null;
  liveSideWidth = null;
  fab?.destroy();
  fab = null;
  updateViewerChat();
}

// Live restyle of the mounted chat surfaces (tint/size sliders in options).
export function applyChatPanelSettings(): void {
  panel?.applySettings();
  side?.applySettings();
}

// Guard-tick hook for the native-surface path: the page can force-close top-layer
// popovers; put the panel back like the viewer does for the player itself.
export function reelevateChatPanel(): void {
  panel?.reelevate();
  fab?.reelevate();
}

// The player surface was hidden and re-shown (it landed back on top of the top
// layer) — re-append the chat popovers so they paint above it again.
export function raiseChatPopovers(): void {
  panel?.raise();
  fab?.raise();
}

// Open a transition window on every mounted chat surface so the layout writes
// of the next viewer animation glide along with the video instead of snapping.
export function animateChatLayout(ms: number): void {
  side?.glide(ms);
  panel?.glide(ms);
  fab?.glide(ms);
}

// Hotkey cycle: off → side → overlay → off.
export function cycleChatMode(): ViewerChatMode {
  const next: ViewerChatMode =
    S.viewerChatMode === "off" ? "side" : S.viewerChatMode === "side" ? "overlay" : "off";
  setChatMode(next);
  return next;
}
