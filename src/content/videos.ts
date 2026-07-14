import { ctxValid } from "./platform/browser.js";
import { SHADOW_ROOT_ATTACHED_EVENT } from "../shared/dom-events.js";

export const seenVideos = new WeakSet<HTMLVideoElement>();
export const seenAudios = new WeakSet<HTMLAudioElement>();

// --- media registry --------------------------------------------------------
// The <video>/<audio> elements currently on the page. The set is maintained
// incrementally: a single MutationObserver watches the light DOM and every open
// shadow root found to contain media, so additions (and in-place swaps, e.g. a
// quality change recreating the <video> inside a player's shadow root) are caught
// as they happen. Consumers read the set instead of re-walking the document, so the
// hot path is O(tracked media), not O(DOM size). The initial seed is the only
// full walk; periodic reconcile() uses a cheaper media-only pass plus known
// shadow-host checks (see index.ts).
const trackedVideos = new Set<HTMLVideoElement>();
const trackedAudios = new Set<HTMLAudioElement>();
const drmVideos = new WeakSet<HTMLVideoElement>();
let observedRoots = new WeakSet<ShadowRoot>(); // open shadow roots we already observe
interface ShadowHostCandidate {
  ref: WeakRef<Element>;
  active: boolean;
}
const shadowHostCandidates: ShadowHostCandidate[] = [];
const shadowHostCandidateRefs = new WeakMap<Element, ShadowHostCandidate>();
const ADOPTED_VIEWER_VIDEO = "data-vtp-viewer-adopted-video";
const MAX_SHADOW_HOST_CANDIDATES = 1024;
let shadowHostCandidateCursor = 0;
let observer: MutationObserver | null = null;
let tracking = false;

// Injected by startTracking so this module needn't import index/overlay (would be a
// cycle): notify when new media appears (→ re-apply speed), tear down on a dead
// context, and recognise our own badge host (never observe the badge's shadow root,
// or its React writes would feed back into us).
let onMediaChange: () => void = () => {};
let onContextDead: () => void = () => {};
let isOwnNode: (n: Node) => boolean = () => false;
let onVideoPlay: (video: HTMLVideoElement) => void = () => {};
let trackingController: AbortController | null = null;
let playHookedVideos = new WeakSet<HTMLVideoElement>();

function hookVideoPlay(el: HTMLVideoElement): void {
  const controller = trackingController;
  // collectVideos() also has a scan-on-read fallback for callers before/without
  // startTracking(). Do not leave permanent no-op listeners behind in that mode;
  // the active registry owns the listener lifetime through this controller.
  if (!controller || playHookedVideos.has(el)) return;
  playHookedVideos.add(el);
  el.addEventListener(
    "play",
    () => {
      if (!ctxValid()) {
        onContextDead();
        return;
      }
      onVideoPlay(el);
    },
    { signal: controller.signal },
  );
}

function addMedia(el: Element): boolean {
  if (isOwnNode(el)) return false;
  if (el instanceof HTMLVideoElement) {
    if (
      el.closest("[data-vtp-viewer-overlay],[data-vtp-launcher],[data-vtp-badge]") &&
      !el.hasAttribute(ADOPTED_VIEWER_VIDEO)
    )
      return false;
    if (trackedVideos.has(el)) {
      hookVideoPlay(el);
      return false;
    }
    trackedVideos.add(el);
    // Media events are not composed, so a document-level capture listener never
    // sees `play` from a video inside a shadow root (Boosty and many web-component
    // players use exactly that shape). Listen on every tracked video as well so
    // consumers such as viewer auto-open react consistently in light and shadow DOM.
    hookVideoPlay(el);
    return true;
  }
  if (el.closest("[data-vtp-viewer-overlay],[data-vtp-launcher],[data-vtp-badge]")) return false;
  if (el instanceof HTMLAudioElement) {
    if (trackedAudios.has(el)) return false;
    trackedAudios.add(el);
    return true;
  }
  return false;
}

// Register an element's open shadow root: recurse into it for media, and observe it
// if it holds media (or when explicitly asked for a newly-created empty root) so a
// later in-root change fires for us. Returns whether NEW media was registered inside.
function handleShadow(el: Element, observeEmpty = false): boolean {
  const sr = el.shadowRoot;
  if (!sr || isOwnNode(el)) return false;
  const added = scanTree(sr, observeEmpty);
  if (observer && !observedRoots.has(sr) && (observeEmpty || sr.querySelector("video,audio"))) {
    observedRoots.add(sr);
    observer.observe(sr, { childList: true, subtree: true });
  }
  return added;
}

