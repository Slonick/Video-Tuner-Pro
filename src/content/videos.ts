export const seenVideos = new WeakSet<HTMLVideoElement>();
export const seenAudios = new WeakSet<HTMLAudioElement>();

// Collect every element matching `selector`, piercing OPEN shadow roots. Some
// players (e.g. Boosty) render the media inside a shadow DOM, where a plain
// document.querySelectorAll() can't reach it.
function collect<T extends Element>(selector: string): T[] {
  const acc: T[] = [];
  const seen = new Set<T>();
  const scan = (root: ParentNode): void => {
    let hits: NodeListOf<T>;
    try {
      hits = root.querySelectorAll<T>(selector);
    } catch (e) {
      return;
    }
    for (const h of hits) {
      if (!seen.has(h)) {
        seen.add(h);
        acc.push(h);
      }
    }
    let all: NodeListOf<Element>;
    try {
      all = root.querySelectorAll("*");
    } catch (e) {
      return;
    }
    for (const el of all) {
      if (el.shadowRoot) scan(el.shadowRoot);
    }
  };
  scan(document);
  return acc;
}

export function collectVideos(): HTMLVideoElement[] {
  return collect<HTMLVideoElement>("video");
}

// Only walked when the opt-in "speed up audio" toggle is on — see applyAll.
export function collectAudios(): HTMLAudioElement[] {
  return collect<HTMLAudioElement>("audio");
}

// Largest playing video — what the overlay/badge anchors to.
export function primaryVideo(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null,
    bestScore = -1;
  for (const v of collectVideos()) {
    const r = v.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) continue;
    const score = (v.paused ? 0 : 1e9) + r.width * r.height;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}
