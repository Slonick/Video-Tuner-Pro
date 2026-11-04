// MAIN-world audio-rate bridge. Some players (SoundCloud, and other MSE/blob
// audio) play through an HTMLAudioElement built with `new Audio()` that is never
// inserted into the DOM (isConnected === false, parentNode === null). The
// isolated content script finds media only via the document — querySelectorAll
// and the MutationObserver both miss detached elements — so it never reaches
// these, and the "speed up audio" toggle does nothing on those sites.
//
// This tiny script runs in the page world, where it CAN see the page's own
// detached elements: it intercepts HTMLMediaElement.prototype.play (the moment a
// detached <audio> actually starts) and applies the desired rate directly. The
// rate is bridged from the isolated script through a DOM attribute on <html>
// (data-vtp-audiorate) — the same cross-world pattern as data-vtp-latency — which
// is present only while the toggle is on; its removal means "hand the elements
// back at 1×".
//
// Only DETACHED <audio> is touched here. Connected media stays owned by the
// isolated script (speed.ts), so the two worlds never both drive the same element.
// Everything is wrapped defensively (try/catch, no-op on failure), matching
// inject.ts: a broken hook must never break the page's own audio.
const RATE_ATTR = "data-vtp-audiorate";
const BRIDGE_VERSION = "2026-11-04-bounded-tracking";
type AudioBridgeWindow = typeof window & {
  __vtpAudioBridgeInstalled?: boolean | string;
  __vtpAudioBridgeCleanup?: () => void;
};

function isActiveBridge(): boolean {
  return (window as AudioBridgeWindow).__vtpAudioBridgeInstalled === BRIDGE_VERSION;
}

// The desired rate published by the isolated script, or null when the toggle is
// off (attribute absent / unparseable).
export function desiredRate(): number | null {
  try {
    const v = document.documentElement?.getAttribute(RATE_ATTR);
    if (v == null) return null;
    const n = parseFloat(v);
    return isFinite(n) && n > 0 ? n : null;
  } catch (e) {
    return null;
  }
}

// Mirror of setMediaRate (speed.ts): keep pitch natural, seed defaultPlaybackRate
// so a freshly-loaded source starts at the right rate, and only write when the
// value actually differs — a redundant write restarts the time-stretcher and
// glitches the sound.
export function applyRate(media: HTMLMediaElement, rate: number): void {
  try {
    if (media.preservesPitch === false) media.preservesPitch = true;
    if (Math.abs(media.defaultPlaybackRate - rate) > 0.001) media.defaultPlaybackRate = rate;
    if (Math.abs(media.playbackRate - rate) > 0.001) media.playbackRate = rate;
  } catch (e) {
    /* some elements reject rate before metadata is ready */
  }
}

// The detached <audio> elements that are playing. Kept so a speed change made while
// a track is already playing can re-apply to them (refreshTracked, driven by the
// attribute observer). An element leaves the set as soon as it stops: the browser
// keeps a playing element alive anyway, so the set never pins audio the page dropped.
const tracked = new Set<HTMLAudioElement>();
const trackedCleanup = new WeakMap<HTMLAudioElement, () => void>();
// How a page stops a track: pauses it, lets it finish, or swaps/clears its source.
const STOP_EVENTS = ["pause", "ended", "emptied", "abort"];

