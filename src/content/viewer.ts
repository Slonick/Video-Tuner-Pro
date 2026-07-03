// Pop-out video viewer. It prefers a non-invasive mirror: capture the page's
// <video> into our own overlay video, while the original player stays in its
// DOM. That avoids most framework/player fights during quality changes and SPA
// layer swaps. If captureStream() is unavailable, it falls back to adopting the
// bare <video> and restoring it on exit.
import { S } from "./state.js";
import { primaryVideo } from "./videos.js";
import {
  isYouTube,
  youTubeVideoId,
  readYouTubeChapters,
  fetchSponsorSegments,
  hasNativeSponsorBlock,
  SPONSOR_COLORS,
} from "./markers.js";
import { i18n } from "./platform/i18n.js";
import { ensureGlassFilter, GLASS_REFRACTION } from "../shared/glass.js";

export type ViewerFormat = "normal" | "theater";

const ATTR = "data-vtp-viewer"; // on <html>: "normal" | "theater" — state marker
const OVERLAY = "data-vtp-viewer-overlay";
const FRACTION = 0.86; // the normal box's share of the viewport
const BAR_HIDE_MS = 2600; // control-bar auto-hide, mirrors the launcher FAB
const CLOSE_EVENT = "vtp-viewer-close";

// The overlay sits under the speed badge (…646) and the launcher FAB with its
// radial menu (…647), so both remain usable over the popped-out video.
const Z_OVERLAY = "2147483643";

let fmt: ViewerFormat | null = null;
let video: HTMLVideoElement | null = null; // the page media element we control
let surfaceVideo: HTMLVideoElement | null = null; // the overlay video we render/style
let overlay: HTMLDivElement | null = null;
let holder: Comment | null = null; // marks the video's original DOM spot
let prevCss = ""; // the video's inline style before we took over
let prevControls = false;
let prevOverflow = ""; // <html>'s inline overflow (scroll lock restore)
let hooked = false;
let guardTimer: ReturnType<typeof setInterval> | null = null;

// Control bar (in a shadow root so page CSS can't touch it).
let bar: HTMLDivElement | null = null;
let playBtn: HTMLButtonElement | null = null;
let muteBtn: HTMLButtonElement | null = null;
let fmtBtn: HTMLButtonElement | null = null;
let seekEl: HTMLInputElement | null = null;
let seekWrapEl: HTMLSpanElement | null = null;
let volEl: HTMLInputElement | null = null;
let timeEl: HTMLSpanElement | null = null;
let barTimer: ReturnType<typeof setTimeout> | undefined;
let seeking = false; // mid-drag on the seek slider — don't fight the user
let media: AbortController | null = null; // per-session media/UI listeners
let marksEl: HTMLDivElement | null = null; // chapter ticks + sponsor bands layer
let marksLoaded = false; // duration arrived and the layer was populated
// Chapters are read from the site player's own progress bar BEFORE the video
// is adopted — YouTube tears its player UI down once the element leaves.
let pendingChapters: { start: number; title: string }[] = [];
// Sites (YouTube) keep rewriting their video's inline style, clobbering ours —
// a plain style write drops even !important declarations. Re-assert on sight.
let styleGuard: MutationObserver | null = null;
let desiredCss = "";
let normalBox: { w: number; h: number; vw: number; vh: number; fromMetadata: boolean } | null =
  null;
let mirrored = false;
let mirrorStream: MediaStream | null = null;

let fitMenu: HTMLDivElement | null = null;

// A previous instance (extension reload re-injects us) may have left its
// overlay up — drop it. (Its adopted video can't be returned — the old
// instance lost the spot; the site's player recreates one on demand.)
try {
  document.querySelectorAll(`[${OVERLAY}]`).forEach((n) => n.remove());
  document.documentElement.removeAttribute(ATTR);
} catch (e) {
  /* ignore */
}

document.addEventListener(CLOSE_EVENT, () => exitViewer());

export function viewerFormat(): ViewerFormat | null {
  return fmt;
}

// True if a node belongs to the viewer's own DOM — the media observer ignores
// our writes, mirroring ownsBadgeNode/ownsLauncherNode.
export function ownsViewerNode(node: Node | null): boolean {
  if (!node) return false;
  return !!(overlay && (overlay === node || overlay.contains(node)));
}

