// One object passed to the draw + poll modules (which mutate it) so no module
// owns global mutable state.

export interface XY { x: number; y: number; }
export interface AudioSample { t: number; in: number; out: number; }
export interface BufSample { t: number; v: number; }

export const A_MIN = -100, A_MAX = 0;   // audio dB range (centre = A_MIN)
export const A_WINDOW = 6000;            // audio waveform time window (ms)
export const BUF_WINDOW = 30000;         // latency graph time window (ms)

export interface GraphState {
  aCanvas: HTMLCanvasElement; acx: CanvasRenderingContext2D;   // audio meter
  bCanvas: HTMLCanvasElement; bcx: CanvasRenderingContext2D;   // latency graph

  cur: { in: number; out: number };       // eased displayed levels
  tgt: { in: number; out: number };       // latest polled levels
  audioActive: boolean;
  audioEnabled: boolean;                  // compressor actually processing on the page
  compAnim: number;                       // eased 0(off)…1(on) for readout/ghost morph
  histSeeded: boolean;                    // graphs pre-filled from history yet?
  audioHist: AudioSample[];               // {t, in, out} dB level history
  audioDiffShown: number | null;          // centered "out − in" dB readout
  audioDiffAt: number;
  audioInShown: number | null;            // corner in/out level readouts
  audioOutShown: number | null;

  bufHist: BufSample[];                   // {t, v} smoothed latency/buffer history
  bufSmooth: number | null;               // EMA state
  bufLive: boolean;                       // only graph on live streams
  bufBitrate: number | null;              // latest download bitrate (bits/s) or null
  bufBitrateShown: number | null;         // value actually drawn (refreshed ~1×/s)
  bufBitrateAt: number;
  yMax: number;                           // eased Y scale
}

export function createGraphState(
  aCanvas: HTMLCanvasElement, acx: CanvasRenderingContext2D,
  bCanvas: HTMLCanvasElement, bcx: CanvasRenderingContext2D,
): GraphState {
  return {
    aCanvas, acx, bCanvas, bcx,
    cur: { in: A_MIN, out: A_MIN },
    tgt: { in: A_MIN, out: A_MIN },
    audioActive: false, audioEnabled: false, compAnim: 0, histSeeded: false,
    audioHist: [], audioDiffShown: null, audioDiffAt: 0, audioInShown: null, audioOutShown: null,
    bufHist: [], bufSmooth: null, bufLive: false,
    bufBitrate: null, bufBitrateShown: null, bufBitrateAt: 0, yMax: 8,
  };
}
