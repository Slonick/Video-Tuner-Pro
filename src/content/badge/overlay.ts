import { MIN_FORWARD_BUFFER } from "../core/constants.js";
import { S } from "../state.js";
import { getDomain } from "../core/domain.js";
import { badgeFraction } from "../core/badge-pos.js";
import { mutateStoredMap } from "../../shared/map-mutation.js";
import { ctxValid } from "../platform/browser.js";
import { i18n } from "../platform/i18n.js";
import { fullscreenOverlayHost } from "../platform/fullscreen.js";
import { primaryVideo } from "../videos.js";
import { VIEWER_LAYOUT_EVENT, viewerAnchorVideo } from "../viewer.js";
import { onStreamPage } from "../live/detection.js";
import { catchupBufferLimited } from "../live/catchup.js";
import { forwardBuffer, streamLatency } from "../live/metrics.js";
import { BADGE_HOST_ID, mountBadge } from "./BadgeView.js";
import { listenerOptions } from "../lifecycle.js";
import { subscribePointerMove } from "../pointer.js";

type Timer = ReturnType<typeof setTimeout>;

export function fmtTime(s: number): string {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// Parse a "H:MM:SS" / "MM:SS" clock (SponsorBlock's text is like "(1:54:13)").
export function parseClock(t: string | null): number {
  const m = String(t).match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  return m[3] != null ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
}

// Effective content duration. SponsorBlock (when "show duration after skips" is
// on) injects #sponsorBlockDurationAfterSkips with the real length; use it when
// present, else fall back to the full length.
function effectiveDuration(video: HTMLVideoElement): number {
  try {
    const el = document.getElementById("sponsorBlockDurationAfterSkips");
    if (el) {
      const s = parseClock(el.textContent);
      if (s > 0) return s;
    }
  } catch (e) {
    /* ignore */
  }
  return video.duration;
}

let badgeHost: HTMLDivElement | null = null; // shadow host (light DOM) we re-parent + mark
let timeBadgeEl: HTMLDivElement | null = null;
let badgeDotEl: HTMLElement | null = null; // video/stream indicator dot (left of the speed)
let badgeTextEl: HTMLSpanElement | null = null; // holds the speed/time text (so the pin stays put)
let badgePinEl: HTMLSpanElement | null = null;
let badgeNoticeEl: HTMLSpanElement | null = null;
let timeBadgeHideTimer: Timer | undefined;
let badgeNoticeTimer: Timer | undefined;
let badgeVideo: HTMLElement | null = null; // cached video frame/anchor so mousemove stays cheap
let badgeMedia: HTMLVideoElement | null = null;
let badgeMoveHooked = false;
let badgeUpdateFrame: number | null = null;
let dragging = false;
let dragDX = 0,
  dragDY = 0;
const NATIVE_VIEWER_SURFACE_ATTR = "data-vtp-viewer-player";
const BADGE_POPOVER_ATTR = "data-vtp-badge-popover";

type PopoverHost = HTMLDivElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
};

function syncBadgePopover(active: boolean): void {
  const host = badgeHost as PopoverHost | null;
  if (!host || typeof host.showPopover !== "function" || typeof host.hidePopover !== "function")
    return;
  let open = false;
  try {
    open = host.matches(":popover-open");
  } catch {}
  if (active) {
    host.setAttribute("popover", "manual");
    host.setAttribute(BADGE_POPOVER_ATTR, "");
    if (!open) {
      try {
        host.showPopover();
      } catch {}
    }
  } else if (host.hasAttribute(BADGE_POPOVER_ATTR)) {
    if (open) {
      try {
        host.hidePopover();
      } catch {}
    }
    host.removeAttribute(BADGE_POPOVER_ATTR);
    host.removeAttribute("popover");
  }
}

// True if a node is our badge — the observer ignores our writes so they don't
// re-trigger applyAll. The badge itself lives in a shadow root (its mutations are
// invisible to the light-DOM observer anyway); this covers the host node we add.
export function ownsBadgeNode(node: Node | null): boolean {
  if (!node) return false;
  if (timeBadgeEl && timeBadgeEl.contains(node)) return true;
  return !!(badgeHost && (badgeHost === node || badgeHost.contains(node)));
}

function removeCurrentStaleBadgeHost(): void {
  const stale = document.getElementById(BADGE_HOST_ID);
  if (stale && stale !== badgeHost) stale.remove();
}

