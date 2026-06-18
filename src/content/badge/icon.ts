// The frame that owns the video drives the toolbar badge; a frame that never had
// a video stays silent.
import { api, ctxValid } from "../platform/browser.js";
import { S } from "../state.js";
import { collectVideos } from "../videos.js";
import { onStreamPage } from "../live/detection.js";

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

  const hasVideo = collectVideos().length > 0;
  let payload: IconPayload;
  if (hasVideo) {
    payload = { action: "icon", text: speedLabel(S.currentSpeed), live: onStreamPage() };
  } else if (badgeHadVideo || urlChanged) {
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
