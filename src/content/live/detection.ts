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
interface DvrState {
  generation: number;
  active: boolean;
  lastMediaTime: number;
}

let dvrGeneration = 0;
let dvrSeenAt = 0;
const dvrState = new WeakMap<HTMLVideoElement, DvrState>();

function dvrActive(video: HTMLVideoElement): boolean {
  const state = dvrState.get(video);
  return !!state && state.generation === dvrGeneration && state.active;
}

// Drive DVR detection from a live <video>'s timeupdate/seeking events. A backward
// jump in playback position is the user scrubbing into the recording — Live-sync
// only ever changes the rate, so playback time never moves backward on its own.
// Returning to the live head clears it, detected via YouTube's own LIVE badge
// (it carries `ytp-live-badge-is-livehead` only when playback sits at the edge).
export function trackDvr(video: HTMLVideoElement): void {
  if (!isYouTube()) {
    dvrGeneration++;
    dvrSeenAt = 0;
    return;
  }
  if (document.documentElement.getAttribute("data-vtp-live") !== "1") return;
  let state = dvrState.get(video);
  if (!state || state.generation !== dvrGeneration) {
    state = { generation: dvrGeneration, active: false, lastMediaTime: 0 };
    dvrState.set(video, state);
  }
  const t = video.currentTime;
  const player =
    (video.closest && video.closest(".html5-video-player")) ||
    document.querySelector(".html5-video-player") ||
    document;
  const badge = player.querySelector<HTMLElement>(".ytp-live-badge");
  if (badge && badge.classList.contains("ytp-live-badge-is-livehead")) {
    state.active = false;
    dvrSeenAt = 0;
  } else if (state.lastMediaTime && t < state.lastMediaTime - 3) {
    state.active = true;
    dvrSeenAt = Date.now();
  }
  state.lastMediaTime = t;
}

// New content (SPA navigation, quality reload) starts at the live edge.
export function resetDvr(): void {
  dvrGeneration++;
  dvrSeenAt = 0;
}

// A live edge has no real length. Chromium signals that with duration === Infinity;
// Firefox instead reports a huge INT64_MAX-microseconds sentinel (~9.2e12 s) while
// the stream loads. Treat either as live. NaN (before metadata) stays excluded so a
// normal VOD isn't misflagged during its initial load. 1e7 s (~115 days) matches
// the sentinel cutoff streamEnd already uses.
function unboundedDuration(d: number): boolean {
  return d > 1e7;
}

function finiteVodDuration(d: number): boolean {
  return Number.isFinite(d) && d > 0 && d < 1e7;
}

export function isLive(video: HTMLVideoElement): boolean {
  // The MAIN-world probe (inject.ts) publishes the player's own live flag
  // (YouTube's getVideoData().isLive) to data-vtp-live — authoritative when
  // present, so it wins over the duration/DOM heuristics below.
  const flag = document.documentElement.getAttribute("data-vtp-live");
  // YouTube DVR: a live broadcast you've scrubbed back from is a recording, not a
  // stream, until you return to the live edge (see trackDvr/dvrMode).
  if (isYouTube() && flag === "1") return !dvrActive(video);
  if (flag === "1") return true;
  if (flag === "0") return false;

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
    }
  }

  // Most live MSE streams report an infinite duration (Twitch, many players).
  if (unboundedDuration(video.duration)) return true;

  // Generic fallback (covers Twitch low-latency and players that expose a finite
  // but growing live edge): a stream whose media edge advances in real time.
  const s = liveProbe.get(video);
  if (s && s.live) return true;

  // Otherwise a real finite duration is a VOD. Some VOD players briefly look
  // unbounded while metadata/quality reloads settle; probeLive clears those
  // samples as soon as the finite edge stops growing like a live stream.
  if (finiteVodDuration(video.duration)) return false;
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
  const finite = finiteVodDuration(v.duration);
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
    if (finite) s.lastGrow = 0;
  }
  s.live = s.lastGrow > 0 && t - s.lastGrow < 8000; // sticky through brief stalls
}

// Pick the main live <video>: prefer the one that's actually playing and largest,
// so tiny preview/ad players don't make detection flicker on/off.
export function liveVideo(): HTMLVideoElement | null {
  const candidates: { video: HTMLVideoElement; area: number }[] = [];
  for (const v of collectVideos()) {
    if (!isLive(v)) continue;
    const r = v.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) continue;
    const area = r.width * r.height;
    candidates.push({ video: v, area });
  }

  let best: HTMLVideoElement | null = null;
  let bestScore = -1;
  for (const { video: v, area } of candidates) {
    const score = (v.paused ? 0 : 1e9) + area;
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
  if (liveVideo()) return true;
  if (Date.now() - dvrSeenAt < 6000) return false; // scrubbed back into the DVR buffer
  return Date.now() - liveSeenAt < 6000;
}