// mm:ss below an hour, h:mm:ss above.
export function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const t = Math.floor(s);
  const ss = String(t % 60).padStart(2, "0");
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

type Timeline =
  | { kind: "vod"; start: 0; pos: number; len: number }
  | { kind: "dvr"; start: number; pos: number; len: number }
  | { kind: "live" };

const MAX_REAL_DURATION = 60 * 60 * 24 * 30;

function mediaTimeline(v: HTMLVideoElement): Timeline {
  const dur = v.duration;
  if (Number.isFinite(dur) && dur > 0 && dur < MAX_REAL_DURATION) {
    return { kind: "vod", start: 0, pos: v.currentTime, len: dur };
  }
  const ranges = v.seekable;
  if (ranges && ranges.length > 0) {
    const start = ranges.start(ranges.length - 1);
    const end = ranges.end(ranges.length - 1);
    const len = end - start;
    if (Number.isFinite(start) && Number.isFinite(end) && len > 5 && len < MAX_REAL_DURATION) {
      const pos = Math.min(Math.max(v.currentTime, start), end) - start;
      return { kind: "dvr", start, pos, len };
    }
  }
  return { kind: "live" };
}

// Size the video for the current format. Theater fills the overlay; normal is
// a centred box at the video's aspect within FRACTION of the viewport —
// computed in px (and re-computed on resize/metadata) so the box tracks the
// real aspect once it's known.
// Everything the site's own stylesheets could leak onto the element (padding,
// rounded corners, borders, size clamps) is reset with !important — in theater
// the only bars left are the letterbox from the fit mode itself.
const VIDEO_RESET =
  "margin:0 !important;padding:0 !important;border:0 !important;" +
  "max-width:none !important;max-height:none !important;" +
  "min-width:0 !important;min-height:0 !important;background:#000 !important;";

// How the picture fills its box: letterboxed, cropped to the edges, or
// stretched (for squeezing 4:3 out to the borders). Picked from a bar menu,
// sticky for the tab's lifetime.
const FIT_MODES = ["contain", "cover", "fill"] as const;
type FitMode = (typeof FIT_MODES)[number];
let fitMode: FitMode = "contain";
const FIT_LABEL: Record<FitMode, [string, string]> = {
  contain: ["viewerFitContain", "Fit"],
  cover: ["viewerFitCover", "Crop"],
  fill: ["viewerFitFill", "Stretch"],
};
const fitLabel = (m: FitMode) => i18n(FIT_LABEL[m][0]) || FIT_LABEL[m][1];

function sizeVideo(): void {
  const surface = surfaceVideo ?? video;
  if (!fmt || !surface) return;
  const fit = `object-fit:${fitMode} !important;`;
  if (fmt === "theater") {
    normalBox = null;
    surface.style.cssText =
      "position:absolute !important;inset:0 !important;" +
      "width:100% !important;height:100% !important;" +
      "transform:none !important;border-radius:0 !important;box-shadow:none !important;" +
      fit +
      VIDEO_RESET;
  } else {
    const mediaWidth = surface.videoWidth || video?.videoWidth || 0;
    const mediaHeight = surface.videoHeight || video?.videoHeight || 0;
    const hasMetadata = !!(mediaWidth && mediaHeight);
    const ar = hasMetadata ? mediaWidth / mediaHeight : 16 / 9;
    const viewportChanged =
      !normalBox || normalBox.vw !== window.innerWidth || normalBox.vh !== window.innerHeight;
    const metadataArrived = !!normalBox && !normalBox.fromMetadata && hasMetadata;
    if (viewportChanged || metadataArrived) {
      const w = Math.round(
        Math.min(window.innerWidth * FRACTION, window.innerHeight * FRACTION * ar),
      );
      normalBox = {
        w,
        h: Math.round(w / ar),
        vw: window.innerWidth,
        vh: window.innerHeight,
        fromMetadata: hasMetadata,
      };
    }
    if (!normalBox) return;
    const box = normalBox;
    surface.style.cssText =
      "position:absolute !important;left:50% !important;top:50% !important;" +
      "transform:translate(-50%,-50%) !important;" +
      `width:${box.w}px !important;height:${box.h}px !important;` +
      "border-radius:12px !important;box-shadow:0 24px 80px rgba(0,0,0,0.55) !important;" +
      fit +
      VIDEO_RESET;
  }
  // The browser normalizes cssText on write — keep the normalized form, so the
  // style guard's comparison (and re-assert) converges instead of looping.
  desiredCss = surface.style.cssText;
  layoutBar();
}