function removeStaleBadgeHosts(): void {
  removeCurrentStaleBadgeHost();
  let legacy = document.querySelector("[data-vtp-badge]:not(#" + BADGE_HOST_ID + ")");
  while (legacy && legacy !== badgeHost) {
    legacy.remove();
    legacy = document.querySelector("[data-vtp-badge]:not(#" + BADGE_HOST_ID + ")");
  }
}

// Place the badge at its saved per-site fraction of the video, or the default
// top-left corner when it's never been moved.
function positionBadge(el: HTMLElement, v: HTMLElement, rect?: DOMRect): void {
  const r = rect ?? v.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  const maxLeft = r.left + Math.max(0, r.width - b.width);
  const maxTop = r.top + Math.max(0, r.height - b.height);
  const place = (left: number, top: number) => {
    el.style.left = Math.round(Math.min(Math.max(left, r.left), maxLeft)) + "px";
    el.style.top = Math.round(Math.min(Math.max(top, r.top), maxTop)) + "px";
  };
  if (S.badgePos) {
    place(r.left + S.badgePos.fx * r.width, r.top + S.badgePos.fy * r.height);
  } else {
    place(r.left + Math.max(10, r.width * 0.012), r.top + Math.max(10, r.height * 0.04));
  }
}

function saveBadgePos(fx: number, fy: number): void {
  if (!ctxValid()) return;
  mutateStoredMap("badgePos", { [getDomain()]: { fx, fy } }, []);
}

// Double-click clears the saved position → back to the default corner.
function resetBadgePos(): void {
  if (!ctxValid()) return;
  mutateStoredMap("badgePos", {}, [getDomain()]);
}

function saveBadgePinned(on: boolean): void {
  if (!ctxValid()) return;
  mutateStoredMap("badgePinned", on ? { [getDomain()]: true } : {}, on ? [] : [getDomain()]);
}

// Reflect the pinned state on the pin: upright + bright when pinned, tilted +
// dimmed when loose.
function setPinVisual(on: boolean): void {
  if (!badgePinEl) return;
  badgePinEl.setAttribute("aria-pressed", on ? "true" : "false");
  badgePinEl.style.opacity = on ? "1" : "0.5";
  badgePinEl.style.transform = on ? "none" : "rotate(40deg)";
}

function setNoticeVisual(on: boolean): void {
  if (!badgeNoticeEl) return;
  badgeNoticeEl.style.opacity = on ? "1" : "0";
  badgeNoticeEl.style.transform = on
    ? "translate(0, -50%) scale(1)"
    : "translate(-18px, -50%) scale(.36)";
}

// Pin/unpin for this site: pinned → the badge stays visible (no auto-hide).
function togglePin(): void {
  const on = !S.badgePinned;
  S.badgePinned = on;
  setPinVisual(on);
  if (on) {
    clearTimeout(timeBadgeHideTimer);
    if (timeBadgeEl) {
      timeBadgeEl.style.opacity = "1";
      timeBadgeEl.style.pointerEvents = "auto";
    }
  } else {
    flashBadge(); // resume the auto-hide countdown
  }
  saveBadgePinned(on);
}

// The pin is a child of the draggable badge, so swallow the events that would
// otherwise start a drag / trigger the position-reset dblclick. Wired as native
// listeners (not React handlers) so they fire before the badge's own listeners.
function hookPin(pin: HTMLElement): void {
  pin.setAttribute("aria-label", i18n("badgePinAria") || "Keep speed badge visible");
  pin.setAttribute("aria-pressed", S.badgePinned ? "true" : "false");
  pin.title = i18n("badgePinAria") || "Keep speed badge visible";
  pin.addEventListener("pointerdown", (e) => e.stopPropagation());
  pin.addEventListener("dblclick", (e) => e.stopPropagation());
  pin.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    togglePin();
  });
  pin.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePin();
  });
}

