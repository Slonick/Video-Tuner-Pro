// Off = a transparent graph (ratio 1:1, unity gain) rather than a disconnect, so
// metering keeps working.
import { S } from "../state.js";
import { collectVideos, primaryVideo } from "../videos.js";
import { onStreamPage, isLive } from "../live/detection.js";
import { compOn } from "./translation.js";
import {
  audioContext,
  audioGraphs,
  graphForCurrentSource,
  hasAudioGraphs,
  setupGraph,
  hookAudioGesture,
  resumeAudioCtx,
  lastSkip,
} from "./routing.js";
import type { AudioGraph } from "./types.js";

// Ramp an AudioParam toward a value instead of assigning .value directly (an
// abrupt jump produces an audible click).
function rampParam(param: AudioParam, value: number): void {
  try {
    const ctx = audioContext();
    const t = ctx ? ctx.currentTime : 0;
    param.cancelScheduledValues(t);
    param.setTargetAtTime(value, t, 0.02);
  } catch (e) {
    try {
      param.value = value;
    } catch (_) {}
  }
}

// Skipped when nothing changed, so we don't re-poke params every tick (clicks).
function applyGraphParams(g: AudioGraph): void {
  const on = compOn();
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
  } catch (e) {
    /* node detached */
  }
}

export function applyAudioComp(
  videos?: HTMLVideoElement[],
  primary?: HTMLVideoElement | null,
): {
  engaged: number;
  skipped: number;
  reason: string | null;
} {
  if (!S.audioCompEnabled && !S.autoSlowEnabled && !hasAudioGraphs()) {
    return { engaged: 0, skipped: 0, reason: null };
  }
  const list = videos || collectVideos();
  const main = primary !== undefined ? primary : primaryVideo();
  let streamPage: boolean | undefined;
  let engaged = 0,
    skipped = 0,
    reason: string | null = null;
  for (const v of list) {
    let g: AudioGraph | null | undefined = graphForCurrentSource(v);
    if (!g && !compOn()) g = audioGraphs.get(v);
    if (!g) {
      // Capture only what a live feature actually needs: compression routes every
      // video; auto-slow needs just the primary's analyser — and never on a live
      // stream, where it yields to live-sync and doesn't run anyway. With nothing that
      // needs it we capture nothing, rather than permanently holding the page's single
      // audio-capture slot (createMediaElementSource is one-shot, can't be released)
      // and blocking other audio extensions on every page.
      if (S.autoSlowEnabled && v === main && streamPage === undefined) {
        streamPage = onStreamPage();
      }
      const need =
        S.audioCompEnabled || (S.autoSlowEnabled && v === main && !streamPage && !isLive(v));
      if (!need) continue;
      g = setupGraph(v);
      if (!g) {
        skipped++;
        const skip = lastSkip(v);
        if (skip === "inuse") reason = "inuse";
        else if (!reason) reason = skip;
        continue;
      }
    }
    applyGraphParams(g);
    engaged++;
  }
  // Always allow the context to resume on a user gesture, so metering works even
  // with compression off.
  if (main) {
    hookAudioGesture();
    resumeAudioCtx();
  }
  return { engaged, skipped, reason };
}
