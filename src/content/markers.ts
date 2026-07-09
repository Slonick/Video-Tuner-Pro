// Seek-bar markers for the pop-out viewer on YouTube: chapter boundaries and
// (opt-in) SponsorBlock segments.
//
// Chapters: YouTube renders each chapter as one child of its progress bar's
// .ytp-chapters-container, sized proportionally to the chapter's length — the
// one source that always reflects the CURRENT video (description JSON blobs go
// stale on SPA navigation). Titles are cosmetic: parsed from the description's
// timestamp list and applied only when the counts agree.
//
// SponsorBlock: the public API at sponsor.ajay.app, queried with the video ID
// only when the user opted in (it's a third-party request). Display-only — no
// auto-skipping.

export interface Chapter {
  start: number; // seconds
  title: string;
}

export interface SponsorSegment {
  start: number;
  end: number;
  category: string;
}

// The categories we display, with SponsorBlock's own palette.
export const SPONSOR_COLORS: Record<string, string> = {
  sponsor: "#00d400",
  selfpromo: "#ffff00",
  interaction: "#cc00ff",
  intro: "#00ffff",
  outro: "#0202ed",
  preview: "#008fd6",
  music_offtopic: "#ff9900",
};

export function isYouTube(hostname: string = location.hostname): boolean {
  return /(^|\.)youtube(-nocookie)?\.com$/.test(hostname) || hostname === "youtu.be";
}

export function hasNativeSponsorBlock(root: ParentNode = document): boolean {
  return !!(
    root.querySelector("#sponsorblock-document-script") ||
    root.querySelector("#previewbar.sbNotInvidious") ||
    root.querySelector("#sponsorBlockDurationAfterSkips")
  );
}

// The watch-page video id ("v" param, /shorts/, /embed/, youtu.be short links).
export function youTubeVideoId(href: string = location.href): string | null {
  try {
    const u = new URL(href);
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{6,})/);
    if (m) return m[1];
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1);
      if (/^[\w-]{6,}$/.test(id)) return id;
    }
  } catch (e) {
    /* fall through */
  }
  return null;
}

// "0:00 Intro" / "1:02:33 — Deep dive" lines from a description-like text.
export function parseTimestampList(text: string): Chapter[] {
  const out: Chapter[] = [];
  for (const line of text.split(/\n+/)) {
    const m = line
      .trim()
      .match(/^(?:[-–—•*·▶]\s*|\d+[.)]\s*)*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—:]?\s*(\S.*)$/);
    if (!m) continue;
    const parts = m[1].split(":").map(Number);
    const s =
      parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    out.push({ start: s, title: m[2].trim() });
  }
  // YouTube chapters always begin at 0:00; anything else is just prose with
  // times in it. Keep the list only when it looks like a real chapter list.
  if (out.length < 2 || out[0].start !== 0) return [];
  for (let i = 1; i < out.length; i++) {
    if (out[i].start <= out[i - 1].start) return [];
  }
  return out;
}

function cleanChapterTitle(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[-–—•*·▶\s]+/, "")
    .trim();
}

function chapterTitleFromElement(el: Element): string {
  for (const attr of ["title", "aria-label", "data-title"]) {
    const title = cleanChapterTitle(el.getAttribute(attr));
    if (title) return title;
  }
  const titleEl = el.querySelector(
    ".ytp-chapter-title-content,.ytp-chapter-title,[class*='chapter'][class*='title'],[aria-label],[title]",
  );
  if (!titleEl) return "";
  return cleanChapterTitle(
    titleEl.getAttribute("title") || titleEl.getAttribute("aria-label") || titleEl.textContent,
  );
}

function descriptionText(root: ParentNode): string {
  return (
    [
      "#description-inline-expander",
      "#description",
      "ytd-watch-metadata",
      "ytd-video-secondary-info-renderer",
      "ytd-expandable-video-description-body-renderer",
    ]
      .map((sel) => root.querySelector(sel)?.textContent ?? "")
      .find((text) => parseTimestampList(text).length > 0) ?? ""
  );
}

function titleForStart(titled: Chapter[], start: number): string {
  const hit = titled.find((ch) => Math.abs(ch.start - start) <= 1);
  return hit?.title ?? "";
}

// Chapter start times from the player's own progress bar: each container child
// is one chapter, width ∝ length. Returns [] when there's one chapter (no real
// chapters) or the widths don't add up.
export function chapterStartsFromWidths(widths: number[], duration: number): number[] {
  if (widths.length < 2 || !Number.isFinite(duration) || duration <= 0) return [];
  const total = widths.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const starts: number[] = [];
  let acc = 0;
  for (const w of widths) {
    starts.push((acc / total) * duration);
    acc += w;
  }
  return starts;
}

// Chapters of the current YouTube video: boundaries from the player DOM,
// titles from that DOM when exposed, otherwise from timestamp lists in metadata.
export function readYouTubeChapters(duration: number, root: ParentNode = document): Chapter[] {
  const els = Array.from(root.querySelectorAll(".ytp-chapters-container > *"));
  const widths = els.map((el) => el.getBoundingClientRect().width);
  const starts = chapterStartsFromWidths(widths, duration);
  if (!starts.length) return [];
  const domTitles = els.map(chapterTitleFromElement);
  const titled = parseTimestampList(descriptionText(root));
  return starts.map((s, i) => ({
    start: s,
    title: domTitles[i] || titleForStart(titled, s),
  }));
}

const sponsorCache = new WeakMap<typeof fetch, Map<string, Promise<SponsorSegment[]>>>();
const MAX_SPONSOR_CACHE = 32;

// SponsorBlock's public segments for a video; [] on 404/errors/timeouts. The
// API answers with open CORS, so a plain content-script fetch works.
export async function fetchSponsorSegments(
  videoId: string,
  fetchFn: typeof fetch = fetch,
): Promise<SponsorSegment[]> {
  let cache = sponsorCache.get(fetchFn);
  if (!cache) {
    cache = new Map();
    sponsorCache.set(fetchFn, cache);
  }
  const cached = cache.get(videoId);
  if (cached) return cached;
  if (cache.size >= MAX_SPONSOR_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  const promise = fetchSponsorSegmentsUncached(videoId, fetchFn).catch(() => {
    cache.delete(videoId);
    return [];
  });
  cache.set(videoId, promise);
  return promise;
}

async function fetchSponsorSegmentsUncached(
  videoId: string,
  fetchFn: typeof fetch,
): Promise<SponsorSegment[]> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer =
    controller && typeof setTimeout === "function"
      ? setTimeout(() => controller.abort(), 1500)
      : null;
  try {
    const cats = encodeURIComponent(JSON.stringify(Object.keys(SPONSOR_COLORS)));
    const resp = await fetchFn(
      `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${cats}`,
      {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        ...(controller ? { signal: controller.signal } : {}),
      },
    );
    if (!resp.ok) return [];
    const data = (await resp.json()) as Array<{ segment?: [number, number]; category?: string }>;
    if (!Array.isArray(data)) return [];
    return data
      .filter((d) => Array.isArray(d.segment) && d.segment.length === 2 && d.category)
      .map((d) => ({ start: d.segment![0], end: d.segment![1], category: d.category! }));
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}
