export const seenVideos = new WeakSet<HTMLVideoElement>();
export const seenAudios = new WeakSet<HTMLAudioElement>();

// Collect every element matching `selector` under `root`, piercing OPEN shadow
// roots. Some players (e.g. Boosty) render the media inside a shadow DOM, where a
// plain querySelectorAll() can't reach it. Used only by reconcile() (rooted at the
// document) — the per-call hot path reads the tracked set instead.
function collect<T extends Element>(root: ParentNode, selector: string): T[] {
  const acc: T[] = [];
  const seen = new Set<T>();
  const scan = (r: ParentNode): void => {
    let hits: NodeListOf<T>;
    try {
      hits = r.querySelectorAll<T>(selector);
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
      all = r.querySelectorAll("*");
    } catch (e) {
      return;
    }
    for (const el of all) {
      if (el.shadowRoot) scan(el.shadowRoot);
    }
  };
  scan(root);
  return acc;
}

// --- media registry --------------------------------------------------------
// The media elements currently on the page. Maintained incrementally as the DOM
// mutates (ingestMutations) and reconciled periodically with a full shadow-piercing
// scan (reconcile). Consumers read these sets instead of re-walking the document on
// every call — turning the hot path from O(DOM size) into O(tracked media).
const trackedVideos = new Set<HTMLVideoElement>();
const trackedAudios = new Set<HTMLAudioElement>();
let tracking = false; // true once index.ts wired the MutationObserver + did the first scan

// Begin trusting the incrementally-maintained sets: a MutationObserver now feeds
// ingestMutations and the background tick calls reconcile(), so collectVideos() no
// longer has to scan on every call. Seeds the sets with whatever's already present.
export function beginTracking(): void {
  tracking = true;
  reconcile();
}

export function stopTracking(): void {
  tracking = false;
}

// Full shadow-piercing scan → merge into the tracked sets. The backstop for media
// the incremental observer can't see (videos inside shadow roots; roots attached to
// elements that were already present). Runs on the background tick (≤1/s), not on
// every consumer call, so its O(DOM) cost is paid at most once a tick.
export function reconcile(): void {
  for (const v of collect<HTMLVideoElement>(document, "video")) trackedVideos.add(v);
  for (const a of collect<HTMLAudioElement>(document, "audio")) trackedAudios.add(a);
}

// Cheap incremental ingest of freshly-added light-DOM nodes — no "*" walk and no
// shadow piercing (reconcile() covers shadow). Bounded by the size of what changed,
// not the whole document, so a chat message adding ten nodes costs ten nodes.
export function ingestMutations(mutations: MutationRecord[]): void {
  for (const m of mutations) {
    for (const n of m.addedNodes) {
      if (!(n instanceof Element)) continue;
      if (n instanceof HTMLVideoElement) trackedVideos.add(n);
      else if (n instanceof HTMLAudioElement) trackedAudios.add(n);
      for (const v of n.querySelectorAll("video")) trackedVideos.add(v);
      for (const a of n.querySelectorAll("audio")) trackedAudios.add(a);
    }
  }
}

// Read the tracked videos, dropping any that have since left the DOM (lazy prune —
// removals don't need their own mutation pass). When the registry isn't running
// (unit tests, or before index.ts wires it) fall back to a direct scan so callers
// still get a correct, synchronous answer.
export function collectVideos(): HTMLVideoElement[] {
  if (!tracking) reconcile();
  const out: HTMLVideoElement[] = [];
  for (const v of trackedVideos) {
    if (v.isConnected) out.push(v);
    else trackedVideos.delete(v);
  }
  return out;
}

// Only used when the opt-in "speed up audio" toggle is on — see applyAll.
export function collectAudios(): HTMLAudioElement[] {
  if (!tracking) reconcile();
  const out: HTMLAudioElement[] = [];
  for (const a of trackedAudios) {
    if (a.isConnected) out.push(a);
    else trackedAudios.delete(a);
  }
  return out;
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
