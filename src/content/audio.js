// Audio compression (Web Audio): route each safe media element through a
// DynamicsCompressorNode + make-up GainNode, expose before/after levels for the
// popup meters, and keep a small level history so a re-opened popup pre-fills.
import { alog, i18n, ctxValid } from "./env.js";
import { S } from "./state.js";
import { collectVideos, primaryVideo } from "./videos.js";
import { showIndicator } from "./badge.js";

// Recent {in,out} dB samples kept while a graph exists (≈7s at 150ms).
export const audioLevelHist = [];
export const A_HIST_MS = 150;
const A_HIST_MAX = 48;

let audioCtx = null;
const audioGraphs = new WeakMap(); // video -> { source, comp, gain, analyserIn }
const audioSkipped = new WeakSet(); // videos we must not route (CORS-risk / already wired)
let audioGestureHooked = false;
let lastAudioSkip = null;          // why the most recent setupGraph() bailed
let lastNotRoutableLog = null;     // throttles the "not routable yet" diagnostic log

// Routing a media element through Web Audio SILENCES it if the underlying media
// is cross-origin without CORS. Only route media that's safe: a MediaStream
// (srcObject), MSE/blob, data:, same-origin, or an element that opted into CORS.
function canRouteAudio(video) {
  if (video.srcObject) return true;                 // MediaStream (Twitch) — local, routable
  const src = video.currentSrc || video.src || "";
  if (!src) return false;
  if (src.startsWith("blob:") || src.startsWith("data:")) return true; // MSE / inline
  try {
    if (new URL(src, location.href).origin === location.origin) return true; // same-origin
  } catch (e) { return false; }
  return !!video.crossOrigin; // cross-origin only if the site set crossorigin=...
}

function resumeAudioCtx() {
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
}

function ensureAudioCtx() {
  if (audioCtx) return audioCtx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = AC ? new AC() : null;
  } catch (e) { audioCtx = null; }
  if (audioCtx) {
    hookAudioGesture();
    // A fresh context starts "suspended" until a user gesture. When it resumes,
    // (re)build the graphs we deferred while it was suspended.
    audioCtx.addEventListener("statechange", () => {
      alog("AudioContext state:", audioCtx.state);
      if (audioCtx.state === "running") applyAudioComp();
    });
    resumeAudioCtx();
  }
  return audioCtx;
}

function setupGraph(video) {
  if (audioGraphs.has(video)) return audioGraphs.get(video);
  if (audioSkipped.has(video)) { lastAudioSkip = "inuse"; return null; }
  // NOT routable yet: do NOT ban the element. Its src may still be loading or the
  // player may have just swapped the <video> (common on Twitch). Retry next tick.
  if (!canRouteAudio(video)) {
    lastAudioSkip = "cors";
    const sig = (video.currentSrc || video.src || "") + "|" + !!video.srcObject;
    if (sig !== lastNotRoutableLog) {
      lastNotRoutableLog = sig;
      alog("audio: not routable yet —", { currentSrc: video.currentSrc || video.src || "", hasSrcObject: !!video.srcObject });
    }
    return null;
  }
  const ctx = ensureAudioCtx();
  if (!ctx) { lastAudioSkip = "noctx"; return null; }
  // Capturing into a suspended context silences the element until it resumes.
  if (ctx.state !== "running") { lastAudioSkip = "suspended"; resumeAudioCtx(); return null; }
  let source;
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
  const g = { source, comp, gain, analyserIn };
  audioGraphs.set(video, g);
  // Routed audio goes silent if the context is suspended, so resume on play.
  video.addEventListener("playing", resumeAudioCtx, { passive: true });
  alog("audio: compression graph engaged on a video");
  return g;
}

// Ramp an AudioParam toward a value instead of assigning .value directly (an
// abrupt jump produces an audible click).
function rampParam(param, value) {
  try {
    const t = audioCtx ? audioCtx.currentTime : 0;
    param.cancelScheduledValues(t);
    param.setTargetAtTime(value, t, 0.02);
  } catch (e) {
    try { param.value = value; } catch (_) {}
  }
}

// Off = transparent graph (ratio 1:1, unity gain) rather than disconnecting.
// Skipped when nothing changed, so we don't re-poke params every tick (clicks).
function applyGraphParams(g) {
  const on = S.audioCompEnabled;
  const key = on
    ? `${S.audioCompThreshold}|${S.audioCompKnee}|${S.audioCompRatio}|${S.audioCompAttack}|${S.audioCompRelease}|${S.audioCompGain}`
    : "off";
  if (g._key === key) return;
  g._key = key;
  try {
    rampParam(g.comp.threshold, on ? S.audioCompThreshold : 0);
    rampParam(g.comp.knee, on ? S.audioCompKnee : 0);
    rampParam(g.comp.ratio, on ? S.audioCompRatio : 1);
    rampParam(g.comp.attack, on ? S.audioCompAttack : 0.003);
    rampParam(g.comp.release, on ? S.audioCompRelease : 0.25);
    rampParam(g.gain.gain, on ? Math.pow(10, S.audioCompGain / 20) : 1);
  } catch (e) { /* node detached */ }
}

