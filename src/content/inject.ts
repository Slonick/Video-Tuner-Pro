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

  // YouTube's #movie_player exposes "Live Latency" via getStatsForNerds(); a live
  // stream's distance behind the seekable edge is the same thing as a fallback
  // (guarded so it never fires on VODs).
  function youtubeLatency(): number | null {
    try {
      // YouTube's #movie_player API is private and untyped — `any` is unavoidable.
      const yp: any = document.getElementById("movie_player") || document.querySelector(".html5-video-player");
      if (!yp) return null;
      if (typeof yp.getStatsForNerds === "function") {
        const s = yp.getStatsForNerds() || {};
        for (const k in s) {
          if (/latency/i.test(k)) {
            const n = parseFloat(String(s[k]).replace(",", "."));
            if (isFinite(n) && n > 0) return n;
          }
        }
      }
      const vd = typeof yp.getVideoData === "function" ? yp.getVideoData() : null;
      const live = vd && (vd.isLive || vd.isLiveContent || vd.livestream);
      if (live && typeof yp.getProgressState === "function") {
        const p = yp.getProgressState() || {};
        const d = p.seekableEnd - p.current;
        if (isFinite(d) && d > 0) return d;
      }
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
    } catch (e) { /* ignore */ }
  }

  setInterval(tick, 1000);
  tick();
})();
