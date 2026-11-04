// Routing a cross-origin element without CORS through Web Audio silences it, so
// this owns the AudioContext and gates which media elements are safe to capture.
import { alog } from "../platform/log.js";
import { translationActive } from "./translation.js";
import { applyAudioComp } from "./compressor.js";
import type { AudioGraph } from "./types.js";
import { contentSignal, listenerOptions } from "../lifecycle.js";

let audioCtx: AudioContext | null = null;
export const audioGraphs = new WeakMap<HTMLVideoElement, AudioGraph>();
let audioGraphCount = 0;
const audioSkipped = new WeakSet<HTMLVideoElement>(); // videos we must not route (CORS-risk / already wired)
const audioSkipReasons = new WeakMap<HTMLVideoElement, string>();
let audioGestureHooked = false;
let lastAudioSkip: string | null = null; // why the most recent setupGraph() bailed
let lastNotRoutableLog: string | null = null; // throttles the "not routable yet" diagnostic log
// Weak handles to every graph built — audioGraphs can't be enumerated at teardown.
const builtGraphs = new Set<WeakRef<AudioGraph>>();

// On shutdown (extension update/reload) the orphaned instance can no longer adjust
// its graphs, and the new one can't capture those elements again (capturing is
// one-way). Wire each source straight to the output so the page sounds as if we were
// never there, rather than through a compressor frozen at its old settings.
contentSignal.addEventListener("abort", () => {
  for (const ref of builtGraphs) {
    const g = ref.deref();
    if (!g) continue;
    try {
      g.source.disconnect();
      g.source.connect(g.source.context.destination);
    } catch (e) {
      /* context closed */
    }
  }
});

export function audioContext(): AudioContext | null {
  return audioCtx;
}
export function hasAudioGraphs(): boolean {
  return audioGraphCount > 0;
}
export function lastSkip(video?: HTMLVideoElement | null): string | null {
  return video ? (audioSkipReasons.get(video) ?? null) : lastAudioSkip;
}

function rememberSkip(video: HTMLVideoElement, reason: string): void {
  audioSkipReasons.set(video, reason);
  lastAudioSkip = reason;
}

// Only reached when canRouteAudio() said no, so outside VOT there is no srcObject and
// no blob:/data: source — what's left is an unresolved/loading URL or a cross-origin one.
function rememberUnroutable(video: HTMLVideoElement): void {
  rememberSkip(
    video,
    translationActive() ? "vot" : !video.currentSrc || !sourceReady(video) ? "loading" : "cors",
  );
  const src = video.currentSrc || video.src;
  const sig = src + "|" + !!video.srcObject;
  if (sig !== lastNotRoutableLog) {
    lastNotRoutableLog = sig;
    alog("audio: not routable yet —", { currentSrc: src, hasSrcObject: !!video.srcObject });
  }
}

// Web Audio SILENCES cross-origin-without-CORS media and createMediaElementSource()
// cannot be undone for the element. Only route sources that stay safe across
// redirects/source swaps: MediaStream, MSE/blob, data:, or explicit CORS opt-in.
function canRouteAudio(video: HTMLVideoElement): boolean {
  if (translationActive()) return false; // don't grab a new source mid-translation
  if (video.srcObject) return true;
  const src = video.currentSrc;
  const rawSrc = video.src;
  if (src.startsWith("blob:") || src.startsWith("data:")) return true;
  if (!src) {
    if (rawSrc.startsWith("blob:") || rawSrc.startsWith("data:")) return true;
    return false;
  }
  if (!sourceReady(video)) return false;
  return !!video.crossOrigin; // cross-origin only if the site set crossorigin=...
}

function sourceReady(video: HTMLVideoElement): boolean {
  return typeof video.readyState !== "number" || video.readyState >= 1;
}

export function graphForCurrentSource(video: HTMLVideoElement): AudioGraph | null {
  const g = audioGraphs.get(video) ?? null;
  if (!g) return null;
  if (canRouteAudio(video)) {
    audioSkipReasons.delete(video);
    lastAudioSkip = null;
    return g;
  }
  rememberUnroutable(video);
  return null;
}

export function resumeAudioCtx(): void {
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
}

export function hookAudioGesture(): void {
  if (audioGestureHooked) return;
  audioGestureHooked = true;
  document.addEventListener("click", resumeAudioCtx, listenerOptions(true));
  document.addEventListener("keydown", resumeAudioCtx, listenerOptions(true));
}

function ensureAudioCtx(): AudioContext | null {
  if (audioCtx) return audioCtx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = AC ? new AC() : null;
  } catch (e) {
    /* blocked by the browser or page policy */
  }
  const ctx = audioCtx;
  if (ctx) {
    hookAudioGesture();
    // A fresh context starts "suspended" until a user gesture. When it resumes,
    // (re)build the graphs we deferred while it was suspended.
    ctx.addEventListener(
      "statechange",
      () => {
        alog("AudioContext state:", ctx.state);
        if (ctx.state === "running") applyAudioComp();
      },
      listenerOptions(),
    );
  }
  return audioCtx;
}

export function setupGraph(video: HTMLVideoElement): AudioGraph | null {
  if (audioGraphs.has(video)) return graphForCurrentSource(video);
  if (audioSkipped.has(video)) {
    rememberSkip(video, "inuse");
    return null;
  }
  // NOT routable yet: do NOT ban the element. Its src may still be loading or the
  // player may have just swapped the <video> (common on Twitch). Retry next tick.
  if (!canRouteAudio(video)) {
    // Split the "not routable" cases: VOT and a still-loading src are transient (the
    // popup shouldn't warn), but a genuine cross-origin source is a hard block.
    rememberUnroutable(video);
    return null;
  }
  const ctx = ensureAudioCtx();
  if (!ctx) {
    rememberSkip(video, "noctx");
    return null;
  }
  // Capturing into a suspended context silences the element until it resumes.
  if (ctx.state !== "running") {
    rememberSkip(video, "suspended");
    resumeAudioCtx();
    return null;
  }
  let source: MediaElementAudioSourceNode;
  try {
    source = ctx.createMediaElementSource(video);
  } catch (e) {
    // Element already feeds another Web Audio graph — only one capture allowed.
    rememberSkip(video, "inuse");
    audioSkipped.add(video);
    alog("audio: skipped (element already captured by another extension/player)");
    return null;
  }
  const comp = ctx.createDynamicsCompressor();
  const gain = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.08;
  source.connect(comp);
  comp.connect(gain);
  gain.connect(limiter);
  limiter.connect(ctx.destination);
  // We meter only the INPUT level; the output is derived as input + the
  // compressor's exact gain reduction (comp.reduction) + make-up gain, which keeps
  // the before/after difference exact and avoids two-analyser latency.
  const analyserIn = ctx.createAnalyser();
  analyserIn.fftSize = 1024;
  source.connect(analyserIn);
  const g: AudioGraph = { source, comp, gain, limiter, analyserIn };
  audioGraphs.set(video, g);
  audioGraphCount += 1;
  for (const ref of builtGraphs) if (!ref.deref()) builtGraphs.delete(ref);
  builtGraphs.add(new WeakRef(g));
  audioSkipReasons.delete(video);
  lastAudioSkip = null;
  // Routed audio goes silent if the context is suspended, so resume on play.
  video.addEventListener("playing", resumeAudioCtx, listenerOptions());
  alog("audio: compression graph engaged on a video");
  return g;
}