// The bar hugs the video's bottom edge, clamped to a sane width.
function layoutBar(): void {
  const surface = surfaceVideo ?? video;
  if (!bar || !surface) return;
  const r = surface.getBoundingClientRect();
  const w = Math.min(Math.max(r.width - 32, 280), 760);
  bar.style.width = Math.round(w) + "px";
  bar.style.left = Math.round(r.left + r.width / 2) + "px";
  bar.style.bottom = Math.max(Math.round(window.innerHeight - r.bottom + 14), 14) + "px";
}

function setFormat(f: ViewerFormat): void {
  fmt = f;
  document.documentElement.setAttribute(ATTR, f);
  fmtBtn?.setAttribute("aria-pressed", f === "theater" ? "true" : "false");
  sizeVideo();
}

function showBar(): void {
  if (!bar) return;
  bar.style.opacity = "1";
  bar.style.pointerEvents = "auto";
  clearTimeout(barTimer);
  if (video?.paused) return; // paused → controls stay up, like every player
  barTimer = setTimeout(() => {
    if (!bar || video?.paused) return;
    bar.style.opacity = "0";
    bar.style.pointerEvents = "none";
  }, BAR_HIDE_MS);
}

// Keep the bar's widgets honest against the media element's state.
function syncPlay(): void {
  playBtn?.setAttribute("aria-pressed", video && !video.paused ? "true" : "false");
  if (video?.paused) showBar();
}
function syncVolume(): void {
  if (!video) return;
  muteBtn?.setAttribute("aria-pressed", video.muted ? "true" : "false");
  if (volEl && !video.muted) volEl.value = String(Math.round(video.volume * 100));
}
function syncTime(): void {
  if (!video) return;
  const timeline = mediaTimeline(video);
  if (seekEl) {
    const seekable = timeline.kind !== "live";
    if (seekWrapEl) seekWrapEl.style.display = seekable ? "flex" : "none";
    seekEl.style.display = seekable ? "" : "none";
    if (seekable && !seeking && timeline.len > 0) {
      seekEl.value = String((timeline.pos / timeline.len) * 1000);
    }
  }
  if (timeEl) {
    timeEl.textContent =
      timeline.kind === "live"
        ? "LIVE"
        : `${fmtTime(timeline.pos)} / ${fmtTime(timeline.len)}`;
  }
}

// One glass button. Static, trusted markup via DOMParser (the AMO linter flags
// innerHTML), matching the launcher's construction. With `alt` markup, the two
// icons swap on aria-pressed (play⇄pause, sound⇄muted, expand⇄shrink).
function barButton(svg: string, alt: string | null, label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.title = label;
  if (alt) b.setAttribute("aria-pressed", "false");
  const body = new DOMParser().parseFromString(
    `<span class="ico ico-a">${svg}</span>` + (alt ? `<span class="ico ico-b">${alt}</span>` : ""),
    "text/html",
  ).body;
  while (body.firstChild) b.appendChild(body.firstChild);
  return b;
}

const I_PLAY =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const I_PAUSE =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
const I_SOUND =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const I_MUTED =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const I_GROW =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
const I_SHRINK =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>';
const I_CLOSE =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
const I_FIT =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 12h8M8 12l2-2M8 12l2 2M16 12l-2-2M16 12l-2 2"/></svg>';

