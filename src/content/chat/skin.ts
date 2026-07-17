// Overlay skin for the popout-chat iframe. The overlay panel embeds the
// platform's popout chat with OVERLAY_SKIN_HASH in the URL; our content script
// runs inside that frame too (all_frames) and restyles the page: transparent
// backgrounds (the panel behind provides the tint), a text shadow for
// readability over video, no header chrome, and the message input shown only
// when the viewerChatInput setting is on. Settings arrive through this frame's
// own registry load — applyChatFrameSkin() re-applies on changes.
import { S } from "../state.js";
import { chatPlatform } from "./platform.js";
import { OVERLAY_SKIN_HASH } from "./panel.js";

const STYLE_ATTR = "data-vtp-chat-skin";
// Set on <html> while the pointer has been away from the chat for a while —
// hides the input zone (unless it holds focus) so the overlay is video-only.
const IDLE_ATTR = "data-vtp-chat-idle";
// Mirrors the viewer bar's auto-hide cadence.
const INPUT_IDLE_MS = 2600;

// Everything that must lose its opaque background, per platform. Broad on
// purpose: Twitch popouts also run third-party chat replacements (FFZ), so the
// rules cover the common wrappers rather than one exact DOM.
const TRANSPARENT: Record<string, string> = {
  twitch:
    "html,body,#root,.chat-shell,.chat-room,.chat-room__content,.stream-chat," +
    ".chat-list--default,.chat-list--other,.chat-scrollable-area__message-container," +
    ".channel-leaderboard,.chat-input," +
    ".chat-wysiwyg-input__box,.chat-input__textarea",
  // Kick (2026 DOM): Tailwind utility classes; bg-surface-* carries every
  // opaque plate. Popups (gift shop, pinned message) keep their own.
  // z-popover carries Kick's overlay panels (chat rules, chat settings) —
  // they keep their native plates.
  kick:
    "html,body,#chatroom-messages," +
    '[class*="bg-surface"]:not([data-testid="gift-shop-panel"])' +
    ':not([data-testid="gift-shop-panel"] *)' +
    ':not([data-testid="pinned-message-modal"])' +
    ':not([data-testid="pinned-message-modal"] *)' +
    ':not([class*="z-popover"]):not([class*="z-popover"] *)',
  youtube:
    "html,body,yt-live-chat-app,yt-live-chat-renderer,#contents,#chat,#item-list," +
    "yt-live-chat-item-list-renderer,#items",
};

// Header/decoration chrome that has no place in a floating overlay.
const HIDE: Record<string, string> = {
  twitch:
    '.stream-chat-header,.channel-leaderboard,[class*="channelLeaderboard"],' +
    // The leaderboard carousel strip above the messages has no stable class of
    // its own — match the wrapper by its paging controls. The input footer
    // hosts a "ChatBadgeCarousel" too, so it must be excluded explicitly.
    '.chat-room__content>div:not(.chat-input):has([aria-label*="leaderboard" i]),' +
    // The community-highlight stack (pinned messages, drops, hype train) hangs
    // its cards over the messages; collapsed it leaves an opaque backlog plate.
    ".community-highlight-stack__scroll-area--disable," +
    ".community-highlight-stack__card,.community-highlight-stack__backlog-card",
  kick: ".animate-leaderboards-marquee,div:has(>.animate-leaderboards-marquee)",
  youtube: "",
};

// YouTube's chat menus (message/poll three-dots, the view selector) live in a
// tp-yt-iron-dropdown INSIDE the header — display:none on the header would
// keep every menu from ever opening. Collapse it to zero height instead; the
// dropdown is absolutely positioned and still opens over the messages.
// iron-dropdown "fits" its popup against the anchor's box; with the header
// collapsed the measured space is zero and menus open 0px tall/60px wide.
// Author !important outranks the inline max-height/max-width the fit sets.
const YT_MENU_FIX =
  "tp-yt-iron-dropdown ytd-menu-popup-renderer:not(#vtp-a):not(#vtp-b)" +
  "{max-height:70vh!important;max-width:calc(100vw - 16px)!important;width:max-content!important;" +
  "background:#212121!important;border-radius:8px!important}" +
  // The fit also positions menus off the narrow frame's right edge — pin them
  // to it instead so items stay readable.
  "tp-yt-iron-dropdown:not(#vtp-a):not(#vtp-b){left:auto!important;right:8px!important}";

