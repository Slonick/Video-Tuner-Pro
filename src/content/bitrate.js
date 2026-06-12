// Download-bitrate estimate and the forward-buffer history sampler (live only).
import { ctxValid } from "./env.js";
import { onStreamPage, liveVideo, forwardBuffer } from "./live.js";

// Recent forward-buffer samples on live streams, to pre-fill the buffer graph.
export const bufferLevelHist = [];
const BUF_HIST_MS = 500, BUF_HIST_MAX = 64;

// Estimated download bitrate (bits/s) from the decoder's byte counter — unlike
// Resource Timing, this isn't blocked by cross-origin CDNs. Chromium-only
// (webkitVideoDecodedByteCount); returns null elsewhere (Firefox). Averaged over a
// sliding window so per-segment fetch spikes don't make the number jump around.
const BITRATE_WINDOW = 6000; // ms to average the bitrate over
export function streamBitrate(v) {
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

// Sample forward-buffer on live streams, to pre-fill the buffer graph.
setInterval(() => {
  if (!ctxValid()) return;
  if (!onStreamPage()) { if (bufferLevelHist.length) bufferLevelHist.length = 0; return; }
  const lv = liveVideo();
  if (!lv) return;
  bufferLevelHist.push({ at: Date.now(), v: forwardBuffer(lv) });
  while (bufferLevelHist.length > BUF_HIST_MAX) bufferLevelHist.shift();
}, BUF_HIST_MS);
