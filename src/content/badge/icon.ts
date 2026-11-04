// The frame that owns the video drives the toolbar badge; a frame that never had
// a video stays silent.
import { api, ctxValid } from "../platform/browser.js";
import { S } from "../state.js";
import { hasVideos } from "../videos.js";
import { onStreamPage } from "../live/detection.js";
import { listenerOptions } from "../lifecycle.js";

interface IconPayload {
  action: "icon";
  text?: string;
  live?: boolean;
  clear?: boolean;
}

let lastBadge: string | null = null;
let badgeHadVideo = false;
let badgeUrl = location.href;

export function speedLabel(s: number): string {
  let str = String(Math.round(s * 100) / 100);
  if (!str.includes(".")) str += ".0"; // 1 -> "1.0", 2 -> "2.0", 1.5 -> "1.5"
  return str;
}

export function updateBadge(): void {
  // SPA navigation changes the URL without reloading the content script, so the
  // dedupe cache would suppress the re-send. Reset it on URL change.
  const urlChanged = location.href !== badgeUrl;
  if (urlChanged) {
    badgeUrl = location.href;
    lastBadge = null;
  }

  const hasVideo = !S.siteDisabled && hasVideos();
  let payload: IconPayload;
  if (hasVideo) {
    payload = { action: "icon", text: speedLabel(S.currentSpeed), live: onStreamPage() };
  } else if (badgeHadVideo) {
    payload = { action: "icon", clear: true };
  } else {
    return;
  }
  badgeHadVideo = hasVideo;
  const key = JSON.stringify(payload);
  if (key === lastBadge) return;
  lastBadge = key;
  if (!ctxValid()) return;
  try {
    api.runtime.sendMessage(payload);
  } catch (e) {}
}

// An iframe that goes away (navigated, removed) hands the toolbar badge back, or its
// speed lingers there and the background keeps refusing other frames. The top frame
// sends nothing: a tab navigation already resets the badge, and a late clear could
// wipe the next page's. Forgetting what was sent lets a page restored from the
// back/forward cache report its badge again.
window.addEventListener(
  "pagehide",
  () => {
    if (!badgeHadVideo) return;
    badgeHadVideo = false;
    lastBadge = null;
    if (window.top === window || !ctxValid()) return;
    try {
      api.runtime.sendMessage({ action: "icon", clear: true });
    } catch (e) {}
  },
  listenerOptions(),
);
