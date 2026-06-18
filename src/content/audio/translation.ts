// Voice-over translation (VOT) detection. A translator needs the video's audio
// source, and createMediaElementSource is exclusive — re-amplifying the original
// fights the translation. So we yield (transparent graph, grab no new sources)
// only while a translation is ACTIVELY playing, not whenever VOT's always-mounted
// UI is merely present. VOT marks its button data-status="success" while playing,
// inside its OPEN shadow root under <vot-shadow-host>. If VOT changes this,
// detection fails open (no muting).
import { S } from "../state.js";

export function translationActive(): boolean {
  try {
    const host = document.querySelector("vot-shadow-host");
    const sr = host && host.shadowRoot;
    return !!(sr && sr.querySelector('[data-status="success"]'));
  } catch (e) {
    return false;
  }
}

export function compOn(): boolean {
  return S.audioCompEnabled && !translationActive();
}
