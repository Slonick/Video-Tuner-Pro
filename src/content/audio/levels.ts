export function rmsToDb(buf: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  return rms > 0.0000158 ? 20 * Math.log10(rms) : -100; // floor ~ -96 dB
}

// output = input + reduction + make-up; off → output == input.
export function deriveOutDb(inDb: number, reduction: number, makeupOn: boolean, makeup: number): number {
  if (inDb <= -100) return inDb; // silence floor — amplifying nothing is still nothing
  return inDb + reduction + (makeupOn ? makeup : 0);
}
