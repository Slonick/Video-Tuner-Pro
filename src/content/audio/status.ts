// User-facing audio status. After the user flips the audio toggle, the graph may
// not engage on the first try (src still loading, context suspended, player
// swapping the <video>), so poll briefly and report the real outcome on screen
// instead of a transient "unavailable".
import { S } from "../state.js";
import { i18n } from "../platform/i18n.js";
import { showIndicator } from "../badge/indicator.js";
import { applyAudioComp } from "./compressor.js";

let audioAnnounceTimer: ReturnType<typeof setTimeout> | undefined;

export function announceAudioStatus(attempt?: number): void {
  clearTimeout(audioAnnounceTimer);
  if (!S.audioCompEnabled) { showIndicator(i18n("audioOff") || "Audio compression off"); return; }
  const res = applyAudioComp();
  if (res.engaged > 0) { showIndicator(i18n("audioOn") || "Audio compression on"); return; }
  if (res.reason === "inuse") { showIndicator(i18n("audioInUse") || "Audio already used by another extension/player"); return; }
  if ((attempt || 0) < 6) { // ~3s of retries while it loads / resumes
    audioAnnounceTimer = setTimeout(() => announceAudioStatus((attempt || 0) + 1), 500);
    return;
  }
  showIndicator(i18n("audioUnavailable") || "Compression unavailable on this video");
}