function handleShadowAttached(event: Event): void {
  if (!ctxValid()) {
    onContextDead();
    return;
  }
  const host = event.target;
  if (!(host instanceof Element) || isOwnNode(host) || !host.shadowRoot) return;
  rememberShadowHostCandidate(host);
  // Observe even an empty root: the MAIN-world bridge dispatches synchronously
  // from attachShadow(), before player code normally appends the media element.
  if (handleShadow(host, true)) onMediaChange();
}

function rememberShadowHostCandidate(el: Element): void {
  if (isOwnNode(el)) return;
  const existing = shadowHostCandidateRefs.get(el);
  if (existing?.active) return;
  const candidate = { ref: new WeakRef(el), active: true };
  shadowHostCandidateRefs.set(el, candidate);
  if (shadowHostCandidates.length < MAX_SHADOW_HOST_CANDIDATES) {
    shadowHostCandidates.push(candidate);
    return;
  }
  const replaced = shadowHostCandidates[shadowHostCandidateCursor];
  replaced.active = false;
  shadowHostCandidates[shadowHostCandidateCursor] = candidate;
  shadowHostCandidateCursor = (shadowHostCandidateCursor + 1) % MAX_SHADOW_HOST_CANDIDATES;
}

// Walk `root` once, registering any media and recursing through open shadow roots
// (including `root`'s own shadow root, which querySelectorAll can't reach). Returns
// whether any NEW media element was registered (used to decide whether a re-apply
// is warranted). Bounded by the size of `root` — a freshly-added chat message costs
// the chat message, not the whole page.
function scanTree(root: ParentNode, observeEmptyRoots = false): boolean {
  let added = false;
  if (root instanceof Element) {
    if (isOwnNode(root)) return false;
    rememberShadowHostCandidate(root);
    if (addMedia(root)) added = true;
    if (handleShadow(root, observeEmptyRoots)) added = true;
  }
  let all: NodeListOf<Element>;
  try {
    all = root.querySelectorAll("*");
  } catch (e) {
    return added;
  }
  for (const el of all) {
    rememberShadowHostCandidate(el);
    if (addMedia(el)) added = true;
    if (handleShadow(el, observeEmptyRoots)) added = true;
  }
  return added;
}

function scanAddedElement(root: Element): boolean {
  let added = false;
  if (isOwnNode(root)) return false;
  rememberShadowHostCandidate(root);
  if (addMedia(root)) added = true;
  // A detached custom element can receive an empty shadow root before it is
  // inserted into the document. Its attach event cannot bubble to our listener,
  // so observe that root now and catch media appended later.
  if (handleShadow(root, true)) added = true;
  try {
    // Light-DOM selectors cannot see media inside a descendant's shadow root.
    // Inspect each element in this newly-added subtree once so a pre-populated
    // web-component player is registered immediately instead of waiting for the
    // periodic reconcile backstop.
    for (const el of root.querySelectorAll("*")) {
      rememberShadowHostCandidate(el);
      if (addMedia(el)) added = true;
      if (handleShadow(el, true)) added = true;
    }
  } catch (e) {
    /* inaccessible subtree */
  }
  return added;
}

function scanDirectMedia(root: ParentNode): boolean {
  let added = false;
  try {
    for (const media of root.querySelectorAll("video,audio")) {
      if (addMedia(media)) added = true;
    }
  } catch (e) {
    /* inaccessible root */
  }
  return added;
}

function scanKnownShadowHosts(): boolean {
  let added = false;
  let write = 0;
  for (const candidate of shadowHostCandidates) {
    const host = candidate.ref.deref();
    if (!host || !host.isConnected || isOwnNode(host)) {
      candidate.active = false;
      continue;
    }
    if (handleShadow(host)) added = true;
    shadowHostCandidates[write++] = candidate;
  }
  shadowHostCandidates.length = write;
  shadowHostCandidateCursor = write % MAX_SHADOW_HOST_CANDIDATES;
  return added;
}

function usableTrackedVideo(v: HTMLVideoElement): boolean {
  return (
    v.isConnected &&
    !isOwnNode(v) &&
    (!v.closest("[data-vtp-viewer-overlay],[data-vtp-launcher],[data-vtp-badge]") ||
      v.hasAttribute(ADOPTED_VIEWER_VIDEO))
  );
}