// Our control bar, inside a shadow-rooted host that spans the overlay (the
// host itself is click-through; only the bar takes pointer events).
function mountBar(): void {
  if (!overlay) return;
  const host = document.createElement("div");
  Object.assign(host.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
  } as Partial<CSSStyleDeclaration>);
  const shadow = host.attachShadow({ mode: "open" });
  ensureGlassFilter(shadow);
  const style = document.createElement("style");
  style.textContent =
    // The bar mirrors the popup's glass cards: same tint/blur family, rounded
    // rectangle buttons with a quiet hover, 13px system type.
    `.bar{position:fixed;transform:translateX(-50%);display:flex;align-items:center;gap:12px;` +
    `padding:12px 16px;border-radius:16px;color:#fff;` +
    `background:rgb(20 20 22 / calc(0.4 * var(--glass-opacity,1)));` +
    `box-shadow:0 0 0 1px rgba(255,255,255,0.14),0 12px 40px rgba(0,0,0,0.4);` +
    `-webkit-backdrop-filter:blur(10px) saturate(180%) brightness(1.04);` +
    `backdrop-filter:blur(10px) saturate(180%) brightness(1.04)${GLASS_REFRACTION};` +
    `font:13px/1.2 -apple-system,system-ui,sans-serif;` +
    `opacity:0;pointer-events:none;transition:opacity .25s;z-index:1}` +
    `button{position:relative;width:32px;height:32px;flex:none;padding:0;border:0;border-radius:10px;` +
    `cursor:pointer;color:#fff;background:transparent;display:flex;align-items:center;justify-content:center;` +
    `transition:background .15s}` +
    `button:hover{background:rgba(255,255,255,0.12)}` +
    `button:active{background:rgba(255,255,255,0.2)}` +
    `.ico{position:absolute;inset:0;display:grid;place-items:center}` +
    `.ico svg{display:block}` +
    `.qbtn{width:auto;min-width:32px;max-width:86px;padding:0 8px;gap:5px}` +
    `.qbtn .ico{position:static;inset:auto;flex:none}` +
    `.qbtn-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;` +
    `font-variant-numeric:tabular-nums}` +
    `button .ico-b{visibility:hidden}` +
    `button[aria-pressed="true"] .ico-a{visibility:hidden}` +
    `button[aria-pressed="true"] .ico-b{visibility:visible}` +
    // Sliders match the popup's: a 6px translucent groove + a white 20×16 pill.
    `input[type="range"]{-webkit-appearance:none;appearance:none;height:16px;` +
    `background:transparent;cursor:pointer;margin:0}` +
    `input[type="range"]::-webkit-slider-runnable-track{height:6px;border-radius:3px;` +
    `background:rgba(255,255,255,0.22)}` +
    `input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:16px;` +
    `border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.4);margin-top:-5px;border:0}` +
    `input[type="range"]:focus-visible::-webkit-slider-thumb{box-shadow:0 1px 3px rgba(0,0,0,0.4),` +
    `0 0 0 3px rgba(255,255,255,0.5)}` +
    `input[type="range"]::-moz-range-track{height:6px;border-radius:3px;background:rgba(255,255,255,0.22)}` +
    `input[type="range"]::-moz-range-thumb{width:20px;height:16px;border-radius:8px;background:#fff;` +
    `box-shadow:0 1px 3px rgba(0,0,0,0.4);border:0}` +
    `.seekwrap{position:relative;flex:1;min-width:60px;display:flex;align-items:center}` +
    `.seek{flex:1;min-width:0;position:relative;z-index:1}` +
    // Chapter boundaries read like YouTube's: dark notches CUT INTO the groove
    // (hover shows the chapter title); sponsor segments tint the groove itself.
    `.marks{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:16px;pointer-events:none}` +
    `.mark-seg{position:absolute;top:50%;transform:translateY(-50%);height:6px;border-radius:3px;opacity:0.8;z-index:1}` +
    `.mark-tick{position:absolute;top:50%;transform:translateY(-50%);height:8px;width:2.5px;` +
    `background:rgba(0,0,0,0.65);pointer-events:auto;z-index:2}` +
    `.vol{width:64px;flex:none}` +
    `.time{flex:none;white-space:nowrap;opacity:.9;font-variant-numeric:tabular-nums}` +
    `.qwrap{position:relative;flex:none}` +
    `.qmenu{position:absolute;bottom:40px;left:50%;transform:translateX(-50%);display:none;` +
    `flex-direction:column;gap:2px;padding:6px;border-radius:10px;min-width:92px;` +
    `max-height:40vh;overflow:auto;background:rgb(20 20 22 / 0.9);` +
    `box-shadow:0 0 0 1px rgba(255,255,255,0.14),0 12px 40px rgba(0,0,0,0.4)}` +
    `.qmenu.open{display:flex}` +
    `.qitem{padding:6px 10px;border:0;border-radius:6px;cursor:pointer;white-space:nowrap;` +
    `text-align:center;color:#fff;background:transparent;font:inherit;width:auto;height:auto;display:block}` +
    `.qitem:hover{background:rgba(255,255,255,0.15)}` +
    `.qitem[aria-current="true"]{background:rgba(255,255,255,0.25)}`;
  shadow.append(style);

  bar = document.createElement("div");
  bar.className = "bar";
  playBtn = barButton(I_PLAY, I_PAUSE, i18n("viewerPlayAria") || "Play / pause");
  playBtn.addEventListener("click", () => {
    if (!video) return;
    if (video.paused) video.play()?.catch(() => {});
    else video.pause();
  });
  timeEl = document.createElement("span");
  timeEl.className = "time";
  const seekWrap = document.createElement("span");
  seekWrap.className = "seekwrap";
  seekWrapEl = seekWrap;
  marksEl = document.createElement("div");
  marksEl.className = "marks";
  seekEl = document.createElement("input");
  seekEl.type = "range";
  seekEl.className = "seek";
  seekEl.min = "0";
  seekEl.max = "1000";
  seekEl.step = "1";
  seekEl.setAttribute("aria-label", i18n("viewerSeekAria") || "Seek");
  seekEl.addEventListener("pointerdown", () => (seeking = true));
  seekEl.addEventListener("pointerup", () => (seeking = false));
  seekEl.addEventListener("input", () => {
    if (!video) return;
    const timeline = mediaTimeline(video);
    if (timeline.kind === "live") return;
    video.currentTime = timeline.start + (Number(seekEl!.value) / 1000) * timeline.len;
    syncTime();
  });
  muteBtn = barButton(I_SOUND, I_MUTED, i18n("viewerMuteAria") || "Mute");
  muteBtn.addEventListener("click", () => {
    if (video) video.muted = !video.muted;
  });
  volEl = document.createElement("input");
  volEl.type = "range";
  volEl.className = "vol";
  volEl.min = "0";
  volEl.max = "100";
  volEl.step = "1";
  volEl.setAttribute("aria-label", i18n("viewerVolumeAria") || "Volume");
  volEl.addEventListener("input", () => {
    if (!video) return;
    video.volume = Number(volEl!.value) / 100;
    video.muted = false;
  });
  // Fit mode menu: letterbox / crop / stretch (pulls a 4:3 picture out to the
  // edges).
  const fwrap = document.createElement("span");
  fwrap.className = "qwrap";
  const fitBtn = barButton(I_FIT, null, i18n("viewerFitAria") || "Fill mode");
  fitMenu = document.createElement("div");
  fitMenu.className = "qmenu";
  fitBtn.addEventListener("click", () => {
    if (!fitMenu) return;
    if (fitMenu.classList.contains("open")) {
      fitMenu.classList.remove("open");
      return;
    }
    fitMenu.textContent = "";
    for (const m of FIT_MODES) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "qitem";
      item.textContent = fitLabel(m);
      if (m === fitMode) item.setAttribute("aria-current", "true");
      item.addEventListener("click", () => {
        fitMode = m;
        fitMenu?.classList.remove("open");
        sizeVideo();
      });
      fitMenu.appendChild(item);
    }
    fitMenu.classList.add("open");
  });
  fwrap.append(fitBtn, fitMenu);
  fmtBtn = barButton(I_GROW, I_SHRINK, i18n("viewerTheaterAria") || "Pop out in theater format");
  fmtBtn.addEventListener("click", () => toggleViewer(fmt === "theater" ? "normal" : "theater"));
  const closeBtn = barButton(I_CLOSE, null, i18n("viewerCloseAria") || "Close the pop-out viewer");
  closeBtn.addEventListener("click", exitViewer);
  seekWrap.append(marksEl, seekEl);
  bar.append(playBtn, timeEl, seekWrap, muteBtn, volEl, fwrap, fmtBtn, closeBtn);
  bar.addEventListener("pointerenter", () => clearTimeout(barTimer));
  bar.addEventListener("pointerleave", showBar);
  shadow.append(bar);
  overlay.appendChild(host);
  bar.style.setProperty("--glass-opacity", String(S.glassOpacity));
}

