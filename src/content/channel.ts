// The current channel, as a stable key for the per-channel speed / sync memory.
// DOM/URL only (no storage). Supports YouTube (owner link under a watch page) and
// Twitch (the login is the single path segment of a channel page). Returns empty
// off a channel page, or before the channel has rendered.
const YT_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i;
const TW_HOST = /(^|\.)twitch\.tv$/i;

// YouTube: the owner link under the player carries the canonical channel URL
// (/@handle or /channel/UC…); either form is a stable identifier.
const OWNER_SEL = [
  "ytd-video-owner-renderer a.yt-simple-endpoint",
  "ytd-channel-name a.yt-simple-endpoint",
  "#owner #channel-name a",
  "#upload-info #channel-name a",
].join(",");

// Twitch single-segment paths that are NOT channels (so e.g. /directory or
// /settings doesn't get mistaken for a streamer). Not exhaustive — an unlisted
// route would only matter if a value were saved there.
const TW_RESERVED = new Set([
  "directory", "videos", "settings", "subscriptions", "following", "friends",
  "inventory", "wallet", "drops", "prime", "turbo", "downloads", "jobs", "store",
  "search", "p", "u", "team", "communities", "popout", "moderator", "payments",
  "clips", "collections", "dashboard", "broadcast",
]);

function twitchLogin(): string | null {
  const seg = window.location.pathname.split("/").filter(Boolean);
  if (seg.length !== 1) return null;          // a channel's live page is /<login>
  const login = seg[0].toLowerCase();
  return TW_RESERVED.has(login) ? null : login;
}

// Every stable key the current channel can be addressed by. YouTube exposes BOTH
// a /channel/UC… id and a /@handle (in either DOM order) — collect both so a value
// saved under either form is matched; the id is canonical and comes first. Twitch
// has a single key: "twitch:<login>".
export function channelKeys(): string[] {
  const h = window.location.hostname;
  if (YT_HOST.test(h)) {
    if (window.location.pathname !== "/watch") return [];
    let id: string | null = null, handle: string | null = null;
    for (const a of document.querySelectorAll<HTMLAnchorElement>(OWNER_SEL)) {
      const href = a.getAttribute("href") || "";
      if (!id) { const m = href.match(/\/(channel\/UC[A-Za-z0-9_-]+)/); if (m) id = m[1]; }
      if (!handle) { const m = href.match(/\/(@[A-Za-z0-9._-]+)/); if (m) handle = m[1]; }
    }
    return [id, handle].filter((k): k is string => k != null);
  }
  if (TW_HOST.test(h)) {
    const login = twitchLogin();
    return login ? ["twitch:" + login] : [];
  }
  return [];
}

// The canonical channel key (for saving + change-tracking): the stable id when
// present, else the handle / login. A value saved under the other form is still
// matched at lookup, so it survives whichever link the page happens to expose.
export function currentChannel(): string | null {
  return channelKeys()[0] ?? null;
}

// The channel's display name (not the @handle / login), for the popup header.
export function currentChannelName(): string {
  const h = window.location.hostname;
  if (TW_HOST.test(h)) {
    const sels = ['[data-a-target="user-display-name"]', '[data-a-target="channel-header-display-name"]', "h1.tw-title"];
    for (const s of sels) {
      const t = (document.querySelector<HTMLElement>(s)?.textContent || "").trim();
      if (t) return t;
    }
    return twitchLogin() || "";
  }
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