function handleMutations(mutations: MutationRecord[]): void {
  if (!ctxValid()) {
    onContextDead();
    return;
  }
  let added = false;
  for (const m of mutations) {
    for (const n of m.addedNodes) {
      if (n instanceof Element && scanAddedElement(n)) added = true;
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
  onVideoPlay?: (video: HTMLVideoElement) => void;
}): void {
  onMediaChange = opts.onMediaChange;
  onContextDead = opts.onContextDead;
  isOwnNode = opts.isOwnNode;
  onVideoPlay = opts.onVideoPlay ?? (() => {});
  trackingController?.abort();
  trackingController = new AbortController();
  playHookedVideos = new WeakSet<HTMLVideoElement>();
  observedRoots = new WeakSet<ShadowRoot>();
  observer = new MutationObserver(handleMutations);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener(SHADOW_ROOT_ATTACHED_EVENT, handleShadowAttached, {
    capture: true,
    signal: trackingController.signal,
  });
  tracking = true;
  // Observe empty roots already present when tracking starts as well. This
  // matters after an extension reload on a long-lived SPA, where the player host
  // can predate the fresh content script and populate asynchronously afterward.
  scanTree(document, true);
}

export function stopTracking(): void {
  tracking = false;
  trackingController?.abort();
  trackingController = null;
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  for (const candidate of shadowHostCandidates) candidate.active = false;
  shadowHostCandidates.length = 0;
  shadowHostCandidateCursor = 0;
}

// Cheap backstop for the cases the observer can miss: direct media added without a
// mutation callback we saw, or a shadow root attached to a known element
// (attachShadow fires no mutation). Called from the background tick at a slow
// cadence, not per consumer call.
export function reconcile(): boolean {
  const addedDirect = scanDirectMedia(document);
  const addedShadow = scanKnownShadowHosts();
  return addedDirect || addedShadow;
}

// Read the tracked videos, dropping any that have since left the DOM (lazy prune —
// removals don't need their own mutation pass). When the registry isn't running
// (unit tests, or before index.ts wires it) fall back to a direct scan so callers
// still get a correct, synchronous answer.
export function collectVideos(): HTMLVideoElement[] {
  if (!tracking) scanTree(document);
  const out: HTMLVideoElement[] = [];
  for (const v of trackedVideos) {
    if (usableTrackedVideo(v)) out.push(v);
    else trackedVideos.delete(v);
  }
  return out;
}

export function hasVideos(): boolean {
  if (!tracking) scanTree(document);
  for (const v of trackedVideos) {
    if (usableTrackedVideo(v)) return true;
    trackedVideos.delete(v);
  }
  return false;
}

// Only used when the opt-in "speed up audio" toggle is on — see applyAll.
export function collectAudios(): HTMLAudioElement[] {
  if (!tracking) scanTree(document);
  const out: HTMLAudioElement[] = [];
  for (const a of trackedAudios) {
    if (a.isConnected && !isOwnNode(a)) out.push(a);
    else trackedAudios.delete(a);
  }
  return out;
}

// Main playback surface — what the overlay/badge anchors to.
export function primaryVideoFrom(videos: HTMLVideoElement[]): HTMLVideoElement | null {
  const candidates: { video: HTMLVideoElement; area: number }[] = [];
  let largestArea = 0;
  for (const v of videos) {
    const r = v.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) continue;
    const area = r.width * r.height;
    candidates.push({ video: v, area });
    if (area > largestArea) largestArea = area;
  }

  let best: HTMLVideoElement | null = null,
    bestScore = -1;
  const viableArea = largestArea * 0.25;
  for (const { video, area } of candidates) {
    const score = (area >= viableArea && !video.paused ? largestArea : 0) + area;
    if (score > bestScore) {
      bestScore = score;
      best = video;
    }
  }
  return best;
}

export function primaryVideo(): HTMLVideoElement | null {
  return primaryVideoFrom(collectVideos());
}

export function markDrmVideo(video: HTMLVideoElement): void {
  drmVideos.add(video);
}

export function isDrmVideo(video: HTMLVideoElement | null | undefined): boolean {
  if (!video) return false;
  return drmVideos.has(video) || video.mediaKeys != null;
}