// Chapter ticks (captured pre-adoption) and opt-in SponsorBlock bands on the
// seek bar. Waits for a real duration; bands render under the ticks.
async function loadMarkers(): Promise<void> {
  if (!marksEl || !video) return;
  const dur = video.duration;
  if (!Number.isFinite(dur) || dur <= 0) return;
  marksLoaded = true;
  marksEl.textContent = "";
  if ((S.sponsorMarks || hasNativeSponsorBlock()) && isYouTube()) {
    const id = youTubeVideoId();
    if (id) {
      const segs = await fetchSponsorSegments(id);
      if (!fmt || !marksEl) return;
      for (const sg of segs) {
        const d = document.createElement("div");
        d.className = "mark-seg";
        d.style.left = (sg.start / dur) * 100 + "%";
        d.style.width = Math.max(((sg.end - sg.start) / dur) * 100, 0.3) + "%";
        d.style.background = SPONSOR_COLORS[sg.category] || "#888";
        d.title = sg.category;
        marksEl.appendChild(d);
      }
    }
  }
  for (const ch of pendingChapters) {
    if (ch.start <= 0) continue;
    const t = document.createElement("div");
    t.className = "mark-tick";
    t.style.left = (ch.start / dur) * 100 + "%";
    if (ch.title) t.title = ch.title;
    marksEl.appendChild(t);
  }
}

