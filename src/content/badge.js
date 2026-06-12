// On-screen feedback: the toolbar icon badge, the transient speed pill, and the
// optional on-video "speed × remaining time" badge.
import { api, ctxValid } from "./env.js";
import { S } from "./state.js";
import { collectVideos, primaryVideo } from "./videos.js";
import { onStreamPage } from "./live.js";

// --- Toolbar icon ----------------------------------------------------------
// Tell the background what to draw on the toolbar icon for this tab. The frame
// that owns the video drives it; a frame that never had a video stays silent.
let lastBadge = null;
let badgeHadVideo = false;
let badgeUrl = location.href;

function speedLabel(s) {
  let str = String(Math.round(s * 100) / 100);
  if (!str.includes(".")) str += ".0";   // 1 -> "1.0", 2 -> "2.0", 1.5 -> "1.5"
  return str;
}

export function updateBadge() {
  // SPA navigation changes the URL without reloading the content script, so the
  // dedupe cache would suppress the re-send. Reset it on URL change.
  const urlChanged = location.href !== badgeUrl;
  if (urlChanged) { badgeUrl = location.href; lastBadge = null; }

  const hasVideo = collectVideos().length > 0;
  let payload;
  if (hasVideo) {
    payload = { action: "icon", text: speedLabel(S.currentSpeed), live: onStreamPage() };
  } else if (badgeHadVideo || urlChanged) {
    payload = { action: "icon", clear: true }; // had a video / navigated away
  } else {
    return;                                    // never had one — leave the icon alone
  }
  badgeHadVideo = hasVideo;
  const key = JSON.stringify(payload);
  if (key === lastBadge) return;
  lastBadge = key;
  if (!ctxValid()) return;
  try { api.runtime.sendMessage(payload); } catch (e) {}
}

// --- Transient on-screen feedback (minimal pill, overlaid on the video) -----
let indicatorEl = null;
let indicatorTimer = null;

export function showIndicator(text) {
  if (!document.body) return;
  if (!indicatorEl) {
    indicatorEl = document.createElement("div");
    indicatorEl.style.cssText = [
      "position:fixed", "z-index:2147483647", "pointer-events:none",
      "font:500 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif",
      "color:#fff", "background:rgba(0,0,0,0.55)", "padding:5px 9px",
      "border-radius:6px", "white-space:nowrap", "transition:opacity .2s", "opacity:0",
      "-webkit-backdrop-filter:blur(3px)", "backdrop-filter:blur(3px)"
    ].join(";");
  }

  // Overlay sits over the video via fixed coords. Host is normally <body>; in
  // fullscreen we move it under the fullscreen element so it renders over the
  // player. We avoid hosting inside the player container (a transform there would
  // break fixed positioning).
  const video = primaryVideo();
  const fsEl = document.fullscreenElement;
  const host = (fsEl && fsEl.tagName !== "VIDEO") ? fsEl : document.body;
  if (indicatorEl.parentNode !== host) host.appendChild(indicatorEl);

  if (video) {
    const r = video.getBoundingClientRect();
    indicatorEl.style.left = Math.round(r.left + r.width / 2) + "px";
    indicatorEl.style.top = Math.round(r.top + Math.max(10, r.height * 0.05)) + "px";
    indicatorEl.style.transform = "translateX(-50%)";
  } else {
    indicatorEl.style.left = "50%";
    indicatorEl.style.top = "14px";
    indicatorEl.style.transform = "translateX(-50%)";
  }

  indicatorEl.textContent = text || `${Math.round(S.currentSpeed * 100)}%`;
  indicatorEl.style.opacity = "1";
  clearTimeout(indicatorTimer);
  indicatorTimer = setTimeout(() => {
    if (indicatorEl) indicatorEl.style.opacity = "0";
  }, 1200);
}

// True if a node is inside our own indicator (so the observer ignores our writes).
export function ownsNode(node) {
  return !!(indicatorEl && indicatorEl.contains(node));
}

