import { ctxValid } from "./platform/browser.js";
import { onStreamPage, liveVideo } from "./live/detection.js";
import { forwardBuffer, streamLatency } from "./live/metrics.js";

// Recent latency/buffer samples on live streams, to pre-fill the live graph.
export const bufferLevelHist: { at: number; v: number }[] = [];
export const BUF_HIST_MS = 500;
const BUF_HIST_MAX = 64;

// Estimated download bitrate (bits/s) from the decoder's byte counter — unlike
// Resource Timing, this isn't blocked by cross-origin CDNs. Chromium-only
// (webkitVideoDecodedByteCount); returns null elsewhere (Firefox). Averaged over a
// sliding window so per-segment fetch spikes don't make the number jump around.
const BITRATE_WINDOW = 6000; // ms to average the bitrate over
export function streamBitrate(v: HTMLVideoElement | null): number | null {
  if (!v || typeof v.webkitVideoDecodedByteCount !== "number") return null;
  const bytes = v.webkitVideoDecodedByteCount + (v.webkitAudioDecodedByteCount || 0);
  const t = Date.now();
  const s = v._brSamples || (v._brSamples = []);
  // Counter went backwards (seek / source or quality switch) → drop the history.
  if (s.length && bytes < s[s.length - 1].b) s.length = 0;
  s.push({ t, b: bytes });
  while (s.length > 2 && t - s[0].t > BITRATE_WINDOW) s.shift();
  if (s.length < 2) return null;
  const dt = (s[s.length - 1].t - s[0].t) / 1000;
  if (dt < 1) return null; // need ~1s of data before showing a number
  return ((s[s.length - 1].b - s[0].b) * 8) / dt;
}

// Sample latency-to-broadcaster (or buffered-ahead, where latency isn't exposed)
// on live streams, to pre-fill the live graph. One sample per call — the content
// entry schedules it every BUF_HIST_MS; the body stays here so it's unit-testable.
export function recordBufferSample(): void {
  if (!ctxValid()) return;
  if (!onStreamPage()) {
    if (bufferLevelHist.length) bufferLevelHist.length = 0;
    return;
  }
  const lv = liveVideo();
  if (!lv) return;
  const l = streamLatency();
  bufferLevelHist.push({ at: Date.now(), v: l != null ? l : forwardBuffer(lv) });
  while (bufferLevelHist.length > BUF_HIST_MAX) bufferLevelHist.shift();
}