// Capture a detached <audio> as it starts playing and bring it to the current
// rate. Connected media is left to the isolated script so neither world fights the
// other over the same element. Listeners re-assert across the source's own
// lifecycle (same events as applyToAudio in speed.ts).
export function captureOnPlay(media: unknown): void {
  if (!isActiveBridge()) return;
  if (!(media instanceof HTMLAudioElement)) return;
  if (media.isConnected) return; // the isolated script owns connected media
  if (!tracked.has(media)) {
    tracked.add(media);
    const reapply = () => {
      if (!isActiveBridge()) return;
      if (media.isConnected) return;
      const r = desiredRate();
      if (r != null) applyRate(media, r);
    };
    media.addEventListener("play", reapply);
    media.addEventListener("loadeddata", reapply);
    media.addEventListener("ratechange", reapply);
    const release = () => {
      media.removeEventListener("play", reapply);
      media.removeEventListener("loadeddata", reapply);
      media.removeEventListener("ratechange", reapply);
      for (const type of STOP_EVENTS) media.removeEventListener(type, stop);
      media.removeEventListener("error", release);
      tracked.delete(media);
      trackedCleanup.delete(media);
    };
    // A source swap or a pause→play restart queues these behind the page's next
    // play() — an element that is playing again stays tracked.
    const stop = () => {
      if (media.paused) release();
    };
    for (const type of STOP_EVENTS) media.addEventListener(type, stop);
    media.addEventListener("error", release);
    trackedCleanup.set(media, release);
  }
  const rate = desiredRate();
  if (rate != null) applyRate(media, rate);
}

// React to the bridged rate changing (toggle flip, or a speed change mid-track):
// re-apply to every tracked element, resetting to 1× when the toggle goes off
// (attribute removed → desiredRate() null). Detached-only, mirroring capture.
export function refreshTracked(): void {
  if (!isActiveBridge()) return;
  const rate = desiredRate();
  for (const media of tracked) {
    if (media.isConnected) {
      trackedCleanup.get(media)?.();
      continue;
    }
    applyRate(media, rate == null ? 1 : rate);
  }
}

// Patch HTMLMediaElement.prototype.play to capture detached <audio> at play time,
// and watch the bridge attribute for mid-playback rate changes. play() is only
// ever called on real media, so this is not a hot path (unlike hooking
// createElement). The capture runs before the native call and never affects its
// result.
export function install(): void {
  const win = window as AudioBridgeWindow;
  if (win.__vtpAudioBridgeInstalled === BRIDGE_VERSION) return;
  try {
    win.__vtpAudioBridgeCleanup?.();
  } catch (e) {
    /* stale bridge cleanup must not block the new bridge */
  }
  win.__vtpAudioBridgeInstalled = BRIDGE_VERSION;
  const cleanup: Array<() => void> = [];
  try {
    const proto = HTMLMediaElement.prototype;
    // Wrap whatever play() is current: after an update, a page wrapper installed over
    // the previous bridge must stay in the chain (its cleanup restores only its own hook).
    const nativePlay = proto.play;
    const hookedPlay = function (this: HTMLMediaElement, ...args: unknown[]): Promise<void> {
      try {
        captureOnPlay(this);
      } catch (e) {
        /* never let our hook break the page's own playback */
      }
      const result = nativePlay.apply(this, args as []);
      // A play() refused up front (autoplay policy, unsupported source) leaves the
      // element paused and fires none of the events that would release it.
      if (this.paused) trackedCleanup.get(this as HTMLAudioElement)?.();
      return result;
    };
    proto.play = hookedPlay;
    cleanup.push(() => {
      if (proto.play === hookedPlay) proto.play = nativePlay;
    });
  } catch (e) {
    /* prototype is frozen / unavailable — give up silently */
  }

  try {
    const observe = () => {
      const root = document.documentElement;
      if (!root) return;
      const observer = new MutationObserver(refreshTracked);
      observer.observe(root, {
        attributes: true,
        attributeFilter: [RATE_ATTR],
      });
      cleanup.push(() => observer.disconnect());
    };
    if (document.documentElement) observe();
    else {
      document.addEventListener("DOMContentLoaded", observe);
      cleanup.push(() => document.removeEventListener("DOMContentLoaded", observe));
    }
  } catch (e) {
    /* ignore */
  }
  win.__vtpAudioBridgeCleanup = () => {
    for (const fn of cleanup.splice(0)) fn();
    for (const media of Array.from(tracked)) {
      trackedCleanup.get(media)?.();
    }
    if (win.__vtpAudioBridgeInstalled === BRIDGE_VERSION) {
      win.__vtpAudioBridgeInstalled = undefined;
    }
  };
}

install();
