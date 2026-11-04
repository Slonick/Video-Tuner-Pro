// Voice-over translation (VOT) detection. A translator needs the video's audio
// source, and createMediaElementSource is exclusive — re-amplifying the original
// fights the translation. So we yield (transparent graph, grab no new sources)
// only while a translation is ACTIVELY playing, not whenever VOT's always-mounted
// UI is merely present. VOT marks its button data-status="success" while playing,
// inside its OPEN shadow root under <vot-shadow-host>. If VOT changes this,
// detection fails open (no muting).
import { S } from "../state.js";

// One document search per synchronous pass — the compressor and the meter ask several
// times per video, and a translation can't start or stop in the middle of a pass.
let active: boolean | null = null;

export function translationActive(): boolean {
  if (active == null) {
    active = findActiveTranslation();
    queueMicrotask(() => {
      active = null;
    });
  }
  return active;
}

function findActiveTranslation(): boolean {
  const host = document.querySelector("vot-shadow-host");
  const sr = host && host.shadowRoot;
  return !!(sr && sr.querySelector('[data-status="success"]'));
}

export function compOn(): boolean {
  return S.audioCompEnabled && !S.siteDisabled && !translationActive();
}
