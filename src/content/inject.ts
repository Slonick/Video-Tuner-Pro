// MAIN-world probe (Twitch + YouTube, plus a generic hls.js fallback for Kick /
// w.tv). The isolated content script can't reach the page's JS objects, so this
// tiny script runs in the page world, reads the player's "latency to
// broadcaster"/"live latency" (the value the site's own stats overlay shows), and
// publishes it to a DOM attribute — which IS visible
// across worlds. The isolated script reads `data-vtp-latency` (live.js
// streamLatency).
//
// Everything is wrapped defensively: these internals are private and may change,
// so any failure just leaves the attribute unset and the badge falls back to the
// buffered-ahead value. There are no public types for these player/React-fiber
// internals, so we describe narrow shapes for exactly the fields we read.
(function () {
  "use strict";
  const BRIDGE_VERSION = "2026-07-10-current-youtube-live";
  const win = window as typeof window & {
    __vtpLatencyBridgeInstalled?: boolean | string;
    __vtpLatencyBridgeCleanup?: () => void;
    __vtpQualityHls?: Array<{ hls: HlsLike; video?: HTMLVideoElement | null }>;
    ytInitialPlayerResponse?: YouTubePlayerResponse | null;
  };
  if (win.__vtpLatencyBridgeInstalled === BRIDGE_VERSION) return;
  try {
    win.__vtpLatencyBridgeCleanup?.();
  } catch (e) {
    /* stale bridge cleanup must not block the new bridge */
  }
  win.__vtpLatencyBridgeInstalled = BRIDGE_VERSION;
  const ATTR = "data-vtp-latency";
  const LIVE_ATTR = "data-vtp-live";
  const HOSTNAME = location.hostname;
  const IS_TWITCH = /(^|\.)twitch\.tv$/i.test(HOSTNAME);
  const IS_YOUTUBE = /(^|\.)youtube(-nocookie)?\.com$/i.test(HOSTNAME);

  function isActiveBridge(): boolean {
    return win.__vtpLatencyBridgeInstalled === BRIDGE_VERSION;
  }

  function setAttrIfChanged(root: HTMLElement, name: string, value: string | null): void {
    if (value == null) {
      if (root.hasAttribute(name)) root.removeAttribute(name);
    } else if (root.getAttribute(name) !== value) {
      root.setAttribute(name, value);
    }
  }

  // --- Narrow shapes of the private internals we touch -----------------------
  interface TwitchStats {
    hlsLatencyBroadcaster?: number;
    broadcasterLatency?: number;
  }
  interface TwitchPlayer {
    getLiveLatency?: () => unknown;
    getStatistics?: () => TwitchStats | null | undefined;
  }
  interface HlsLike {
    latency: number;
    levels?: unknown;
    media?: unknown;
    attachMedia?: unknown;
    recoverMediaError?: unknown;
  }
  interface YouTubeVideoDetails {
    videoId?: unknown;
    isLive?: unknown;
    isLiveContent?: unknown;
  }
  interface YouTubePlayerResponse {
    videoDetails?: YouTubeVideoDetails | null;
    microformat?: {
      playerMicroformatRenderer?: {
        liveBroadcastDetails?: { isLiveNow?: unknown } | null;
      } | null;
    } | null;
  }
  interface YouTubePlayer extends HTMLElement {
    getVideoData?: () => {
      isLive?: unknown;
      video_id?: unknown;
      videoId?: unknown;
    } | null;
    getPlayerResponse?: () => YouTubePlayerResponse | null;
    getStatsForNerds?: () => Record<string, unknown> | null;
    getProgressState?: () => { seekableEnd?: number; current?: number } | null;
    getPlayerState?: () => number;
  }
  // Minimal React fiber shape for the upward walk to a player/Hls instance.
  interface Fiber {
    memoizedProps?: Record<string, unknown> | null;
    memoizedState?: Record<string, unknown> | null;
    stateNode?: { props?: Record<string, unknown> } | null;
    return?: Fiber | null;
  }

  // The fiber a React element carries under its `__reactFiber$…` (or legacy
  // `__reactInternalInstance$…`) key.
  function fiberOf(el: Element): Fiber | null {
    const rec = el as unknown as Record<string, unknown>;
    for (const k in rec) {
      if (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")) {
        return (rec[k] as Fiber) ?? null;
      }
    }
    return null;
  }

  // Live latency (seconds) from a Twitch player instance, exposed two ways across
  // versions: getLiveLatency() and the statistics object's hlsLatencyBroadcaster
  // (what the "Latency To Broadcaster" row reads).
  function twitchLatencyOf(pl: TwitchPlayer): number | null {
    try {
      if (typeof pl.getLiveLatency === "function") {
        const l = pl.getLiveLatency();
        if (typeof l === "number" && isFinite(l) && l > 0) return l;
      }
    } catch (e) {
      /* ignore */
    }
    try {
      if (typeof pl.getStatistics === "function") {
        const s = pl.getStatistics();
        const l =
          s && (s.hlsLatencyBroadcaster != null ? s.hlsLatencyBroadcaster : s.broadcasterLatency);
        if (typeof l === "number" && isFinite(l) && l > 0) return l;
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  // Walk the React fiber tree up from the video/player elements to find the
  // player instance (carried on a fiber's props as mediaPlayerInstance/player).
  function findTwitchPlayer(): TwitchPlayer | null {
    const roots = document.querySelectorAll('video, .video-player, [data-a-target="video-player"]');
    for (const el of roots) {
      let cur: Element | null = el;
      for (let depth = 0; depth < 30 && cur; depth++) {
        let f = fiberOf(cur);
        for (let i = 0; i < 60 && f; i++) {
          const p = f.memoizedProps || f.stateNode?.props;
          const inst = (p && (p.mediaPlayerInstance || p.player)) as TwitchPlayer | undefined;
          if (
            inst &&
            (typeof inst.getLiveLatency === "function" || typeof inst.getStatistics === "function")
          ) {
            return inst;
          }
          f = f.return ?? null;
        }
        cur = cur.parentElement;
      }
    }
    return null;
  }

  let twitchPlayer: TwitchPlayer | null = null;
  let nextTwitchScanAt = 0;
  let twitchScanDelay = 5000;
  const TWITCH_SCAN_INITIAL_MS = 5000;
  const TWITCH_SCAN_MAX_MS = 60000;
  function resetTwitchScanBackoff(): void {
    nextTwitchScanAt = 0;
    twitchScanDelay = TWITCH_SCAN_INITIAL_MS;
  }
  function twitchLatency(): number | null {
    if (!IS_TWITCH) return null;
    let lat = twitchPlayer ? twitchLatencyOf(twitchPlayer) : null;
    if (lat == null) {
      const now = Date.now();
      if (now < nextTwitchScanAt) return null;
      twitchPlayer = findTwitchPlayer();
      if (twitchPlayer) {
        resetTwitchScanBackoff();
        lat = twitchLatencyOf(twitchPlayer);
      } else {
        nextTwitchScanAt = now + twitchScanDelay;
        twitchScanDelay = Math.min(twitchScanDelay * 2, TWITCH_SCAN_MAX_MS);
      }
    }
    return lat;
  }

  // Generic hls.js fallback (Kick, w.tv and any other site that streams through
  // hls.js — VK Video Live uses DASH, so the buffered-ahead value covers it). An
  // Hls instance exposes a live `latency` getter — the
  // seconds behind the broadcast edge — and carries a `.media` element. The
  // instance isn't on the DOM, but like the Twitch player it's reachable by
  // walking the React fiber tree from the video/player. Best-effort: any failure
  // just leaves the attribute unset and the badge falls back to buffered-ahead.
  function isHls(o: unknown): o is HlsLike {
    if (!o || typeof o !== "object") return false;
    const h = o as HlsLike;
    return (
      typeof h.latency === "number" &&
      (h.media instanceof HTMLMediaElement ||
        typeof h.attachMedia === "function" ||
        typeof h.recoverMediaError === "function")
    );
  }
  function activeHls(hls: HlsLike | null): hls is HlsLike {
    if (!isHls(hls)) return false;
    return hls.media instanceof HTMLMediaElement && hls.media.isConnected;
  }
  function sharedHls(): HlsLike | null {
    for (const entry of win.__vtpQualityHls || []) {
      if (entry.hls.media instanceof HTMLVideoElement && entry.video !== entry.hls.media) {
        entry.video = entry.hls.media;
      }
      if (activeHls(entry.hls)) return entry.hls;
    }
    return null;
  }
  function readProp(o: object, key: string): unknown {
    try {
      return (o as Record<string, unknown>)[key];
    } catch (e) {
      return null;
    }
  }
  function findHlsInValue(
    value: unknown,
    seen: WeakSet<object>,
    depth: number,
    budget: { n: number },
  ): HlsLike | null {
    if (isHls(value) && activeHls(value)) return value;
    if (!value || typeof value !== "object" || depth <= 0 || budget.n <= 0) return null;
    if (value === window || value === document) return null;
    const obj = value as object;
    if (seen.has(obj)) return null;
    seen.add(obj);
    budget.n--;

    if (!(value instanceof Node)) {
      for (const key of [
        "hls",
        "hlsjs",
        "hlsInstance",
        "player",
        "mediaPlayer",
        "mediaPlayerInstance",
        "videoPlayer",
        "engine",
        "playback",
        "controller",
        "state",
        "props",
      ]) {
        const found = findHlsInValue(readProp(obj, key), seen, depth - 1, budget);
        if (found) return found;
      }
    }

    let keys: string[];
    try {
      keys = Object.keys(obj).slice(0, 80);
    } catch (e) {
      return null;
    }
    for (const key of keys) {
      const found = findHlsInValue(readProp(obj, key), seen, depth - 1, budget);
      if (found) return found;
    }
    return null;
  }
  function findHls(): HlsLike | null {
    const roots = Array.from(document.querySelectorAll("video"));
    for (const el of roots) {
      const fromNode = findHlsInValue(el, new WeakSet<object>(), 3, { n: 300 });
      if (fromNode) return fromNode;
      let cur: Element | null = el;
      for (let depth = 0; depth < 30 && cur; depth++) {
        const fromElementProps = findHlsInValue(cur, new WeakSet<object>(), 3, { n: 300 });
        if (fromElementProps) return fromElementProps;
        let f = fiberOf(cur);
        for (let i = 0; i < 60 && f; i++) {
          const p = f.memoizedProps || f.stateNode?.props;
          const fromProps = findHlsInValue(p, new WeakSet<object>(), 5, { n: 1200 });
          if (fromProps) return fromProps;
          const s = f.memoizedState;
          const fromState = findHlsInValue(s, new WeakSet<object>(), 5, { n: 1200 });
          if (fromState) return fromState;
          f = f.return ?? null;
        }
        cur = cur.parentElement;
      }
    }
    return null;
  }
  let hlsInst: HlsLike | null = null;
  let nextHlsScanAt = 0;
  let hlsScanDelay = 5000;
  const HLS_SCAN_INITIAL_MS = 5000;
  const HLS_SCAN_MAX_MS = 60000;
  function resetHlsScanBackoff(): void {
    nextHlsScanAt = 0;
    hlsScanDelay = HLS_SCAN_INITIAL_MS;
  }
  function ensureHls(): HlsLike | null {
    if (activeHls(hlsInst)) return hlsInst;
    hlsInst = null;
    const captured = sharedHls();
    if (captured) {
      resetHlsScanBackoff();
      hlsInst = captured;
      return hlsInst;
    }
    const now = Date.now();
    if (now < nextHlsScanAt) return null;
    hlsInst = findHls();
    if (hlsInst) {
      resetHlsScanBackoff();
    } else {
      nextHlsScanAt = now + hlsScanDelay;
      hlsScanDelay = Math.min(hlsScanDelay * 2, HLS_SCAN_MAX_MS);
    }
    return hlsInst;
  }
  function hlsLatency(): number | null {
    try {
      if (!activeHls(hlsInst)) hlsInst = ensureHls();
      const l = hlsInst ? hlsInst.latency : null;
      return typeof l === "number" && isFinite(l) && l > 0 ? l : null;
    } catch (e) {
      return null;
    }
  }

  function youtubePlayer(): YouTubePlayer | null {
    if (!IS_YOUTUBE) return null;
    // Both the watch player (#movie_player) and the Shorts player (#shorts-player)
    // carry .html5-video-player. After an SPA navigation the previous one lingers
    // in the DOM but hidden (clientWidth/Height 0) — and still reports its old
    // video's getVideoData().isLive. Read only a VISIBLE player so a stale live
    // watch player can't make Shorts (or an inline preview) look like a stream.
    const players = document.querySelectorAll<HTMLElement>(".html5-video-player");
    const locationHref =
      typeof location.href === "string"
        ? location.href
        : `https://${HOSTNAME}${location.pathname || "/"}${location.search || ""}`;
    const url = new URL(locationHref);
    const pathId = /^\/(?:shorts|live|embed)\/([^/?#]+)/.exec(url.pathname)?.[1];
    const currentId = url.searchParams.get("v") || pathId || null;
    let fallback: YouTubePlayer | null = null;
    for (const p of players) {
      if (p.clientWidth <= 0 || p.clientHeight <= 0) continue;
      const player = p as YouTubePlayer;
      if (!fallback || p.querySelector("video.html5-main-video")) fallback = player;
      if (!currentId || typeof player.getVideoData !== "function") continue;
      try {
        const data = player.getVideoData();
        if ((data?.video_id ?? data?.videoId) === currentId) return player;
      } catch (e) {
        /* use the visible main-player fallback */
      }
    }
    return fallback;
  }

  function youtubeResponseLive(
    yp: YouTubePlayer,
    videoData: ReturnType<NonNullable<YouTubePlayer["getVideoData"]>>,
  ): boolean | null {
    let response: YouTubePlayerResponse | null = null;
    let playerResponse = false;
    try {
      if (typeof yp.getPlayerResponse === "function") {
        response = yp.getPlayerResponse();
        playerResponse = !!response;
      }
    } catch (e) {
      /* fall through to the page's current initial response */
    }
    if (!response) response = win.ytInitialPlayerResponse || null;
    const details = response?.videoDetails;
    if (!details) return null;

    const playerId = videoData?.video_id ?? videoData?.videoId;
    const responseId = details.videoId;
    if (!playerResponse && (typeof playerId !== "string" || typeof responseId !== "string")) {
      return null;
    }
    if (typeof playerId === "string" && typeof responseId === "string" && playerId !== responseId) {
      return null;
    }
    const isLiveNow =
      response?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails?.isLiveNow;
    if (isLiveNow === true) return true;
    if (isLiveNow === false) return false;
    if (details.isLive === true || details.isLiveContent === true) return true;
    if (details.isLive === false || details.isLiveContent === false) return false;
    return null;
  }

  // The player's own live flag (getVideoData().isLive) — authoritative when
  // present, null when unknown. Published to LIVE_ATTR so the isolated script's
  // detection doesn't have to rely on CSS-class heuristics.
  // "false" needs care: before playback starts (and while an ad plays) isLive
  // is false even on a live stream — publishing "0" then would silence the
  // whole live UI. Only trust it once the player is actually on the content.
  function youtubeIsLive(): boolean | null {
    try {
      const yp = youtubePlayer();
      if (!yp || typeof yp.getVideoData !== "function") return null;
      if (yp.classList.contains("ad-showing") || yp.classList.contains("ad-interrupting"))
        return null;
      const vd = yp.getVideoData();
      const responseLive = youtubeResponseLive(yp, vd);
      if (vd?.isLive === true || responseLive === true) return true;
      if (vd?.isLive !== false && responseLive !== false) return null;
      const st = typeof yp.getPlayerState === "function" ? yp.getPlayerState() : null;
      return st === 1 || st === 2 || st === 3 ? false : null; // playing/paused/buffering
    } catch (e) {
      return null;
    }
  }

  // YouTube's #movie_player exposes "Live Latency" via getStatsForNerds(); a live
  // stream's distance behind the seekable edge is the same thing as a fallback
  // (guarded so it never fires on VODs).
  let statsLatRaw = ""; // last raw stats value, to spot a frozen readout
  let statsLatChangedAt = 0;
  function youtubeLatency(): number | null {
    try {
      const yp = youtubePlayer();
      if (!yp) return null;
      let statsLat: number | null = null;
      if (typeof yp.getStatsForNerds === "function") {
        const s = yp.getStatsForNerds() || {};
        // Several keys match /latency/ (live_latency, live_latency_style:
        // "display:none", live_latency_samples) in no guaranteed order — prefer
        // the exact key, then take the first one that parses to a number.
        const keys = [
          "live_latency",
          ...Object.keys(s).filter((k) => k !== "live_latency" && /latency/i.test(k)),
        ];
        for (const k of keys) {
          const raw = s[k] == null ? "" : String(s[k]);
          const n = parseFloat(raw.replace(",", "."));
          if (!(isFinite(n) && n > 0)) continue;
          if (raw !== statsLatRaw) {
            statsLatRaw = raw;
            statsLatChangedAt = Date.now();
          }
          statsLat = n;
          break;
        }
      }
      // YouTube stops refreshing stats-for-nerds while the player UI is idle (no
      // mouse movement), freezing the readout. A value stuck for a few seconds is
      // stale — fall through to the progress-state distance behind the live edge.
      if (statsLat != null && Date.now() - statsLatChangedAt < 3000) return statsLat;
      if (youtubeIsLive() && typeof yp.getProgressState === "function") {
        const p = yp.getProgressState() || {};
        const d = (p.seekableEnd ?? NaN) - (p.current ?? NaN);
        if (isFinite(d) && d > 0) return d;
      }
      return statsLat; // a stale reading still beats nothing
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  let timer: number | null = null;
  function tick() {
    if (!isActiveBridge()) {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
      return;
    }
    try {
      const tw = twitchLatency();
      const yt = tw == null ? youtubeLatency() : null;
      const live = youtubeIsLive();
      const lat = tw != null ? tw : (yt ?? (IS_YOUTUBE ? null : hlsLatency()));
      const root = document.documentElement;
      if (!root) return;
      setAttrIfChanged(root, ATTR, lat != null ? (Math.round(lat * 10) / 10).toFixed(1) : null);
      setAttrIfChanged(root, LIVE_ATTR, live == null ? null : live ? "1" : "0");
    } catch (e) {
      /* ignore */
    }
  }
  timer = window.setInterval(tick, 1000);
  win.__vtpLatencyBridgeCleanup = () => {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
    if (win.__vtpLatencyBridgeInstalled === BRIDGE_VERSION) {
      win.__vtpLatencyBridgeInstalled = undefined;
    }
  };
  tick();
})();
