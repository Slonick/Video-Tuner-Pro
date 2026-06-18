// Off = a transparent graph (ratio 1:1, unity gain) rather than a disconnect, so
// metering keeps working.
import { S } from "../state.js";
import { collectVideos, primaryVideo } from "../videos.js";
import { compOn } from "./translation.js";
import {
  audioContext,
  audioGraphs,
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

export function applyAudioComp(videos?: HTMLVideoElement[]): {
  engaged: number;
  skipped: number;
  reason: string | null;
} {
  const list = videos || collectVideos();
  const primary = primaryVideo();
  let engaged = 0,
    skipped = 0,
    reason: string | null = null;
  for (const v of list) {
    let g: AudioGraph | null | undefined = audioGraphs.get(v);
    if (!g) {
      // Compression on → route every video. Off → still route the PRIMARY video
      // so the meter/graph always work (it runs transparent, output == input).
      if (!S.audioCompEnabled && v !== primary) continue;
      g = setupGraph(v);
      if (!g) {
        skipped++;
        const skip = lastSkip();
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
  if (primary) {
    hookAudioGesture();
    resumeAudioCtx();
  }
  return { engaged, skipped, reason };
}