function hookAudioGesture() {
  if (audioGestureHooked) return;
  audioGestureHooked = true;
  const resume = () => { if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {}); };
  document.addEventListener("click", resume, { capture: true, passive: true });
  document.addEventListener("keydown", resume, { capture: true, passive: true });
}

export function applyAudioComp(videos) {
  const list = videos || collectVideos();
  const primary = primaryVideo();
  let engaged = 0, skipped = 0, reason = null;
  for (const v of list) {
    let g = audioGraphs.get(v);
    if (!g) {
      // Compression on → route every video. Off → still route the PRIMARY video
      // so the meter/graph always work (it runs transparent, output == input).
      if (!S.audioCompEnabled && v !== primary) continue;
      g = setupGraph(v);
      if (!g) {
        skipped++;
        if (lastAudioSkip === "inuse") reason = "inuse";
        else if (!reason) reason = lastAudioSkip;
        continue;
      }
    }
    applyGraphParams(g);
    engaged++;
  }
  // Always allow the context to resume on a user gesture, so metering works even
  // with compression off.
  if (primary) { hookAudioGesture(); resumeAudioCtx(); }
  return { engaged, skipped, reason };
}

// RMS level (in dBFS, -100…0) of an analyser's current frame.
function analyserDb(an) {
  if (!an._buf) an._buf = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(an._buf);
  let sum = 0;
  for (let i = 0; i < an._buf.length; i++) sum += an._buf[i] * an._buf[i];
  const rms = Math.sqrt(sum / an._buf.length);
  return rms > 0.0000158 ? 20 * Math.log10(rms) : -100; // floor ~ -96 dB
}

// Output level derived from input + the compressor's exact gain reduction (≤0 dB)
// + make-up gain. Off → reduction 0 and no make-up, so output == input exactly.
function audioOutDb(g, inDb) {
  if (inDb <= -100) return inDb; // silence floor — amplifying nothing is still nothing
  const reduction = (g.comp && typeof g.comp.reduction === "number") ? g.comp.reduction : 0;
  return inDb + reduction + (S.audioCompEnabled ? S.audioCompGain : 0);
}

// Before/after levels of the primary video's compressor, for the popup meters.
export function audioLevels() {
  const v = primaryVideo();
  const g = v && audioGraphs.get(v);
  // Report levels whenever the graph exists — even with compression off (it runs
  // transparent), so the meter and threshold preview stay live.
  if (!g || !g.analyserIn) {
    return { active: false, enabled: S.audioCompEnabled };
  }
  const inDb = analyserDb(g.analyserIn);
  return {
    active: true,
    enabled: S.audioCompEnabled,
    in: inDb,
    out: audioOutDb(g, inDb),
    threshold: S.audioCompThreshold,
  };
}

// After the user flips the audio toggle, the graph may not engage on the very
// first try (src still loading, context suspended, player swapping the <video>).
// Poll briefly so we report the real outcome instead of a transient "unavailable".
let audioAnnounceTimer = null;
export function announceAudioStatus(attempt) {
  clearTimeout(audioAnnounceTimer);
  if (!S.audioCompEnabled) { showIndicator(i18n("audioOff") || "Audio compression off"); return; }
  const res = applyAudioComp();
  if (res.engaged > 0) { showIndicator(i18n("audioOn") || "Audio compression on"); return; }
  if (res.reason === "inuse") { showIndicator(i18n("audioInUse") || "Audio already used by another extension/player"); return; }
  if ((attempt || 0) < 6) { // ~3s of retries while it loads / resumes
    audioAnnounceTimer = setTimeout(() => announceAudioStatus((attempt || 0) + 1), 500);
    return;
  }
  showIndicator(i18n("audioUnavailable") || "Compression unavailable on this video");
}

// Accumulate audio-level history whenever a graph already exists (no new routing),
// so re-opening the popup shows a pre-filled graph.
setInterval(() => {
  if (!ctxValid()) return;
  const v = primaryVideo();
  const g = v && audioGraphs.get(v);
  if (!g || !g.analyserIn || !audioCtx || audioCtx.state !== "running") return;
  const inDb = analyserDb(g.analyserIn);
  audioLevelHist.push({ in: inDb, out: audioOutDb(g, inDb) });
  while (audioLevelHist.length > A_HIST_MAX) audioLevelHist.shift();
}, A_HIST_MS);
