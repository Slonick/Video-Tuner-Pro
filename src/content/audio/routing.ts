// Routing a cross-origin element without CORS through Web Audio silences it, so
// this owns the AudioContext and gates which media elements are safe to capture.
import { alog } from "../platform/log.js";
import { translationActive } from "./translation.js";
import { applyAudioComp } from "./compressor.js";
import type { AudioGraph } from "./types.js";

let audioCtx: AudioContext | null = null;
export const audioGraphs = new WeakMap<HTMLVideoElement, AudioGraph>();
const audioSkipped = new WeakSet<HTMLVideoElement>(); // videos we must not route (CORS-risk / already wired)
let audioGestureHooked = false;
let lastAudioSkip: string | null = null; // why the most recent setupGraph() bailed
let lastNotRoutableLog: string | null = null; // throttles the "not routable yet" diagnostic log

export function audioContext(): AudioContext | null {
  return audioCtx;
}
export function lastSkip(): string | null {
  return lastAudioSkip;
}

// Web Audio SILENCES cross-origin-without-CORS media, so only route safe sources:
// MediaStream (srcObject), MSE/blob, data:, same-origin, or crossorigin-opted-in.
function canRouteAudio(video: HTMLVideoElement): boolean {
  if (translationActive()) return false; // don't grab a new source mid-translation
  if (video.srcObject) return true;
  const src = video.currentSrc || video.src || "";
  if (!src) return false;
  if (src.startsWith("blob:") || src.startsWith("data:")) return true;
  try {
    if (new URL(src, location.href).origin === location.origin) return true;
  } catch (e) {
    return false;
  }
  return !!video.crossOrigin; // cross-origin only if the site set crossorigin=...
}

export function resumeAudioCtx(): void {
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
}

export function hookAudioGesture(): void {
  if (audioGestureHooked) return;
  audioGestureHooked = true;
  const resume = () => {
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  };
  document.addEventListener("click", resume, { capture: true, passive: true });
  document.addEventListener("keydown", resume, { capture: true, passive: true });
}

function ensureAudioCtx(): AudioContext | null {
  if (audioCtx) return audioCtx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = AC ? new AC() : null;
  } catch (e) {
    audioCtx = null;
  }
  const ctx = audioCtx;
  if (ctx) {
    hookAudioGesture();
    // A fresh context starts "suspended" until a user gesture. When it resumes,
    // (re)build the graphs we deferred while it was suspended.
    ctx.addEventListener("statechange", () => {
      alog("AudioContext state:", ctx.state);
      if (ctx.state === "running") applyAudioComp();
    });
    resumeAudioCtx();
  }
  return audioCtx;
}

export function setupGraph(video: HTMLVideoElement): AudioGraph | null {
  if (audioGraphs.has(video)) return audioGraphs.get(video) ?? null;
  if (audioSkipped.has(video)) {
    lastAudioSkip = "inuse";
    return null;
  }
  // NOT routable yet: do NOT ban the element. Its src may still be loading or the
  // player may have just swapped the <video> (common on Twitch). Retry next tick.
  if (!canRouteAudio(video)) {
    lastAudioSkip = "cors";
    const sig = (video.currentSrc || video.src || "") + "|" + !!video.srcObject;
    if (sig !== lastNotRoutableLog) {
      lastNotRoutableLog = sig;
      alog("audio: not routable yet —", {
        currentSrc: video.currentSrc || video.src || "",
        hasSrcObject: !!video.srcObject,
      });
    }
    return null;
  }
  const ctx = ensureAudioCtx();
  if (!ctx) {
    lastAudioSkip = "noctx";
    return null;
  }
  // Capturing into a suspended context silences the element until it resumes.
  if (ctx.state !== "running") {
    lastAudioSkip = "suspended";
    resumeAudioCtx();
    return null;
  }
  let source: MediaElementAudioSourceNode;
  try {
    source = ctx.createMediaElementSource(video);
  } catch (e) {
    // Element already feeds another Web Audio graph — only one capture allowed.
    lastAudioSkip = "inuse";
    audioSkipped.add(video);
    alog("audio: skipped (element already captured by another extension/player)");
    return null;
  }
  const comp = ctx.createDynamicsCompressor();
  const gain = ctx.createGain();
  source.connect(comp);
  comp.connect(gain);
  gain.connect(ctx.destination);
  // We meter only the INPUT level; the output is derived as input + the
  // compressor's exact gain reduction (comp.reduction) + make-up gain, which keeps
  // the before/after difference exact and avoids two-analyser latency.
  const analyserIn = ctx.createAnalyser();
  analyserIn.fftSize = 1024;
  analyserIn.smoothingTimeConstant = 0.5;
  source.connect(analyserIn);
  const g: AudioGraph = { source, comp, gain, analyserIn };
  audioGraphs.set(video, g);
  // Routed audio goes silent if the context is suspended, so resume on play.
  video.addEventListener("playing", resumeAudioCtx, { passive: true });
  alog("audio: compression graph engaged on a video");
  return g;
}
