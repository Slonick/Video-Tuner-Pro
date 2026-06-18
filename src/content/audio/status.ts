// After the user flips the audio toggle, compression may not engage on the first
// try (src still loading, context suspended, the player swapping the <video>), so
// re-apply a few times until it takes.
import { S } from "../state.js";
import { applyAudioComp } from "./compressor.js";

let retryTimer: ReturnType<typeof setTimeout> | undefined;

export function engageAudio(attempt = 0): void {
  clearTimeout(retryTimer);
  if (!S.audioCompEnabled) return;
  const res = applyAudioComp();
  if (res.engaged > 0 || res.reason === "inuse") return; // engaged, or can't (already in use)
  if (attempt < 6) {
    // ~3s of retries while it loads / resumes
    retryTimer = setTimeout(() => engageAudio(attempt + 1), 500);
  }
}
