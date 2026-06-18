import { MIN_FORWARD_BUFFER } from "./core/constants.js";
import { S } from "./state.js";
import { primaryVideo } from "./videos.js";
import { onStreamPage } from "./live/detection.js";
import { catchupBufferLimited } from "./live/catchup.js";
import { forwardBuffer, streamLatency } from "./live/metrics.js";
import { applyAudioComp } from "./audio/compressor.js";
import { audioLevels } from "./audio/metering.js";
import { streamBitrate } from "./bitrate.js";
import type { AudioLevels } from "./audio/types.js";

export interface MonitorData {
  audio: AudioLevels;
  buffer: number | null;
  bufferAhead: number | null;
  bufLimited: boolean;
  bitrate: number | null;
  target: number;
  live: boolean;
  hasVideo: boolean;
}

export function monitorData(): MonitorData {
  applyAudioComp(); // make sure the meter graph is engaged
  const v = primaryVideo();
  const live = onStreamPage();
  // The live graph plots latency-to-broadcaster where the site exposes it
  // (Twitch/YouTube), else the buffered-ahead seconds. Only meaningful on streams.
  // When the site latency is what's plotted, the buffered-ahead seconds ride
  // along separately (shown as "latency (buffer)"); otherwise it would be a dupe.
  let lag: number | null = null;
  let bufAhead: number | null = null;
  let limited = false;
  if (v && live) {
    const l = streamLatency();
    const fb = forwardBuffer(v);
    lag = l != null ? l : fb;
    if (l != null) bufAhead = fb;
    limited =
      S.liveSyncEnabled &&
      catchupBufferLimited(l, fb, Math.max(S.liveSyncTarget, MIN_FORWARD_BUFFER));
  }
  return {
    audio: audioLevels(),
    buffer: lag,
    bufferAhead: bufAhead,
    bufLimited: limited,
    bitrate: v && live ? streamBitrate(v) : null,
    target: S.liveSyncTarget,
    live,
    hasVideo: !!v,
  };
}