// While popped out: the site's player may fight back — yank the video home or
// tear the spot down (the layer closed, SPA navigation). Both mean the show is
// over; put everything back (or let it go) and close.
function guard(): void {
  if (!fmt) return;
  if (
    !video ||
    !overlay ||
    !surfaceVideo?.isConnected ||
    (mirrored && !video.isConnected) ||
    (!mirrored && video.parentElement !== overlay) ||
    (holder && !holder.isConnected)
  ) {
    exitViewer();
  }
}

function hookGlobal(): void {
  if (hooked) return;
  hooked = true;
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || !fmt) return;
      e.preventDefault();
      e.stopPropagation();
      exitViewer();
    },
    true,
  );
  window.addEventListener("resize", () => sizeVideo(), { passive: true });
  // Real fullscreen supersedes the viewer — the two fight over the same video.
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement) exitViewer();
  });
}

// Media listeners + style enforcer for the adopted element. The shared
// AbortController also holds the overlay-level listeners, so re-wiring after a
// player recreated its element just adds the new element's set (the old one
// left the DOM together with its listeners).
function wireVideo(v: HTMLVideoElement): void {
  if (!media) return;
  const opt = { signal: media.signal };
  for (const ev of ["play", "pause"]) v.addEventListener(ev, syncPlay, opt);
  v.addEventListener("volumechange", syncVolume, opt);
  for (const ev of ["timeupdate", "durationchange", "loadedmetadata"]) {
    v.addEventListener(ev, syncTime, opt);
  }
  v.addEventListener("loadedmetadata", sizeVideo, opt); // the real aspect may arrive late
  v.addEventListener("ended", exitViewer, opt); // the show is over — hand the page back
  v.addEventListener(
    "durationchange",
    () => {
      if (!marksLoaded) loadMarkers();
    },
    opt,
  );
  surfaceVideo?.addEventListener(
    "click",
    () => (v.paused ? v.play()?.catch(() => {}) : v.pause()),
    opt,
  );
  // Sites (YouTube) keep restyling their video — snap ours back on sight.
  styleGuard?.disconnect();
  styleGuard = new MutationObserver(() => {
    const surface = surfaceVideo ?? video;
    if (fmt && surface && surface.style.cssText !== desiredCss) {
      surface.style.cssText = desiredCss;
    }
  });
  if (surfaceVideo) styleGuard.observe(surfaceVideo, { attributes: true, attributeFilter: ["style"] });
}

type CaptureVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

function createMirror(v: HTMLVideoElement): HTMLVideoElement | null {
  const capture = (v as CaptureVideo).captureStream ?? (v as CaptureVideo).mozCaptureStream;
  if (!capture) return null;
  try {
    const stream = capture.call(v);
    if (!stream || !stream.getVideoTracks().length) return null;
    const mirror = document.createElement("video");
    mirrorStream = stream;
    mirror.srcObject = stream;
    mirror.muted = true;
    mirror.playsInline = true;
    mirror.autoplay = true;
    mirror.controls = false;
    mirror.setAttribute("aria-hidden", "true");
    mirror.play()?.catch(() => {});
    return mirror;
  } catch (e) {
    return null;
  }
}