// Drag the badge anywhere over the video; the drop point is stored as a fraction
// (clamped inside the frame) for this site.
function hookBadgeDrag(el: HTMLElement): void {
  let moved = false;
  let pointerId: number | null = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    moved = false;
    pointerId = e.pointerId;
    try {
      el.setPointerCapture(e.pointerId);
    } catch (x) {
      /* ignore */
    }
    el.style.cursor = "grabbing";
    const r = el.getBoundingClientRect();
    dragDX = e.clientX - r.left;
    dragDY = e.clientY - r.top;
    e.preventDefault();
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    moved = true;
    el.style.left = Math.round(e.clientX - dragDX) + "px";
    el.style.top = Math.round(e.clientY - dragDY) + "px";
    flashBadge(); // stay lit while dragging
  });
  const drop = (save = true) => {
    if (!dragging) return;
    dragging = false;
    pointerId = null;
    el.style.cursor = "grab";
    // A click without a drag (e.g. the two clicks of a double-click) must not
    // re-save — its write would otherwise race the reset below and win.
    if (!save || !moved || !badgeVideo) return;
    const pos = badgeFraction(el.getBoundingClientRect(), badgeVideo.getBoundingClientRect());
    S.badgePos = pos;
    positionBadge(el, badgeVideo); // snap to the clamped spot
    saveBadgePos(pos.fx, pos.fy);
  };
  el.addEventListener("pointerup", () => drop());
  el.addEventListener("pointercancel", () => drop(false));
  document.addEventListener(
    "pointerup",
    (e) => {
      if (pointerId == null || e.pointerId !== pointerId) return;
      drop();
    },
    listenerOptions(true),
  );
  document.addEventListener(
    "pointercancel",
    (e) => {
      if (pointerId == null || e.pointerId !== pointerId) return;
      drop(false);
    },
    listenerOptions(true),
  );
  window.addEventListener("blur", () => drop(false), listenerOptions(true));
  el.addEventListener("dblclick", (e) => {
    e.preventDefault();
    dragging = false;
    pointerId = null;
    S.badgePos = null;
    if (badgeVideo) positionBadge(el, badgeVideo);
    resetBadgePos();
  });
}

function renderBadge(v: HTMLVideoElement, anchor: HTMLElement, anchorRect?: DOMRect): void {
  const el = timeBadgeEl;
  const txt = badgeTextEl;
  if (!el || !txt) return;
  if (!dragging) positionBadge(el, anchor, anchorRect);
  const speed = v.playbackRate || S.currentSpeed || 1;
  const sp = Math.round(speed * 100) / 100;
  const stream = onStreamPage();
  // Red dot marks a live stream (matches the toolbar's red icon); a regular video
  // shows no dot at all.
  if (badgeDotEl) badgeDotEl.style.display = stream ? "inline-block" : "none";
  if (stream) {
    // Live: remaining time is meaningless (no end). Show a single value — the
    // latency to the broadcaster where the site exposes it (Twitch/YouTube),
    // otherwise the seconds buffered ahead, which is the same lag-behind-live.
    const lat = streamLatency();
    const buf = forwardBuffer(v);
    // "⚠" when we're far behind but the buffer is too thin to catch up at all.
    const target = Math.max(S.liveSyncTarget, MIN_FORWARD_BUFFER);
    const warn =
      S.liveSyncEnabled && catchupBufferLimited(lat, buf, target, S.liveSyncBufferReserve)
        ? " ⚠"
        : "";
    txt.textContent = `${sp}× · ${(lat != null ? lat : buf).toFixed(2)}s` + warn;
  } else {
    const dur = v.duration;
    const eff = effectiveDuration(v);
    const frac = dur > 0 ? Math.min(1, v.currentTime / dur) : 0;
    const remain = Math.max(0, eff * (1 - frac)) / speed;
    txt.textContent = `${sp}× · ${fmtTime(remain)}`;
  }
}

export function flashBadge(): void {
  if (!timeBadgeEl || timeBadgeEl.style.display === "none") return;
  timeBadgeEl.style.opacity = "1";
  timeBadgeEl.style.pointerEvents = "auto"; // grabbable while shown
  clearTimeout(timeBadgeHideTimer);
  // Pinned, or holding the temporary-speed key → stay visible (the held speed is
  // shown live in the badge); the keyup's setSpeed re-flashes to resume auto-hide.
  if (S.badgePinned || S.holdActive) return;
  timeBadgeHideTimer = setTimeout(() => {
    if (!timeBadgeEl || dragging) return; // never fade out mid-drag
    timeBadgeEl.style.opacity = "0";
    timeBadgeEl.style.pointerEvents = "none"; // hidden → don't block clicks on the video
  }, 2600);
}

export function showBadgeNotice(
  text: string,
  snapshot: { video?: HTMLVideoElement | null; stream?: boolean; anchor?: HTMLElement | null } = {},
): void {
  if (!timeBadgeEl || !badgeNoticeEl || timeBadgeEl.style.display === "none")
    updateTimeBadge(snapshot);
  if (!timeBadgeEl || !badgeNoticeEl || timeBadgeEl.style.display === "none") return;
  clearTimeout(badgeNoticeTimer);
  badgeNoticeEl.textContent = text;
  badgeNoticeEl.style.animation = "vtp-badge-notice-in .36s cubic-bezier(.16,1,.3,1)";
  setNoticeVisual(true);
  flashBadge();
  badgeNoticeTimer = setTimeout(() => {
    setNoticeVisual(false);
    if (badgeNoticeEl) badgeNoticeEl.style.animation = "none";
  }, 1450);
}

