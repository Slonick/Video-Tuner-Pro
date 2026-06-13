// MAIN-world probe (Twitch + YouTube). The isolated content script can't reach
// the page's JS objects, so this tiny script runs in the page world, reads the
// player's "latency to broadcaster"/"live latency" (the value the site's own
// stats overlay shows), and publishes it to a DOM attribute — which IS visible
// across worlds. The isolated script reads `data-vtp-latency` (live.js
// streamLatency).
//
// Everything is wrapped defensively: these internals are private and may change,
// so any failure just leaves the attribute unset and the badge falls back to the
// buffered-ahead value.
(function () {
  "use strict";
  const ATTR = "data-vtp-latency";
  const LIVE_ATTR = "data-vtp-live";

  // Live latency (seconds) from a Twitch player instance, exposed two ways across
  // versions: getLiveLatency() and the statistics object's hlsLatencyBroadcaster
  // (what the "Latency To Broadcaster" row reads). Player internals are private
  // and untyped — `any` is unavoidable here.
  function twitchLatencyOf(pl: any): number | null {
    try {
      if (typeof pl.getLiveLatency === "function") {
        const l = pl.getLiveLatency();
        if (typeof l === "number" && isFinite(l) && l > 0) return l;
      }
    } catch (e) { /* ignore */ }
    try {
      if (typeof pl.getStatistics === "function") {
        const s = pl.getStatistics();
        const l = s && (s.hlsLatencyBroadcaster != null ? s.hlsLatencyBroadcaster : s.broadcasterLatency);
        if (typeof l === "number" && isFinite(l) && l > 0) return l;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // Walk the React fiber tree up from the video/player elements to find the
  // player instance (carried on a fiber's props as mediaPlayerInstance/player).
  function findTwitchPlayer(): any {
    const roots = document.querySelectorAll('video, .video-player, [data-a-target="video-player"]');
    for (const el of roots) {
      let cur: any = el;
      for (let depth = 0; depth < 30 && cur; depth++) {
        for (const k in cur) {
          if (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")) {
            let f: any = cur[k];
            for (let i = 0; i < 60 && f; i++) {
              const p = f.memoizedProps || (f.stateNode && f.stateNode.props);
              const inst = p && (p.mediaPlayerInstance || p.player);
              if (inst && (typeof inst.getLiveLatency === "function" || typeof inst.getStatistics === "function")) {
                return inst;
              }
              f = f.return;
            }
          }
        }
        cur = cur.parentElement;
      }
    }
    return null;
  }

  let twitchPlayer: any = null;
  function twitchLatency(): number | null {
    let lat = twitchPlayer ? twitchLatencyOf(twitchPlayer) : null;
    if (lat == null) { twitchPlayer = findTwitchPlayer(); lat = twitchPlayer ? twitchLatencyOf(twitchPlayer) : null; }
    return lat;
  }

  function youtubePlayer(): any {
    return document.getElementById("movie_player") || document.querySelector(".html5-video-player");
  }

  // The player's own live flag (getVideoData().isLive) — authoritative when
  // present, null when unknown. Published to LIVE_ATTR so the isolated script's
  // detection doesn't have to rely on CSS-class heuristics.
  // "false" needs care: before playback starts (and while an ad plays) isLive
  // is false even on a live stream — publishing "0" then would silence the
  // whole live UI. Only trust it once the player is actually on the content.
  function youtubeIsLive(): boolean | null {
    try {
      const yp: any = youtubePlayer();
      if (!yp || typeof yp.getVideoData !== "function") return null;
      if (yp.classList && (yp.classList.contains("ad-showing") || yp.classList.contains("ad-interrupting"))) return null;
      const vd = yp.getVideoData();
      if (!vd || typeof vd.isLive !== "boolean") return null;
      if (vd.isLive) return true;
      const st = typeof yp.getPlayerState === "function" ? yp.getPlayerState() : null;
      return (st === 1 || st === 2 || st === 3) ? false : null; // playing/paused/buffering
    } catch (e) { return null; }
  }

  // YouTube's #movie_player exposes "Live Latency" via getStatsForNerds(); a live
  // stream's distance behind the seekable edge is the same thing as a fallback
  // (guarded so it never fires on VODs).
  let statsLatRaw = "";       // last raw stats value, to spot a frozen readout
  let statsLatChangedAt = 0;
  function youtubeLatency(): number | null {
    try {
      // YouTube's #movie_player API is private and untyped — `any` is unavoidable.
      const yp: any = youtubePlayer();
      if (!yp) return null;
      let statsLat: number | null = null;
      if (typeof yp.getStatsForNerds === "function") {
        const s = yp.getStatsForNerds() || {};
        // Several keys match /latency/ (live_latency, live_latency_style:
        // "display:none", live_latency_samples) in no guaranteed order — prefer
        // the exact key, then take the first one that parses to a number.
        const keys = ["live_latency", ...Object.keys(s).filter((k) => k !== "live_latency" && /latency/i.test(k))];
        for (const k of keys) {
          const raw = s[k] == null ? "" : String(s[k]);
          const n = parseFloat(raw.replace(",", "."));
          if (!(isFinite(n) && n > 0)) continue;
          if (raw !== statsLatRaw) { statsLatRaw = raw; statsLatChangedAt = Date.now(); }
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
        const d = p.seekableEnd - p.current;
        if (isFinite(d) && d > 0) return d;
      }
      return statsLat; // a stale reading still beats nothing
    } catch (e) { /* ignore */ }
    return null;
  }

  function tick() {
    try {
      const tw = twitchLatency();
      const lat = tw != null ? tw : youtubeLatency();
      const root = document.documentElement;
      if (!root) return;
      if (lat != null) root.setAttribute(ATTR, lat.toFixed(2));
      else if (root.hasAttribute(ATTR)) root.removeAttribute(ATTR);
      const live = youtubeIsLive();
      if (live != null) root.setAttribute(LIVE_ATTR, live ? "1" : "0");
      else if (root.hasAttribute(LIVE_ATTR)) root.removeAttribute(LIVE_ATTR);
    } catch (e) { /* ignore */ }
  }

  setInterval(tick, 1000);
  tick();
})();
