import { clampNum } from "./clamp.js";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// The badge's top-left as a fraction of the video frame, clamped so the whole
// badge stays inside it. Stored per site and re-applied on every render, so the
// position survives resize / fullscreen (it scales with the video).
export function badgeFraction(badge: Rect, video: Rect): { fx: number; fy: number } {
  const maxX = Math.max(0, video.width - badge.width);
  const maxY = Math.max(0, video.height - badge.height);
  const x = clampNum(badge.left - video.left, 0, maxX, 0);
  const y = clampNum(badge.top - video.top, 0, maxY, 0);
  return {
    fx: video.width > 0 ? x / video.width : 0,
    fy: video.height > 0 ? y / video.height : 0,
  };
}
