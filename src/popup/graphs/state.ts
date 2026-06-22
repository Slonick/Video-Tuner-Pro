// One object passed to the draw + poll modules (which mutate it) so no module
// owns global mutable state.

export interface XY {
  x: number;
  y: number;
}
export interface AudioSample {
  t: number;
  in: number;
  out: number;
}
export interface BufSample {
  t: number;
  v: number;
  a?: number | null;
} // v=primary, a=buffer-ahead

export const A_MIN = -100,
  A_MAX = 0; // audio dB range (centre = A_MIN)
export const A_WINDOW = 6000; // audio waveform time window (ms)
export const BUF_WINDOW = 30000; // latency graph time window (ms)
export const AS_WINDOW = 8000; // auto-slow speech-rate graph time window (ms)
export const AS_RATE_MAX = 16; // top of the syllable-rate axis (syll/s)

export interface AutoSlowSample {
  t: number;
  rate: number;
  speed: number;
}

export interface GraphState {
  aCanvas: HTMLCanvasElement;
  acx: CanvasRenderingContext2D; // audio meter
  bCanvas: HTMLCanvasElement;
  bcx: CanvasRenderingContext2D; // latency graph
  asCanvas: HTMLCanvasElement | null;
  ascx: CanvasRenderingContext2D | null; // auto-slow speech-rate graph (optional)

  cur: { in: number; out: number }; // eased displayed levels
  tgt: { in: number; out: number }; // latest polled levels
  audioActive: boolean;
  audioEnabled: boolean; // compressor actually processing on the page
  knee: number; // compressor knee (dB) — from poll data; popup has no knee slider
  compAnim: number; // eased 0(off)…1(on) for readout/ghost morph
  histSeeded: boolean; // graphs pre-filled from history yet?
  audioHist: AudioSample[]; // {t, in, out} dB level history
  audioDiffAt: number; // readout throttle timestamp
  audioInShown: number | null; // corner in/out level readouts
  audioOutShown: number | null;

  bufHist: BufSample[]; // {t, v, a} smoothed latency/buffer history
  bufSmooth: number | null; // EMA state (primary) — per-poll target
  bufCur: number | null; // per-frame eased value (primary), recorded each frame
  bufCurAhead: number | null; // per-frame eased value (buffer-ahead)
  bufShown: number | null; // primary value drawn (refreshed ~1×/s)
  bufShownAt: number;
  bufLive: boolean; // only graph on live streams
  bufAhead: number | null; // buffered-ahead s when latency is plotted
  bufAheadSmooth: number | null; // EMA state (buffer-ahead line)
  bufAheadShown: number | null; // value actually drawn (refreshed ~1×/s)
  bufAheadAt: number;
  bufLimited: boolean; // buffer too thin to catch up — warn
  bufBitrate: number | null; // latest download bitrate (bits/s) or null
  bufBitrateShown: number | null; // value actually drawn (refreshed ~1×/s)
  bufBitrateAt: number;
  yMax: number; // eased Y scale — latency (down) half
  yMaxAhead: number; // eased Y scale — buffer (up) half

  // Auto-slow speech graph: latest polled values, their eased counterparts, and
  // the recorded history.
  asActive: boolean;
  asEnabled: boolean; // feature turned on for this page (drives the off vs idle hint)
  asRate: number; // latest polled syllable rate (syll/s)
  asSpeed: number; // latest polled effective speed (×)
  asTargetLine: number; // the trigger target (syll/s)
  asRateCur: number; // eased rate
  asSpeedCur: number; // eased speed
  asHist: AutoSlowSample[];
}

export function createGraphState(
  aCanvas: HTMLCanvasElement,
  acx: CanvasRenderingContext2D,
  bCanvas: HTMLCanvasElement,
  bcx: CanvasRenderingContext2D,
  asCanvas: HTMLCanvasElement | null,
  ascx: CanvasRenderingContext2D | null,
): GraphState {
  return {
    aCanvas,
    acx,
    bCanvas,
    bcx,
    asCanvas,
    ascx,
    cur: { in: A_MIN, out: A_MIN },
    tgt: { in: A_MIN, out: A_MIN },
    audioActive: false,
    audioEnabled: false,
    knee: 30,
    compAnim: 0,
    histSeeded: false,
    audioHist: [],
    audioDiffAt: 0,
    audioInShown: null,
    audioOutShown: null,
    bufHist: [],
    bufSmooth: null,
    bufCur: null,
    bufCurAhead: null,
    bufShown: null,
    bufShownAt: 0,
    bufLive: false,
    bufAhead: null,
    bufAheadSmooth: null,
    bufAheadShown: null,
    bufAheadAt: 0,
    bufLimited: false,
    bufBitrate: null,
    bufBitrateShown: null,
    bufBitrateAt: 0,
    yMax: 8,
    yMaxAhead: 8,
    asActive: false,
    asEnabled: false,
    asRate: 0,
    asSpeed: 1,
    asTargetLine: 6, // placeholder until the first poll reports the real setting
    asRateCur: 0,
    asSpeedCur: 1,
    asHist: [],
  };
}
