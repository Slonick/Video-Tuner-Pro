import { MIN_FORWARD_BUFFER } from "../core/constants.js";
import { S } from "../state.js";
import { getDomain } from "../core/domain.js";
import { badgeFraction } from "../core/badge-pos.js";
import { STORE } from "../platform/storage.js";
import { ctxValid } from "../platform/browser.js";
import { primaryVideo } from "../videos.js";
import { onStreamPage } from "../live/detection.js";
import { catchupBufferLimited } from "../live/catchup.js";
import { forwardBuffer, streamLatency } from "../live/metrics.js";

type Timer = ReturnType<typeof setTimeout>;

export function fmtTime(s: number): string {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// Parse a "H:MM:SS" / "MM:SS" clock (SponsorBlock's text is like "(1:54:13)").
export function parseClock(t: string | null): number {
  const m = String(t).match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  return m[3] != null ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
}

// Effective content duration. SponsorBlock (when "show duration after skips" is
// on) injects #sponsorBlockDurationAfterSkips with the real length; use it when
// present, else fall back to the full length.
function effectiveDuration(video: HTMLVideoElement): number {
  try {
    const el = document.getElementById("sponsorBlockDurationAfterSkips");
    if (el) { const s = parseClock(el.textContent); if (s > 0) return s; }
  } catch (e) { /* ignore */ }
  return video.duration;
}

let timeBadgeEl: HTMLDivElement | null = null;
let badgeTextEl: HTMLSpanElement | null = null;   // holds the speed/time text (so the pin stays put)
let badgePinEl: HTMLSpanElement | null = null;
let timeBadgeHideTimer: Timer | undefined;
let badgeVideo: HTMLVideoElement | null = null;   // cached primary video so mousemove stays cheap
let badgeMoveHooked = false;
let dragging = false;
let dragDX = 0, dragDY = 0;

// True if a node is inside our own badge — the observer ignores our writes (and
// the rapid position updates during a drag) so they don't re-trigger applyAll.
export function ownsBadgeNode(node: Node | null): boolean {
  return !!(timeBadgeEl && node && timeBadgeEl.contains(node));
}

// Place the badge at its saved per-site fraction of the video, or the default
// top-left corner when it's never been moved.
function positionBadge(el: HTMLElement, v: HTMLVideoElement): void {
  const r = v.getBoundingClientRect();
  if (S.badgePos) {
    el.style.left = Math.round(r.left + S.badgePos.fx * r.width) + "px";
    el.style.top = Math.round(r.top + S.badgePos.fy * r.height) + "px";
  } else {
    el.style.left = Math.round(r.left + Math.max(10, r.width * 0.012)) + "px";
    el.style.top = Math.round(r.top + Math.max(10, r.height * 0.04)) + "px";
  }
}

function saveBadgePos(fx: number, fy: number): void {
  if (!ctxValid()) return;
  STORE.get(["badgePos"], (r) => {
    const map = (r.badgePos || {}) as Record<string, { fx: number; fy: number }>;
    map[getDomain()] = { fx, fy };
    STORE.set({ badgePos: map });
  });
}

// Double-click clears the saved position → back to the default corner.
function resetBadgePos(): void {
  if (!ctxValid()) return;
  STORE.get(["badgePos"], (r) => {
    const map = (r.badgePos || {}) as Record<string, { fx: number; fy: number }>;
    delete map[getDomain()];
    STORE.set({ badgePos: map });
  });
}

function saveBadgePinned(on: boolean): void {
  if (!ctxValid()) return;
  STORE.get(["badgePinned"], (r) => {
    const map = (r.badgePinned || {}) as Record<string, boolean>;
    if (on) map[getDomain()] = true; else delete map[getDomain()];
    STORE.set({ badgePinned: map });
  });
}

// Reflect the pinned state on the pin: upright + bright when pinned, tilted +
// dimmed when loose.
function setPinVisual(on: boolean): void {
  if (!badgePinEl) return;
  badgePinEl.style.opacity = on ? "1" : "0.5";
  badgePinEl.style.transform = on ? "none" : "rotate(40deg)";
}

// Pin/unpin for this site: pinned → the badge stays visible (no auto-hide).
function togglePin(): void {
  const on = !S.badgePinned;
  S.badgePinned = on;
  setPinVisual(on);
  if (on) {
    clearTimeout(timeBadgeHideTimer);
    if (timeBadgeEl) { timeBadgeEl.style.opacity = "1"; timeBadgeEl.style.pointerEvents = "auto"; }
  } else {
    flashBadge(); // resume the auto-hide countdown
  }
  saveBadgePinned(on);
}

// The pin is a child of the draggable badge, so swallow the events that would
// otherwise start a drag / trigger the position-reset dblclick.
function buildPin(): HTMLSpanElement {
  const pin = document.createElement("span");
  pin.setAttribute("role", "button");
  pin.style.cssText = [
    "display:inline-flex", "align-items:center", "justify-content:center",
    "width:15px", "height:15px", "margin:-2px -3px -2px 3px", "cursor:pointer",
    "color:#fff", "transition:opacity .15s,transform .15s"
  ].join(";");
  pin.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">'
    + '<path d="M16 9V4h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/>'
    + "</svg>";
  pin.addEventListener("pointerdown", (e) => e.stopPropagation());
  pin.addEventListener("dblclick", (e) => e.stopPropagation());
  pin.addEventListener("click", (e) => { e.stopPropagation(); togglePin(); });
  return pin;
}

// Drag the badge anywhere over the video; the drop point is stored as a fraction
// (clamped inside the frame) for this site.
function hookBadgeDrag(el: HTMLElement): void {
  let moved = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    moved = false;
    try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
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
  const drop = () => {
    if (!dragging) return;
    dragging = false;
    el.style.cursor = "grab";
    // A click without a drag (e.g. the two clicks of a double-click) must not
    // re-save — its write would otherwise race the reset below and win.
    if (!moved || !badgeVideo) return;
    const pos = badgeFraction(el.getBoundingClientRect(), badgeVideo.getBoundingClientRect());
    S.badgePos = pos;
    positionBadge(el, badgeVideo); // snap to the clamped spot
    saveBadgePos(pos.fx, pos.fy);
  };
  el.addEventListener("pointerup", drop);
  el.addEventListener("pointercancel", drop);
  el.addEventListener("dblclick", (e) => {
    e.preventDefault();
    dragging = false;
    S.badgePos = null;
    if (badgeVideo) positionBadge(el, badgeVideo);
    resetBadgePos();
  });
}

function renderBadge(v: HTMLVideoElement): void {
  const el = timeBadgeEl;
  const txt = badgeTextEl;
  if (!el || !txt) return;
  if (!dragging) positionBadge(el, v);
  const speed = v.playbackRate || S.currentSpeed || 1;
  const sp = Math.round(speed * 100) / 100;
  if (onStreamPage()) {
    // Live: remaining time is meaningless (no end). Show a single value — the
    // latency to the broadcaster where the site exposes it (Twitch/YouTube),
    // otherwise the seconds buffered ahead, which is the same lag-behind-live.
    const lat = streamLatency();
    const buf = forwardBuffer(v);
    // "⚠" when we're far behind but the buffer is too thin to catch up at all.
    const target = Math.max(S.liveSyncTarget, MIN_FORWARD_BUFFER);
    const warn = S.liveSyncEnabled && catchupBufferLimited(lat, buf, target) ? " ⚠" : "";
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
  if (S.badgePinned) return; // pinned → stays visible, never schedule a fade-out
  timeBadgeHideTimer = setTimeout(() => {
    if (!timeBadgeEl || dragging) return; // never fade out mid-drag
    timeBadgeEl.style.opacity = "0";
    timeBadgeEl.style.pointerEvents = "none"; // hidden → don't block clicks on the video
  }, 2600);
}

function hookBadgeMouse(): void {
  if (badgeMoveHooked) return;
  badgeMoveHooked = true;
  document.addEventListener("mousemove", (e) => {
    const enabled = onStreamPage() ? S.streamBadge : S.showRemaining;
    const bv = badgeVideo;
    if (!enabled || !timeBadgeEl || !bv) return;
    const r = bv.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    // Only reveal the badge here — content is re-rendered by the 1s tick
    // (updateTimeBadge). Rendering per mousemove made the continuous buffer
    // value flicker at pointer-event rate.
    flashBadge();
  }, { passive: true });
}

// Keep the badge's content/position fresh (called every tick). Visibility is
// driven by mouse movement (flashBadge), so it only appears when you move over the
// video and auto-hides after a moment.
export function updateTimeBadge(): void {
  const v = primaryVideo();
  const stream = onStreamPage();
  // Two independent toggles: streamBadge for live, showRemaining for VODs. VODs
  // also need a real finite duration (to compute remaining); streams don't —
  // they show latency/buffer seconds, so skip the duration check there.
  const enabled = stream ? S.streamBadge : S.showRemaining;
  if (!enabled || !v || (!stream && (!isFinite(v.duration) || v.duration <= 0))) {
    if (timeBadgeEl) timeBadgeEl.style.display = "none";
    badgeVideo = null;
    return;
  }
  badgeVideo = v;
  hookBadgeMouse();
  let el = timeBadgeEl;
  if (!el) {
    el = document.createElement("div");
    el.setAttribute("data-vtp-badge", "");   // marker so a re-injected instance can remove a leftover badge
    el.style.cssText = [
      "position:fixed", "z-index:2147483646", "pointer-events:none", "cursor:grab",
      "touch-action:none", "user-select:none",
      "display:flex", "align-items:center",
      "font:600 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif",
      "color:#fff", "background:rgba(0,0,0,0.55)", "padding:5px 9px",
      "border-radius:6px", "white-space:nowrap", "opacity:0", "transition:opacity .25s",
      "-webkit-backdrop-filter:blur(3px)", "backdrop-filter:blur(3px)"
    ].join(";");
    badgeTextEl = document.createElement("span");
    badgePinEl = buildPin();
    setPinVisual(S.badgePinned);
    el.append(badgeTextEl, badgePinEl);
    timeBadgeEl = el;
    hookBadgeDrag(el);
  }
  const fsEl = document.fullscreenElement;
  const host: Element = (fsEl && fsEl.tagName !== "VIDEO") ? fsEl : document.body;
  if (el.parentNode !== host) host.appendChild(el);
  el.style.display = "flex";
  renderBadge(v);
  // Pinned: keep it shown regardless of mouse movement, and reflect the state on
  // the pin (covers cross-tab changes pushed in via onChanged → updateTimeBadge).
  setPinVisual(S.badgePinned);
  if (S.badgePinned) { el.style.opacity = "1"; el.style.pointerEvents = "auto"; }
}
