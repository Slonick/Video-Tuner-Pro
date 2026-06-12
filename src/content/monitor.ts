import { S } from "./state.js";
import { primaryVideo } from "./videos.js";
import { onStreamPage } from "./live/detection.js";
import { forwardBuffer, streamLatency } from "./live/metrics.js";
import { applyAudioComp } from "./audio/compressor.js";
import { audioLevels } from "./audio/metering.js";
import { streamBitrate } from "./bitrate.js";
import type { AudioLevels } from "./audio/types.js";

export interface MonitorData {
  audio: AudioLevels;
  buffer: number | null;
  bitrate: number | null;
  target: number;
  live: boolean;
  hasVideo: boolean;
}

export function monitorData(): MonitorData {
  applyAudioComp();                 // make sure the meter graph is engaged
  const v = primaryVideo();
  const live = onStreamPage();
  // The live graph plots latency-to-broadcaster where the site exposes it
  // (Twitch/YouTube), else the buffered-ahead seconds. Only meaningful on streams.
  let lag: number | null = null;
  if (v && live) { const l = streamLatency(); lag = l != null ? l : forwardBuffer(v); }
  return {
    audio: audioLevels(),
    buffer: lag,
    bitrate: (v && live) ? streamBitrate(v) : null,
    target: S.liveSyncTarget,
    live,
    hasVideo: !!v,
  };
}