const YT_HEADER_COLLAPSE =
  "yt-live-chat-header-renderer:not(#vtp-a):not(#vtp-b)" +
  "{height:0!important;min-height:0!important;padding:0!important;border:0!important;" +
  // visibility (not display) hides the header's own row that overflow:visible
  // would otherwise paint over the top of the collapsed box; the dropdown gets
  // visibility back below, so the menus it hosts still open.
  "margin:0!important;overflow:visible!important;visibility:hidden!important}" +
  "yt-live-chat-header-renderer tp-yt-iron-dropdown:not(#vtp-a):not(#vtp-b)" +
  "{visibility:visible!important}";

// The message-input area, toggled by the viewerChatInput setting.
const INPUT: Record<string, string> = {
  twitch: ".chat-input",
  kick: '[class*="z-common"]:has([data-testid="chat-input"])',
  youtube: "#input-panel",
};

// Re-add a quiet plate for the send box itself after the input zone is
// flattened, so the field still reads as a field.
// Kick overlay panels (rules/settings) sit in z-popover wrappers whose own
// plate came from a bg-surface class — give the wrapper a solid one back.
const KICK_POPOVER_PLATE =
  '[class*="z-popover"]:not(#vtp-a):not(#vtp-b){background:#0f0f10!important}';

const INPUT_KEEP: Record<string, string> = {
  twitch:
    '.chat-input [class*="chat-wysiwyg-input-box"]:not(#vtp-a)' +
    "{background-color:rgba(255,255,255,0.16)!important}",
  kick: '[data-testid="chat-input"]:not(#vtp-a){background-color:rgba(255,255,255,0.14)!important}',
  youtube: "",
};

// Message text gets a shadow so white-on-video stays legible.
const TEXT: Record<string, string> = {
  twitch: ".chat-line__message",
  kick: "#chatroom-messages [data-index]",
  youtube: "yt-live-chat-text-message-renderer",
};

// Top-level containers whose background must go inline-!important: FFZ (and
// site themes) paint html/body/#root with important rules that outrank any
// stylesheet we inject, but never an inline important declaration.
const ROOTS: Record<string, string> = {
  twitch: "#root",
  kick: "#chatroom-messages",
  youtube: "yt-live-chat-app",
};

let styleEl: HTMLStyleElement | null = null;
let platform: ReturnType<typeof chatPlatform> = null;

function forceTransparentRoots(p: NonNullable<typeof platform>): void {
  const els: (HTMLElement | null)[] = [
    document.documentElement,
    document.body,
    ...Array.from(document.querySelectorAll<HTMLElement>(ROOTS[p])),
  ];
  for (const el of els) el?.style.setProperty("background", "transparent", "important");
}

// FFZ (and site themes) inject their own !important rules AFTER ours, and with
// equal specificity the later rule wins. Two :not(#…) hops add id-level
// specificity, so ours wins regardless of injection order.
function boost(list: string): string {
  return list
    .split(",")
    .map((s) => `${s.trim()}:not(#vtp-a):not(#vtp-b)`)
    .join(",");
}

// The input zone is a stack of styled-components plates with unstable class
// hashes — flatten every background under it except the buttons (send/emotes
// keep their own colors), then give the field back a quiet plate.
function inputZoneCss(p: NonNullable<typeof platform>): string {
  // Popups that open FROM the input zone (channel-points rewards, emote picker
  // — Twitch renders them in .tw-balloon / dialog wrappers inside it) must keep
  // their native plates, so the flatten skips them and their subtrees.
  const keepPopups =
    ':not([class*="balloon" i]):not([class*="balloon" i] *)' +
    ':not([role="dialog"]):not([role="dialog"] *)';
  const flat = INPUT[p]
    .split(",")
    .map((s) => `${s.trim()} :not(button):not(button *)${keepPopups}:not(#vtp-a)`)
    .join(",");
  return (
    `${flat}{background-color:transparent!important;background-image:none!important}` +
    INPUT_KEEP[p]
  );
}

