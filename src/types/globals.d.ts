// Firefox exposes `browser` (and supports chrome-style callbacks); we alias it to
// the chrome namespace shape we actually use. Undefined on Chromium.
declare const browser: typeof chrome | undefined;

// Chromium-only decoder byte counters (used for the bitrate estimate) and the
// prefixed AudioContext, neither of which is in the standard DOM lib.
interface HTMLVideoElement {
  webkitVideoDecodedByteCount?: number;
  webkitAudioDecodedByteCount?: number;
  /** Scratch space for bitrate sampling, attached by bitrate.ts. */
  _brSamples?: { t: number; b: number }[];
}

interface Window {
  webkitAudioContext?: typeof AudioContext;
}

// Scratch buffer cached on an AnalyserNode by audio.ts to avoid per-frame allocs.
interface AnalyserNode {
  _buf?: Float32Array<ArrayBuffer>;
}

// Cached CSS pixel size, stamped on the canvas by graphs.ts fitCanvas().
interface HTMLCanvasElement {
  _w?: number;
  _h?: number;
}
