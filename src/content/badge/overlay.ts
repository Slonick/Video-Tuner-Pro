import { MIN_FORWARD_BUFFER, LIVE_MAX_FLOOR } from "../core/constants.js";
import { S } from "../state.js";
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
let timeBadgeHideTimer: Timer | undefined;
let badgeVideo: HTMLVideoElement | null = null;   // cached primary video so mousemove stays cheap
let badgeMoveHooked = false;

function renderBadge(v: HTMLVideoElement): void {
  const el = timeBadgeEl;
  if (!el) return;
  const r = v.getBoundingClientRect();
  el.style.left = Math.round(r.left + Math.max(10, r.width * 0.012)) + "px";
  el.style.top = Math.round(r.top + Math.max(10, r.height * 0.04)) + "px";
  const speed = v.playbackRate || S.currentSpeed || 1;
  const sp = Math.round(speed * 100) / 100;
  if (onStreamPage()) {
    // Live: remaining time is meaningless (no end). Prefer the latency to the
    // broadcaster where the site exposes it (Twitch/YouTube) — then the buffered
    // ahead seconds follow in parentheses: "speed × · latency (buffer)". Without
    // site latency the buffer IS the shown value, so no parenthetical.
    const lat = streamLatency();
    const buf = forwardBuffer(v);
    // "⚠" when we're far behind but the buffer is too thin to catch up safely.
    const target = Math.max(S.liveSyncTarget, MIN_FORWARD_BUFFER);
    const rate = Math.max(LIVE_MAX_FLOOR, S.liveSyncMax);
    const warn = S.liveSyncEnabled && catchupBufferLimited(lat != null ? lat : buf, buf, target, rate) ? " ⚠" : "";
    el.textContent = (lat != null
      ? `${sp}× · ${lat.toFixed(2)}s (${buf.toFixed(2)}s)`
      : `${sp}× · ${buf.toFixed(2)}s`) + warn;
  } else {
    const dur = v.duration;
    const eff = effectiveDuration(v);
    const frac = dur > 0 ? Math.min(1, v.currentTime / dur) : 0;
    const remain = Math.max(0, eff * (1 - frac)) / speed;
    el.textContent = `${sp}× · ${fmtTime(remain)}`;
  }
}

export function flashBadge(): void {
  if (!timeBadgeEl || timeBadgeEl.style.display === "none") return;
  timeBadgeEl.style.opacity = "1";
  clearTimeout(timeBadgeHideTimer);
  timeBadgeHideTimer = setTimeout(() => { if (timeBadgeEl) timeBadgeEl.style.opacity = "0"; }, 2600);
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
    el.style.cssText = [
      "position:fixed", "z-index:2147483646", "pointer-events:none",
      "font:600 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif",
      "color:#fff", "background:rgba(0,0,0,0.55)", "padding:5px 9px",
      "border-radius:6px", "white-space:nowrap", "opacity:0", "transition:opacity .25s",
      "-webkit-backdrop-filter:blur(3px)", "backdrop-filter:blur(3px)"
    ].join(";");
    timeBadgeEl = el;
  }
  const fsEl = document.fullscreenElement;
  const host: Element = (fsEl && fsEl.tagName !== "VIDEO") ? fsEl : document.body;
  if (el.parentNode !== host) host.appendChild(el);
  el.style.display = "block";
  renderBadge(v);
}
