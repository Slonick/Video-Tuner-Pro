// The current YouTube channel, as a stable key for the per-channel speed memory.
// DOM-only: the owner link under a watch-page player carries the canonical
// channel URL (/@handle or /channel/UC…); either form is a stable identifier.
// Returns null off a YouTube watch page or before the owner link has rendered.
const OWNER_SEL = [
  "ytd-video-owner-renderer a.yt-simple-endpoint",
  "ytd-channel-name a.yt-simple-endpoint",
  "#owner #channel-name a",
  "#upload-info #channel-name a",
].join(",");

// Every stable key the current channel can be addressed by. The owner section
// exposes BOTH a /channel/UC… id link and a /@handle link, in either DOM order —
// so a plain querySelector(OWNER_SEL) returned whichever came first, flipping the
// key between renders and losing a speed saved under the other form. Collect both
// instead; the id is canonical (handles can change) and comes first.
// Empty off a YouTube watch page, or before the owner link has rendered.
export function channelKeys(): string[] {
  const h = window.location.hostname;
  if (!/(^|\.)(youtube\.com|youtube-nocookie\.com)$/i.test(h)) return [];
  if (window.location.pathname !== "/watch") return [];
  let id: string | null = null, handle: string | null = null;
  for (const a of document.querySelectorAll<HTMLAnchorElement>(OWNER_SEL)) {
    const href = a.getAttribute("href") || "";
    if (!id) { const m = href.match(/\/(channel\/UC[A-Za-z0-9_-]+)/); if (m) id = m[1]; }
    if (!handle) { const m = href.match(/\/(@[A-Za-z0-9._-]+)/); if (m) handle = m[1]; }
  }
  return [id, handle].filter((k): k is string => k != null);
}

// The canonical channel key (for saving + change-tracking): the stable id when
// present, else the handle. A speed saved under the other form is still matched
// at lookup, so it survives whichever link YouTube happens to expose.
export function currentChannel(): string | null {
  return channelKeys()[0] ?? null;
}

// The channel's display name (not the @handle), for the popup header. The owner
// section carries both; pick the first candidate whose text isn't a handle.
export function currentChannelName(): string {
  const sels = [
    "ytd-video-owner-renderer ytd-channel-name a",
    "ytd-watch-metadata #owner #channel-name a",
    "#owner #channel-name a",
    "#upload-info #channel-name a",
  ];
  for (const s of sels) {
    const t = (document.querySelector<HTMLElement>(s)?.textContent || "").trim();
    if (t && !t.startsWith("@")) return t;
  }
  return "";
}