// While idle, the whole input zone folds away — but never while it holds focus
// (mid-message) and only when the input is enabled at all. Animated via
// max-height (display can't transition); overflow stays visible in the shown
// state so popups opening FROM the zone (emote picker, rewards) aren't clipped.
function inputIdleCss(p: NonNullable<typeof platform>): string {
  const shown = boost(INPUT[p]);
  const idle = INPUT[p]
    .split(",")
    .map((s) => `:root[${IDLE_ATTR}] ${s.trim()}:not(:focus-within):not(#vtp-a):not(#vtp-b)`)
    .join(",");
  return (
    `${shown}{max-height:320px!important;` +
    `transition:max-height .3s ease,opacity .22s ease!important}` +
    `${idle}{max-height:0!important;opacity:0!important;overflow:hidden!important;` +
    `pointer-events:none!important}`
  );
}

function css(p: NonNullable<typeof platform>): string {
  return (
    // Must match the embedding iframe's color-scheme (panel.ts pins it to
    // dark): on a mismatch Chrome paints an opaque canvas behind the frame
    // and no amount of transparent backgrounds can show through it.
    `:root:not(#vtp-a):not(#vtp-b){color-scheme:dark!important}` +
    `${boost(TRANSPARENT[p])}{background:transparent!important;background-color:transparent!important}` +
    (HIDE[p] ? `${boost(HIDE[p])}{display:none!important}` : "") +
    (p === "youtube" ? YT_HEADER_COLLAPSE + YT_MENU_FIX : "") +
    (p === "kick" ? KICK_POPOVER_PLATE : "") +
    inputZoneCss(p) +
    `${TEXT[p]}{text-shadow:0 0 3px #000,0 1px 3px #000,0 0 10px rgba(0,0,0,0.7)}` +
    (S.viewerChatInput ? inputIdleCss(p) : `${boost(INPUT[p])}{display:none!important}`)
  );
}

// Show the input while the cursor is over the chat (the frame fills the panel,
// so "over the chat" is "over this document"); hide it a beat after it leaves.
function initInputIdle(): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hide = (): void => document.documentElement.setAttribute(IDLE_ATTR, "");
  const schedule = (): void => {
    if (timer != null) clearTimeout(timer);
    timer = setTimeout(hide, INPUT_IDLE_MS);
  };
  document.addEventListener(
    "pointerover",
    () => {
      if (timer != null) clearTimeout(timer);
      timer = null;
      document.documentElement.removeAttribute(IDLE_ATTR);
    },
    { passive: true },
  );
  document.addEventListener(
    "pointerout",
    (e: PointerEvent) => {
      if (!e.relatedTarget) schedule();
    },
    { passive: true },
  );
  schedule();
}

// Re-style a mounted skin after a settings change (called via the registry's
// applyViewerChatSettings hook, which runs in every frame).
export function applyChatFrameSkin(): void {
  if (!styleEl || !platform) return;
  styleEl.textContent = css(platform);
  forceTransparentRoots(platform);
}

// Called once at content-script boot in every frame; dormant unless this frame
// is a popout chat embedded by the overlay panel (marked by the URL hash).
export function initChatFrameSkin(): void {
  if (window.top === window) return;
  if (location.hash !== OVERLAY_SKIN_HASH) return;
  const p = chatPlatform();
  if (!p) return;
  // An extension reload leaves the previous script's style behind — its stale
  // rules would keep applying alongside ours.
  document.querySelectorAll(`style[${STYLE_ATTR}]`).forEach((n) => n.remove());
  platform = p;
  styleEl = document.createElement("style");
  styleEl.setAttribute(STYLE_ATTR, "");
  styleEl.textContent = css(p);
  // Chrome ignores a <style> hanging directly off <html> — it must land in
  // <head>, which may not exist yet at document_start. The inline root pass
  // needs <body> (and the app root), so it waits for DOMContentLoaded too.
  const attach = (): void => {
    if (!styleEl || !platform) return;
    (document.head ?? document.body ?? document.documentElement).appendChild(styleEl);
    forceTransparentRoots(platform);
  };
  if (document.head && document.body) attach();
  else document.addEventListener("DOMContentLoaded", attach, { once: true });
  initInputIdle();
}