function hookBadgeMouse(): void {
  if (badgeMoveHooked) return;
  badgeMoveHooked = true;
  subscribePointerMove(({ x, y }) => {
    const enabled = onStreamPage() ? S.streamBadge : S.showRemaining;
    const bv = badgeVideo;
    if (!enabled || !timeBadgeEl || !bv) return;
    const r = bv.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
    if (badgeMedia) renderBadge(badgeMedia, bv, r);
    flashBadge();
  });
}

function scheduleTimeBadgeUpdate(): void {
  if (badgeUpdateFrame != null) return;
  badgeUpdateFrame = requestAnimationFrame(() => {
    badgeUpdateFrame = null;
    updateTimeBadge();
  });
}

// Keep the badge's content/position fresh (called every tick). Visibility is
// driven by mouse movement (flashBadge), so it only appears when you move over the
// Re-apply the glass-opacity multiplier (General setting) to the badge glass.
export function applyBadgeGlass(): void {
  badgeHost?.style.setProperty("--glass-opacity", String(S.glassOpacity));
}

// video and auto-hides after a moment.
export function updateTimeBadge(
  snapshot: { video?: HTMLVideoElement | null; stream?: boolean; anchor?: HTMLElement | null } = {},
): void {
  removeCurrentStaleBadgeHost();
  if (!S.streamBadge && !S.showRemaining) {
    syncBadgePopover(false);
    if (timeBadgeEl) timeBadgeEl.style.display = "none";
    badgeVideo = null;
    badgeMedia = null;
    return;
  }
  const v = snapshot.video !== undefined ? snapshot.video : primaryVideo();
  const anchor = snapshot.anchor !== undefined ? snapshot.anchor : (viewerAnchorVideo() ?? v);
  const stream = snapshot.stream !== undefined ? snapshot.stream : onStreamPage();
  // Two independent toggles: streamBadge for live, showRemaining for VODs. VODs
  // also need a real finite duration (to compute remaining); streams don't —
  // they show latency/buffer seconds, so skip the duration check there.
  const enabled = stream ? S.streamBadge : S.showRemaining;
  if (!enabled || !v || !anchor || (!stream && (!isFinite(v.duration) || v.duration <= 0))) {
    syncBadgePopover(false);
    if (timeBadgeEl) timeBadgeEl.style.display = "none";
    badgeVideo = null;
    badgeMedia = null;
    return;
  }
  badgeVideo = anchor;
  badgeMedia = v;
  hookBadgeMouse();
  let el = timeBadgeEl;
  let created = false;
  if (!el) {
    removeStaleBadgeHosts();
    const refs = mountBadge(); // React renders the badge into a shadow root
    badgeHost = refs.host;
    badgeHost.style.setProperty("--glass-opacity", String(S.glassOpacity)); // scales the glass
    el = refs.el;
    badgeDotEl = refs.dotEl;
    badgeTextEl = refs.textEl;
    badgePinEl = refs.pinEl;
    badgeNoticeEl = refs.noticeEl;
    timeBadgeEl = el;
    created = true;
    setPinVisual(S.badgePinned);
    hookBadgeDrag(el);
    hookPin(badgePinEl);
  }
  // Position is fixed (viewport-relative), but in fullscreen only descendants of
  // the fullscreen element paint. A bare <video> cannot render child overlays, so
  // keep the host on the page unless fullscreen targets a wrapper/container.
  const host = fullscreenOverlayHost();
  if (badgeHost && badgeHost.parentNode !== host) host.appendChild(badgeHost);
  syncBadgePopover(
    anchor instanceof HTMLElement && anchor.hasAttribute(NATIVE_VIEWER_SURFACE_ATTR),
  );
  el.style.display = "flex";
  if (created || S.badgePinned || el.style.opacity !== "0") renderBadge(v, anchor);
  // Pinned: keep it shown regardless of mouse movement, and reflect the state on
  // the pin (covers cross-tab changes pushed in via onChanged → updateTimeBadge).
  setPinVisual(S.badgePinned);
  if (S.badgePinned) {
    el.style.opacity = "1";
    el.style.pointerEvents = "auto";
  }
}

document.addEventListener(VIEWER_LAYOUT_EVENT, scheduleTimeBadgeUpdate, listenerOptions());
window.addEventListener("resize", scheduleTimeBadgeUpdate, listenerOptions({ passive: true }));
window.addEventListener("scroll", scheduleTimeBadgeUpdate, listenerOptions({ passive: true }));