// Auto-open on playback (the `viewerAuto` setting). Once per video element:
// exiting adds the video to the seen set, so a manual close isn't fought the
// next time the user hits play.
const autoSeen = new WeakSet<HTMLVideoElement>();
document.addEventListener(
  "play",
  (e) => {
    const t = e.target;
    if (!(t instanceof HTMLVideoElement)) return;
    if (S.viewerAuto === "off" || fmt || autoSeen.has(t)) return;
    const r = t.getBoundingClientRect();
    if (r.width < 200 || r.height < 112) return; // thumbnails/previews don't count
    autoSeen.add(t);
    enter(S.viewerAuto, t);
  },
  true,
);

async function enter(format: ViewerFormat, target?: HTMLVideoElement): Promise<void> {
  const v = target ?? primaryVideo();
  if (!v || document.fullscreenElement || fmt) return;
  document.dispatchEvent(new Event(CLOSE_EVENT));
  fmt = format;
  video = v;
  surfaceVideo = null;
  mirrored = false;
  mirrorStream = null;
  normalBox = null;
  prevCss = v.style.cssText;
  prevControls = v.controls;
  overlay = document.createElement("div");
  overlay.setAttribute(OVERLAY, "");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: Z_OVERLAY,
    overflow: "hidden",
    background: "rgba(0, 0, 0, 0.92)",
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(overlay);
  hookGlobal();
  // Chapters depend on the SITE player's UI, so read them before the video
  // leaves it.
  pendingChapters =
    isYouTube() && Number.isFinite(v.duration) ? readYouTubeChapters(v.duration) : [];
  const mirror = createMirror(v);
  if (mirror) {
    mirrored = true;
    surfaceVideo = mirror;
    overlay.appendChild(mirror);
  } else {
    holder = document.createComment("vtp-viewer-holder");
    v.parentNode?.insertBefore(holder, v);
    surfaceVideo = v;
    overlay.appendChild(v);
    v.controls = false; // ours replace them; the site's flag is restored on exit
  }
  mountBar();
  prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  // Session-scoped wiring, all dropped at once on exit.
  media = new AbortController();
  const opt = { signal: media.signal };
  wireVideo(v);
  overlay.addEventListener("mousemove", showBar, { passive: true, signal: media.signal });
  // A press on the dim (not on the video or the bar) closes.
  overlay.addEventListener(
    "pointerdown",
    (e) => {
      if (e.target === overlay) exitViewer();
    },
    opt,
  );
  setFormat(format);
  syncPlay();
  syncVolume();
  syncTime();
  showBar();
  loadMarkers();
  guardTimer = setInterval(guard, 500);
}

export function exitViewer(): void {
  if (!fmt) return;
  fmt = null;
  if (guardTimer != null) {
    clearInterval(guardTimer);
    guardTimer = null;
  }
  clearTimeout(barTimer);
  media?.abort();
  media = null;
  styleGuard?.disconnect();
  styleGuard = null;
  pendingChapters = [];
  marksLoaded = false;
  document.documentElement.removeAttribute(ATTR);
  document.documentElement.style.overflow = prevOverflow;
  if (video) {
    autoSeen.add(video); // closing means "not this one again"
    if (!mirrored) {
      video.controls = prevControls;
      video.style.cssText = prevCss;
    }
    // Back to the exact spot the comment held. If the site tore that spot
    // down, the video is orphaned content — it goes away with the overlay.
    if (!mirrored && holder?.isConnected && video.parentElement === overlay) {
      holder.parentNode?.insertBefore(video, holder);
    }
  }
  mirrorStream?.getTracks().forEach((t) => t.stop());
  mirrorStream = null;
  holder?.remove();
  holder = null;
  overlay?.remove();
  overlay = null;
  bar = null;
  playBtn = muteBtn = fmtBtn = null;
  seekEl = seekWrapEl = volEl = null;
  timeEl = null;
  fitMenu = null;
  marksEl = null;
  seeking = false;
  normalBox = null;
  surfaceVideo = null;
  mirrored = false;
  video = null;
  // Players re-measure on resize — let the restored one lay itself out.
  window.dispatchEvent(new Event("resize"));
}

// The hotkey/button entry point. Closed → open in `format`; open in the other
// format → switch; open in the same format → close. So V and T each toggle
// their own view and jump straight between the two.
export function toggleViewer(format: ViewerFormat): void {
  if (fmt) {
    if (fmt === format) exitViewer();
    else setFormat(format);
    return;
  }
  enter(format);
}
