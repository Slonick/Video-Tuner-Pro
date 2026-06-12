import { collectVideos } from "../videos.js";

let liveSeenAt = 0;     // timestamp of the last live <video> we saw (sticky detection)

export function isLive(video: HTMLVideoElement): boolean {
  // Most live MSE streams report an infinite duration (Twitch, many players).
  if (video.duration === Infinity) return true;

  // YouTube live (including DVR streams) reports a FINITE, growing duration, so
  // the duration check alone misses it. YouTube adds the "ytp-live" class to the
  // player and time-display, and shows a live badge — only while a live stream is
  // playing, never on regular VOD. Use those as the signal.
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)) {
    const player = (video.closest && video.closest(".html5-video-player")) ||
                   document.querySelector(".html5-video-player");
    if (player && player.classList.contains("ytp-live")) return true;
    if (document.querySelector(".ytp-time-display.ytp-live")) return true;
    const badge = document.querySelector<HTMLElement>(".ytp-live-badge");
    if (badge && badge.offsetParent !== null) return true; // visible = live
  }

  // Generic fallback (covers Twitch low-latency etc., where duration isn't
  // Infinity): a stream whose media edge advances in real time, set by probeLive.
  const s = liveProbe.get(video);
  if (s && s.live) return true;
  return false;
}

// Live content can only be fetched at ~1x real time; a VOD exposes its whole
// length immediately and buffers ahead faster than real time. So we sample the
// furthest known media position and call it live when it advances at roughly 1x.
interface LiveProbe { lastEnd: number; lastT: number; lastGrow: number; hits: number; live: boolean; }
const liveProbe = new WeakMap<HTMLVideoElement, LiveProbe>();

function streamEnd(v: HTMLVideoElement): number {
  let end = 0;
  try {
    const sk = v.seekable; // some players (Twitch) report a huge sentinel here
    if (sk && sk.length) { const e = sk.end(sk.length - 1); if (isFinite(e) && e < 1e7) end = Math.max(end, e); }
    const bf = v.buffered;
    if (bf && bf.length) end = Math.max(end, bf.end(bf.length - 1));
    if (isFinite(v.duration) && v.duration < 1e7) end = Math.max(end, v.duration);
  } catch (e) { /* ignore */ }
  return end;
}

export function probeLive(v: HTMLVideoElement): void {
  if (!v) return;
  const t = Date.now();
  if (v.duration === Infinity) { liveProbe.set(v, { lastEnd: 0, lastT: t, lastGrow: t, hits: 0, live: true }); return; }
  const end = streamEnd(v);
  let s = liveProbe.get(v);
  if (!s) { liveProbe.set(v, { lastEnd: end, lastT: t, lastGrow: 0, hits: 0, live: false }); return; }
  const dT = (t - s.lastT) / 1000;
  if (dT < 0.4) return; // need spacing between samples for a stable rate
  const rate = (end - s.lastEnd) / dT;
  s.lastEnd = end; s.lastT = t;
  // Real-time growth (~1x) = a live edge; VOD is either flat (~0) or bursty (>>1).
  if (rate > 0.3 && rate < 1.7) { s.hits++; if (s.hits >= 3) s.lastGrow = t; }
  else { s.hits = 0; }
  s.live = s.lastGrow > 0 && (t - s.lastGrow) < 8000; // sticky through brief stalls
}

// Pick the main live <video>: prefer the one that's actually playing and largest,
// so tiny preview/ad players don't make detection flicker on/off.
export function liveVideo(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let bestScore = -1;
  for (const v of collectVideos()) {
    if (!isLive(v)) continue;
    const r = v.getBoundingClientRect();
    const score = (v.paused ? 0 : 1e9) + r.width * r.height;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  if (best) liveSeenAt = Date.now();
  return best;
}

// True if this page is a live stream, staying sticky through brief detection
// flickers (quality switches momentarily report a finite duration on Twitch).
export function onStreamPage(): boolean {
  return !!liveVideo() || (Date.now() - liveSeenAt < 6000);
}
