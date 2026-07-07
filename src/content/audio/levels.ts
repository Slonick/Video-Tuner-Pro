// Linear RMS (0..1) of a time-domain buffer — the raw amplitude the auto-slow
// envelope tracker works on, before any dB conversion.
export function rmsLinear(buf: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

export function rmsToDb(buf: ArrayLike<number>): number {
  const rms = rmsLinear(buf);
  return rms > 0.0000158 ? 20 * Math.log10(rms) : -100; // floor ~ -96 dB
}

// output = input + reduction + make-up gain. This is the actual level leaving the
// graph, so the meter can reveal clipping risk instead of hiding it behind the
// compressor-only delta.
export function deriveOutDb(inDb: number, reduction: number, gainDb = 0): number {
  if (inDb <= -100) return inDb; // silence floor — amplifying nothing is still nothing
  return inDb + reduction + gainDb;
}
