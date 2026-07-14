import { collectVideos } from "../videos.js";

let liveSeenAt = 0; // timestamp of the last live <video> we saw (sticky detection)
let liveSeenPageKey = ""; // never carry sticky live state across SPA route changes

function isYouTube(): boolean {
  return /(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname);
}

function isBoosty(): boolean {
  return /(^|\.)boosty\.to$/.test(location.hostname);
}

// These routes are authoritative recordings even when the site keeps a hidden
// live/preload player mounted beside the visible VOD. Twitch and Kick both do
// this during SPA navigation; letting that secondary Infinity-duration element
// win makes Live-sync grab the page and turns the badge into a bogus hours-long
// latency while the Viewer correctly shows a finite timeline.
function isKnownVodPage(): boolean {
  const host = location.hostname.toLowerCase();
  const path = location.pathname;
  if (/(^|\.)twitch\.tv$/.test(host)) return /^\/videos\/\d+(?:\/|$)/.test(path);
  if (/(^|\.)kick\.com$/.test(host)) return /^\/[^/]+\/videos\/[^/]+(?:\/|$)/.test(path);
  if (/(^|\.)live\.vkvideo\.ru$/.test(host)) return /^\/[^/]+\/record\/[^/]+(?:\/|$)/.test(path);
  return false;
}

// Boosty VODs briefly expose an unbounded MediaSource duration while their
// metadata or a new quality level is attached. That is indistinguishable from a
// live MSE stream at the <video> API level, but Boosty gives broadcasts their own
// stable route. Keep the generic Infinity/growing-edge heuristics away from post
// videos and modal VODs; otherwise they are locked to 1x until the sticky live
// state expires. A creator's actual broadcast lives at /streams/video_stream.
function isBoostyLivePage(): boolean {
  return isBoosty() && /\/streams\/video_stream(?:\/|$)/.test(location.pathname);
}

const VK_LIVE_RESERVED = new Set([
  "app",
  "feed",
  "search",
  "settings",
  "help",
  "support",
  "about",
  "categories",
  "category",
  "following",
]);

// VK Live channel broadcasts live at /<channel>; recordings have the stable
// /<channel>/record/<id> route. Keep this route signal narrow so a recording,
// catalog page, or settings page never inherits the live Viewer layout.
export function isVkLiveChannelPage(host = location.hostname, path = location.pathname): boolean {
  if (!/(^|\.)live\.vkvideo\.ru$/i.test(host)) return false;
  const parts = path.split("/").filter(Boolean);
  return parts.length === 1 && !VK_LIVE_RESERVED.has(parts[0].toLowerCase());
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
  if (isKnownVodPage()) return false;
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

  // Boosty's VOD player transiently reports Infinity during MSE startup and
  // quality changes. Only its dedicated broadcast route may use the generic
  // media-element live heuristics below.
  if (isBoosty() && !isBoostyLivePage()) return false;

  // Most live MSE streams report an infinite duration (Twitch, many players).
  if (unboundedDuration(video.duration)) return true;

  // Generic fallback (covers Twitch low-latency and players that expose a finite
  // but growing live edge): a stream whose media edge advances in real time.
  const s = liveProbe.get(video);
  if (s?.live) {
    // An SPA can reuse the exact same media element when leaving a stream for a
    // recording. The new finite metadata is authoritative immediately; do not
    // keep reporting the old unbounded probe until the next background sample.
    if (finiteVodDuration(video.duration) && !finiteVodDuration(s.lastDuration)) {
      resetProbeToFinite(video, s);
    } else {
      return true;
    }
  }

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

function resetProbeToFinite(video: HTMLVideoElement, probe: LiveProbe, now = Date.now()): void {
  probe.lastEnd = video.duration;
  probe.lastDuration = video.duration;
  probe.lastT = now;
  probe.lastGrow = 0;
  probe.hits = 0;
  probe.live = false;
}

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
  const wasFinite = finiteVodDuration(s.lastDuration);
  // A player can briefly expose a growing buffered edge while an ordinary VOD
  // attaches its final finite duration. That transition is authoritative and
  // must clear the provisional live result immediately.
  if (finite && !wasFinite) {
    resetProbeToFinite(v, s, t);
    return;
  }
  const end = finite ? v.duration : streamEnd(v);
  const delta = end - s.lastEnd;
  // DASH players such as VK Video publish their finite live edge one media
  // segment at a time. timeupdate fires several times between segment arrivals;
  // keep the previous edge timestamp through those flat samples so the next
  // segment is measured over its real wall-clock interval instead of looking
  // like a burst. The confirmed result remains sticky through short stalls.
  if (Math.abs(delta) < 0.01) {
    s.lastDuration = v.duration;
    s.live = s.lastGrow > 0 && t - s.lastGrow < 8000;
    if (!s.live && t - s.lastT >= 8000) s.hits = 0;
    return;
  }
  if (dT < 0.4) return; // need spacing between edge changes for a stable rate
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
  if (best) {
    liveSeenAt = Date.now();
    liveSeenPageKey = currentPageKey();
  }
  return best;
}

export function liveVideo(): HTMLVideoElement | null {
  return liveVideoFrom(collectVideos());
}

// True if this page is a live stream, staying sticky through brief detection
// flickers (quality switches momentarily report a finite duration on Twitch).
export function onStreamPage(live?: HTMLVideoElement | null): boolean {
  const pageKey = currentPageKey();
  if (liveSeenPageKey && liveSeenPageKey !== pageKey) {
    liveSeenAt = 0;
    liveSeenPageKey = "";
  }
  if (live === undefined ? liveVideo() : live) {
    liveSeenAt = Date.now();
    liveSeenPageKey = pageKey;
    return true;
  }
  if (document.documentElement.getAttribute("data-vtp-live") === "0") {
    liveSeenAt = 0;
    liveSeenPageKey = "";
    return false;
  }
  if (Date.now() - dvrSeenAt < 6000) return false; // scrubbed back into the DVR buffer
  return Date.now() - liveSeenAt < 6000;
}