// --- On-video badge: speed + real remaining time (optional) ----------------
function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// Parse a "H:MM:SS" / "MM:SS" clock (SponsorBlock's text is like "(1:54:13)").
function parseClock(t) {
  const m = String(t).match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (!m) return 0;
  return m[3] != null ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
}

// Effective content duration. SponsorBlock (when "show duration after skips" is
// on) injects #sponsorBlockDurationAfterSkips with the real length; use it when
// present, else fall back to the full length.
function effectiveDuration(video) {
  try {
    const el = document.getElementById("sponsorBlockDurationAfterSkips");
    if (el) { const s = parseClock(el.textContent); if (s > 0) return s; }
  } catch (e) { /* ignore */ }
  return video.duration;
}

let timeBadgeEl = null;
let timeBadgeHideTimer = null;
let badgeVideo = null;          // cached primary video so mousemove stays cheap
let badgeMoveHooked = false;

function renderBadge(v) {
  const r = v.getBoundingClientRect();
  timeBadgeEl.style.left = Math.round(r.left + Math.max(10, r.width * 0.012)) + "px";
  timeBadgeEl.style.top = Math.round(r.top + Math.max(10, r.height * 0.04)) + "px";
  const speed = v.playbackRate || S.currentSpeed || 1;
  const dur = v.duration;
  const eff = effectiveDuration(v); // SponsorBlock real length, or full length
  const frac = dur > 0 ? Math.min(1, v.currentTime / dur) : 0;
  const remain = Math.max(0, eff * (1 - frac)) / speed;
  const sp = Math.round(speed * 100) / 100;
  timeBadgeEl.textContent = `${sp}× · ${fmtTime(remain)}`;
}

// Show the badge briefly, then fade it out — like player controls.
export function flashBadge() {
  if (!timeBadgeEl || timeBadgeEl.style.display === "none") return;
  timeBadgeEl.style.opacity = "1";
  clearTimeout(timeBadgeHideTimer);
  timeBadgeHideTimer = setTimeout(() => { if (timeBadgeEl) timeBadgeEl.style.opacity = "0"; }, 2600);
}

function hookBadgeMouse() {
  if (badgeMoveHooked) return;
  badgeMoveHooked = true;
  document.addEventListener("mousemove", (e) => {
    if (!S.showRemaining || !timeBadgeEl || !badgeVideo) return;
    const r = badgeVideo.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    renderBadge(badgeVideo);
    flashBadge();
  }, { passive: true });
}

// Keep the badge's content/position fresh (called every tick). Visibility is
// driven by mouse movement (flashBadge), so it only appears when you move over the
// video and auto-hides after a moment.
export function updateTimeBadge() {
  if (!S.showRemaining) { if (timeBadgeEl) timeBadgeEl.style.display = "none"; badgeVideo = null; return; }
  const v = primaryVideo();
  if (!v || !isFinite(v.duration) || v.duration <= 0 || onStreamPage()) {
    if (timeBadgeEl) timeBadgeEl.style.display = "none";
    badgeVideo = null;
    return;
  }
  badgeVideo = v;
  hookBadgeMouse();
  if (!timeBadgeEl) {
    timeBadgeEl = document.createElement("div");
    timeBadgeEl.style.cssText = [
      "position:fixed", "z-index:2147483646", "pointer-events:none",
      "font:600 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif",
      "color:#fff", "background:rgba(0,0,0,0.55)", "padding:5px 9px",
      "border-radius:6px", "white-space:nowrap", "opacity:0", "transition:opacity .25s",
      "-webkit-backdrop-filter:blur(3px)", "backdrop-filter:blur(3px)"
    ].join(";");
  }
  const fsEl = document.fullscreenElement;
  const host = (fsEl && fsEl.tagName !== "VIDEO") ? fsEl : document.body;
  if (timeBadgeEl.parentNode !== host) host.appendChild(timeBadgeEl);
  timeBadgeEl.style.display = "block";
  renderBadge(v);
}
