import { collectVideos } from "../videos.js";

let liveSeenAt = 0; // timestamp of the last live <video> we saw (sticky detection)

function isYouTube(): boolean {
  return /(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname);
}

// YouTube DVR (scrubbed-back) state. On a live broadcast you can seek back into
// the buffer to watch the recording while the stream is still going, and the
// player keeps reporting getVideoData().isLive === true. We don't want that to
// count as a live stream — there, manual speed should work and Live-sync should
// pause, exactly like a VOD. So we track whether the user has scrubbed away from
// the live edge (see trackDvr) and treat the page as a recording until they're
// back at the live head.
let dvrMode = false;
let lastMediaTime = 0;

// Drive DVR detection from a live <video>'s timeupdate/seeking events. A backward
// jump in playback position is the user scrubbing into the recording — Live-sync
// only ever changes the rate, so playback time never moves backward on its own.
// Returning to the live head clears it, detected via YouTube's own LIVE badge
// (it carries `ytp-live-badge-is-livehead` only when playback sits at the edge).
export function trackDvr(video: HTMLVideoElement): void {
  if (!isYouTube() || document.documentElement.getAttribute("data-vtp-live") !== "1") {
    dvrMode = false;
    lastMediaTime = 0;
    return;
  }
  const t = video.currentTime;
  const badge = document.querySelector<HTMLElement>(".ytp-live-badge");
  if (badge && badge.classList.contains("ytp-live-badge-is-livehead")) dvrMode = false;
  else if (lastMediaTime && t < lastMediaTime - 3) dvrMode = true;
  lastMediaTime = t;
}

// New content (SPA navigation, quality reload) starts at the live edge.
export function resetDvr(): void {
  dvrMode = false;
  lastMediaTime = 0;
}

// A live edge has no real length. Chromium signals that with duration === Infinity;
// Firefox instead reports a huge INT64_MAX-microseconds sentinel (~9.2e12 s) while
// the stream loads. Treat either as live. NaN (before metadata) stays excluded so a
// normal VOD isn't misflagged during its initial load. 1e7 s (~115 days) matches
// the sentinel cutoff streamEnd already uses.
function unboundedDuration(d: number): boolean {
  return d > 1e7;
}

export function isLive(video: HTMLVideoElement): boolean {
  // The MAIN-world probe (inject.ts) publishes the player's own live flag
  // (YouTube's getVideoData().isLive) to data-vtp-live — authoritative when
  // present, so it wins over the duration/DOM heuristics below.
  const flag = document.documentElement.getAttribute("data-vtp-live");
  // YouTube DVR: a live broadcast you've scrubbed back from is a recording, not a
  // stream, until you return to the live edge (see trackDvr/dvrMode).
  if (isYouTube() && flag === "1") return !dvrMode;
  if (flag === "1") return true;
  if (flag === "0") return false;

  // Most live MSE streams report an infinite duration (Twitch, many players).
  if (unboundedDuration(video.duration)) return true;

  // YouTube live (including DVR streams) reports a FINITE, growing duration, so
  // the duration check alone misses it. YouTube adds the "ytp-live" class to the
  // player and time-display, and shows a live badge — only while a live stream is
  // playing, never on regular VOD. Use those as the signal.
  if (isYouTube()) {
    // Scope every check to the player that owns THIS video, not the whole
    // document — a stale watch player left over from a previous live stream
    // still carries ytp-live classes and a badge, and a global query would let
    // those leak onto an unrelated (e.g. inline-preview) video.
    const player =
      (video.closest && video.closest(".html5-video-player")) ||
      document.querySelector(".html5-video-player");
    if (player) {
      if (player.classList.contains("ytp-live")) return true;
      if (player.querySelector(".ytp-time-display.ytp-live")) return true;
      const badge = player.querySelector<HTMLElement>(".ytp-live-badge");
      if (badge && badge.offsetParent !== null) return true; // visible = live
    }
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
interface LiveProbe {
  lastEnd: number;
  lastT: number;
  lastGrow: number;
  hits: number;
  live: boolean;
}
const liveProbe = new WeakMap<HTMLVideoElement, LiveProbe>();

function streamEnd(v: HTMLVideoElement): number {
  let end = 0;
  try {
    const sk = v.seekable; // some players (Twitch) report a huge sentinel here
    if (sk && sk.length) {
      const e = sk.end(sk.length - 1);
      if (isFinite(e) && e < 1e7) end = Math.max(end, e);
    }
    const bf = v.buffered;
    if (bf && bf.length) end = Math.max(end, bf.end(bf.length - 1));
    if (isFinite(v.duration) && v.duration < 1e7) end = Math.max(end, v.duration);
  } catch (e) {
    /* ignore */
  }
  return end;
}

export function probeLive(v: HTMLVideoElement): void {
  if (!v) return;
  const t = Date.now();
  if (unboundedDuration(v.duration)) {
    liveProbe.set(v, { lastEnd: 0, lastT: t, lastGrow: t, hits: 0, live: true });
    return;
  }
  const end = streamEnd(v);
  const s = liveProbe.get(v);
  if (!s) {
    liveProbe.set(v, { lastEnd: end, lastT: t, lastGrow: 0, hits: 0, live: false });
    return;
  }
  const dT = (t - s.lastT) / 1000;
  if (dT < 0.4) return; // need spacing between samples for a stable rate
  const rate = (end - s.lastEnd) / dT;
  s.lastEnd = end;
  s.lastT = t;
  // Real-time growth (~1x) = a live edge; VOD is either flat (~0) or bursty (>>1).
  if (rate > 0.3 && rate < 1.7) {
    s.hits++;
    if (s.hits >= 3) s.lastGrow = t;
  } else {
    s.hits = 0;
  }
  s.live = s.lastGrow > 0 && t - s.lastGrow < 8000; // sticky through brief stalls
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
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  if (best) liveSeenAt = Date.now();
  return best;
}

// True if this page is a live stream, staying sticky through brief detection
// flickers (quality switches momentarily report a finite duration on Twitch).
export function onStreamPage(): boolean {
  if (dvrMode) return false; // scrubbed back into the DVR buffer — treat as a recording
  return !!liveVideo() || Date.now() - liveSeenAt < 6000;
}
