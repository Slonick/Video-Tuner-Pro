import { ctxValid } from "./platform/browser.js";

export const seenVideos = new WeakSet<HTMLVideoElement>();
export const seenAudios = new WeakSet<HTMLAudioElement>();

// --- media registry --------------------------------------------------------
// The <video>/<audio> elements currently on the page. The set is maintained
// incrementally: a single MutationObserver watches the light DOM and every open
// shadow root found to contain media, so additions (and in-place swaps, e.g. a
// quality change recreating the <video> inside a player's shadow root) are caught
// as they happen. Consumers read the set instead of re-walking the document, so the
// hot path is O(tracked media), not O(DOM size). reconcile() is the only full walk
// left and runs only as a rare backstop (see index.ts).
const trackedVideos = new Set<HTMLVideoElement>();
const trackedAudios = new Set<HTMLAudioElement>();
const observedRoots = new WeakSet<ShadowRoot>(); // open shadow roots we already observe
let observer: MutationObserver | null = null;
let tracking = false;

// Injected by startTracking so this module needn't import index/overlay (would be a
// cycle): notify when new media appears (→ re-apply speed), tear down on a dead
// context, and recognise our own badge host (never observe the badge's shadow root,
// or its React writes would feed back into us).
let onMediaChange: () => void = () => {};
let onContextDead: () => void = () => {};
let isOwnNode: (n: Node) => boolean = () => false;

function addMedia(el: Element): boolean {
  if (el instanceof HTMLVideoElement) {
    if (trackedVideos.has(el)) return false;
    trackedVideos.add(el);
    return true;
  }
  if (el instanceof HTMLAudioElement) {
    if (trackedAudios.has(el)) return false;
    trackedAudios.add(el);
    return true;
  }
  return false;
}

// Register an element's open shadow root: recurse into it for media, and observe it
// if it holds media so a later in-root change (e.g. a quality-change <video> swap)
// fires for us. Returns whether any NEW media was registered inside.
function handleShadow(el: Element): boolean {
  const sr = el.shadowRoot;
  if (!sr || isOwnNode(el)) return false;
  const added = scanTree(sr);
  if (observer && !observedRoots.has(sr) && sr.querySelector("video,audio")) {
    observedRoots.add(sr);
    observer.observe(sr, { childList: true, subtree: true });
  }
  return added;
}

// Walk `root` once, registering any media and recursing through open shadow roots
// (including `root`'s own shadow root, which querySelectorAll can't reach). Returns
// whether any NEW media element was registered (used to decide whether a re-apply
// is warranted). Bounded by the size of `root` — a freshly-added chat message costs
// the chat message, not the whole page.
function scanTree(root: ParentNode): boolean {
  let added = false;
  if (root instanceof Element) {
    if (addMedia(root)) added = true;
    if (handleShadow(root)) added = true;
  }
  let all: NodeListOf<Element>;
  try {
    all = root.querySelectorAll("*");
  } catch (e) {
    return added;
  }
  for (const el of all) {
    if (addMedia(el)) added = true;
    if (handleShadow(el)) added = true;
  }
  return added;
}

function handleMutations(mutations: MutationRecord[]): void {
  if (!ctxValid()) {
    onContextDead();
    return;
  }
  let added = false;
  for (const m of mutations) {
    for (const n of m.addedNodes) {
      if (n instanceof Element && scanTree(n)) added = true;
    }
  }
  // Only re-apply when the media set actually changed; an unrelated DOM mutation
  // (chat, feed, ads) no longer drives a needless applyAll pass.
  if (added) onMediaChange();
}

// Wire up incremental tracking: observe the light DOM (and media-bearing shadow
// roots discovered now and later), and seed the set with what's already present.
export function startTracking(opts: {
  onMediaChange: () => void;
  onContextDead: () => void;
  isOwnNode: (n: Node) => boolean;
}): void {
  onMediaChange = opts.onMediaChange;
  onContextDead = opts.onContextDead;
  isOwnNode = opts.isOwnNode;
  observer = new MutationObserver(handleMutations);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  tracking = true;
  scanTree(document);
}

export function stopTracking(): void {
  tracking = false;
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

// Full shadow-piercing scan → merge into the set and observe any media-bearing
// roots. The rare backstop for the one case the observer can't see: a shadow root
// attached to an element that was already present (attachShadow fires no mutation).
// Called from the background tick at a slow cadence, not per consumer call.
export function reconcile(): boolean {
  return scanTree(document);
}

// Read the tracked videos, dropping any that have since left the DOM (lazy prune —
// removals don't need their own mutation pass). When the registry isn't running
// (unit tests, or before index.ts wires it) fall back to a direct scan so callers
// still get a correct, synchronous answer.
export function collectVideos(): HTMLVideoElement[] {
  if (!tracking) scanTree(document);
  const out: HTMLVideoElement[] = [];
  for (const v of trackedVideos) {
    if (v.isConnected) out.push(v);
    else trackedVideos.delete(v);
  }
  return out;
}

// Only used when the opt-in "speed up audio" toggle is on — see applyAll.
export function collectAudios(): HTMLAudioElement[] {
  if (!tracking) scanTree(document);
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
