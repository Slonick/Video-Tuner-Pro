export const seenVideos = new WeakSet<HTMLVideoElement>();

// Collect every <video> on the page, piercing OPEN shadow roots. Some players
// (e.g. Boosty) render the <video> inside a shadow DOM, where a plain
// document.querySelectorAll("video") can't reach it.
export function collectVideos(): HTMLVideoElement[] {
  const acc: HTMLVideoElement[] = [];
  const seen = new Set<HTMLVideoElement>();
  const scan = (root: ParentNode): void => {
    let vids: NodeListOf<HTMLVideoElement>;
    try {
      vids = root.querySelectorAll("video");
    } catch (e) {
      return;
    }
    for (const v of vids) {
      if (!seen.has(v)) {
        seen.add(v);
        acc.push(v);
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
