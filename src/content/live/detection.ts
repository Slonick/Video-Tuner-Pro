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
  active: boolean;
  lastMediaTime: number;
  pageKey: string;
}

let dvrSeenAt = 0;
const dvrState = new WeakMap<HTMLVideoElement, DvrState>();

function currentPageKey(): string {
  return `${location.hostname || ""}${location.pathname || ""}${location.search || ""}`;
}

function dvrActive(video: HTMLVideoElement): boolean {
  const state = dvrState.get(video);
  if (state?.active && atLiveHead(video)) {
    state.active = false;
    dvrSeenAt = 0;
  }
  return !!state?.active;
}

// YouTube's media timeline can jump backwards by about an hour while it replaces
// the MediaSource at startup or after a quality change. The MAIN-world bridge
// publishes the player's actual broadcaster latency, which distinguishes that
// technical reset from a viewer who really scrubbed back into DVR.
function publishedAtLiveHead(): boolean {
  const raw = document.documentElement.getAttribute("data-vtp-latency");
  if (raw == null) return false;
  const latency = Number(raw);
  return Number.isFinite(latency) && latency >= 0 && latency <= 15;
}

function seekableDistanceFromHead(video: HTMLVideoElement): number | null {
  try {
    const ranges = video.seekable;
    if (!ranges?.length) return null;
    const end = ranges.end(ranges.length - 1);
    const distance = end - video.currentTime;
    return Number.isFinite(distance) ? Math.max(0, distance) : null;
  } catch {
    return null;
  }
}

function atLiveHead(video: HTMLVideoElement): boolean {
  if (publishedAtLiveHead()) return true;
  if (isYouTube()) {
    const player =
      (video.closest && video.closest(".html5-video-player")) ||
      document.querySelector(".html5-video-player") ||
      document;
    const badge = player.querySelector<HTMLElement>(".ytp-live-badge");
    if (badge?.classList.contains("ytp-live-badge-is-livehead")) return true;
  }
  const distance = seekableDistanceFromHead(video);
  return distance != null && distance <= 3;
}

function hasUnderlyingLiveSignal(video: HTMLVideoElement): boolean {
  const flag = document.documentElement.getAttribute("data-vtp-live");
  if (flag === "1") return true;
  if (flag === "0") return false;
  if (unboundedDuration(video.duration)) return true;
  if (liveProbe.get(video)?.live) return true;
  if (!isYouTube()) return false;
  const player =
    (video.closest && video.closest(".html5-video-player")) ||
    document.querySelector(".html5-video-player");
  return !!(
    player?.classList.contains("ytp-live") || player?.querySelector(".ytp-time-display.ytp-live")
  );
}

// Drive DVR detection from a live <video>'s timeupdate/seeking events. A backward
// jump in playback position is the user scrubbing into the recording — Live-sync
// only ever changes the rate, so playback time never moves backward on its own.
// Returning to the live head clears it, detected via YouTube's own LIVE badge
// (it carries `ytp-live-badge-is-livehead` only when playback sits at the edge).
export function trackDvr(video: HTMLVideoElement): void {
  let state = dvrState.get(video);
  const pageKey = currentPageKey();
  if (state && state.pageKey !== pageKey) {
    if (state.active) dvrSeenAt = 0;
    dvrState.delete(video);
    state = undefined;
  }
  if (!state) {
    state = { active: false, lastMediaTime: 0, pageKey };
    dvrState.set(video, state);
  }
  const t = video.currentTime;
  if (state.active && atLiveHead(video)) {
    state.active = false;
    dvrSeenAt = 0;
  } else if (
    !state.active &&
    hasUnderlyingLiveSignal(video) &&
    state.lastMediaTime &&
    t < state.lastMediaTime - 3
  ) {
    state.active = true;
    dvrSeenAt = Date.now();
  }
  state.lastMediaTime = t;
}

export function resetDvrFor(video: HTMLVideoElement, force = false): void {
  const state = dvrState.get(video);
  if (!force && state?.active && state.pageKey === currentPageKey() && !atLiveHead(video)) {
    state.lastMediaTime = video.currentTime;
    return;
  }
  dvrState.delete(video);
  if (state?.active) dvrSeenAt = 0;
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
  if (dvrActive(video)) return false;
  // YouTube DVR: a live broadcast you've scrubbed back from is a recording, not a
  // stream, until you return to the live edge (see trackDvr/dvrMode).
  if (isYouTube() && flag === "1") return true;
  if (flag === "1") return true;

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

  // A transient `getVideoData().isLive === false` is common while YouTube swaps
  // its MediaSource. Do not let that bridge value suppress live markers scoped
  // to the current player; once those markers are absent, the explicit VOD flag
  // can safely clear sticky live state after SPA navigation.
  if (flag === "0") return false;

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
  lastDuration: number;
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
    liveProbe.set(v, {
      lastEnd: 0,
      lastDuration: v.duration,
      lastT: t,
      lastGrow: t,
      hits: 0,
      live: true,
    });
    return;
  }
  const finite = finiteVodDuration(v.duration);
  const s = liveProbe.get(v);
  if (!s) {
    const end = finite ? v.duration : streamEnd(v);
    liveProbe.set(v, {
      lastEnd: end,
      lastDuration: v.duration,
      lastT: t,
      lastGrow: 0,
      hits: 0,
      live: false,
    });
    return;
  }
  const dT = (t - s.lastT) / 1000;
  if (dT < 0.4) return; // need spacing between samples for a stable rate
  if (finite && v.duration === s.lastDuration) {
    s.lastEnd = v.duration;
    s.lastT = t;
    s.hits = 0;
    s.lastGrow = 0;
    s.live = false;
    return;
  }
  const end = finite ? v.duration : streamEnd(v);
  const rate = (end - s.lastEnd) / dT;
  s.lastEnd = end;
  s.lastDuration = v.duration;
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
export function liveVideoFrom(videos: HTMLVideoElement[]): HTMLVideoElement | null {
  const candidates: { video: HTMLVideoElement; area: number }[] = [];
  for (const v of videos) {
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

export function liveVideo(): HTMLVideoElement | null {
  return liveVideoFrom(collectVideos());
}

// True if this page is a live stream, staying sticky through brief detection
// flickers (quality switches momentarily report a finite duration on Twitch).
export function onStreamPage(live?: HTMLVideoElement | null): boolean {
  if (live === undefined ? liveVideo() : live) return true;
  if (document.documentElement.getAttribute("data-vtp-live") === "0") {
    liveSeenAt = 0;
    return false;
  }
  if (Date.now() - dvrSeenAt < 6000) return false; // scrubbed back into the DVR buffer
  return Date.now() - liveSeenAt < 6000;
}
