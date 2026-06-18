// Seconds of media buffered ahead of the current position. On a live stream the
// player downloads up to the live edge, so this doubles as our lag-behind-live.
export function forwardBuffer(video: HTMLVideoElement): number {
  const b = video.buffered;
  const t = video.currentTime;
  try {
    for (let i = 0; i < b.length; i++) {
      if (t >= b.start(i) - 0.25 && t <= b.end(i) + 0.25) return b.end(i) - t;
    }
  } catch (e) {
    /* ignore */
  }
  return 0;
}

// Latency to the broadcaster (seconds), when a site exposes it. Twitch/YouTube's
// value is published to data-vtp-latency by the MAIN-world probe (inject.ts);
// standard video APIs can't compute it. Null when unavailable — callers fall back
// to the buffered-ahead value.
export function streamLatency(): number | null {
  try {
    const a = document.documentElement.getAttribute("data-vtp-latency");
    if (a == null) return null;
    const n = parseFloat(a);
    return isFinite(n) && n > 0 ? n : null;
  } catch (e) {
    return null;
  }
}
