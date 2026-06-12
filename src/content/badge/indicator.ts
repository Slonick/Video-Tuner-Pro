import { S } from "../state.js";
import { primaryVideo } from "../videos.js";

type Timer = ReturnType<typeof setTimeout>;

let indicatorEl: HTMLDivElement | null = null;
let indicatorTimer: Timer | undefined;

export function showIndicator(text?: string): void {
  if (!document.body) return;
  let el = indicatorEl;
  if (!el) {
    el = document.createElement("div");
    el.style.cssText = [
      "position:fixed", "z-index:2147483647", "pointer-events:none",
      "font:500 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif",
      "color:#fff", "background:rgba(0,0,0,0.55)", "padding:5px 9px",
      "border-radius:6px", "white-space:nowrap", "transition:opacity .2s", "opacity:0",
      "-webkit-backdrop-filter:blur(3px)", "backdrop-filter:blur(3px)"
    ].join(";");
    indicatorEl = el;
  }

  // Overlay sits over the video via fixed coords. Host is normally <body>; in
  // fullscreen we move it under the fullscreen element so it renders over the
  // player. We avoid hosting inside the player container (a transform there would
  // break fixed positioning).
  const video = primaryVideo();
  const fsEl = document.fullscreenElement;
  const host: Element = (fsEl && fsEl.tagName !== "VIDEO") ? fsEl : document.body;
  if (el.parentNode !== host) host.appendChild(el);

  if (video) {
    const r = video.getBoundingClientRect();
    el.style.left = Math.round(r.left + r.width / 2) + "px";
    el.style.top = Math.round(r.top + Math.max(10, r.height * 0.05)) + "px";
    el.style.transform = "translateX(-50%)";
  } else {
    el.style.left = "50%";
    el.style.top = "14px";
    el.style.transform = "translateX(-50%)";
  }

  el.textContent = text || `${Math.round(S.currentSpeed * 100)}%`;
  el.style.opacity = "1";
  clearTimeout(indicatorTimer);
  indicatorTimer = setTimeout(() => {
    if (indicatorEl) indicatorEl.style.opacity = "0";
  }, 1200);
}

// True if a node is inside our own indicator (so the observer ignores our writes).
export function ownsNode(node: Node | null): boolean {
  return !!(indicatorEl && node && indicatorEl.contains(node));
}
