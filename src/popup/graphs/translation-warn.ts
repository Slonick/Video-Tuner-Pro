// While a voice-over translator (VOT) is playing, the compressor yields — show a
// warning icon and dim/lock the audio section (like manual speed on a stream).
const votWarnEl = document.getElementById("audioVotWarn");
const audioBodyEl = document.getElementById("audioBody");
const audioSectionEl = audioBodyEl && audioBodyEl.closest(".sync-section");
let audioTranslating = false;

export function setAudioTranslating(on: boolean): void {
  if (on === audioTranslating) return;
  audioTranslating = on;
  if (votWarnEl) votWarnEl.style.display = on ? "inline-flex" : "none";
  if (audioSectionEl) audioSectionEl.classList.toggle("audio-locked", on);
}
