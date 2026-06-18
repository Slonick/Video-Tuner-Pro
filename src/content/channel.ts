// The current channel, as a stable key for the per-channel speed / sync memory.
// DOM/URL only (no storage). Returns empty off a channel page, or before the
// channel has rendered.
//
// YouTube is special: the channel lives in the player's owner link, not the URL.
// Every other supported site puts the channel login in the FIRST path segment
// (Twitch /<login>, Kick /<login>, TikTok /@<login>, …) — at any depth, so record
// /VOD pages like /<login>/videos/<id> or /<login>/playlist/<id>/video/<id> still
// resolve to <login>. The one exception is a Twitch VOD (/videos/<id>), which has
// no channel in the URL — read from the DOM.
const YT_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i;

// YouTube: the owner link under the player carries the canonical channel URL
// (/@handle or /channel/UC…); either form is a stable identifier.
const OWNER_SEL = [
  "ytd-video-owner-renderer a.yt-simple-endpoint",
  "ytd-channel-name a.yt-simple-endpoint",
  "#owner #channel-name a",
  "#upload-info #channel-name a",
].join(",");

// A "first path segment is the channel login" site. The login is the stable key
// (namespaced by `ns`); the display name comes from `nameSel`, falling back to
// the login. `reserved` lists first-segment routes that are NOT channels (so e.g.
// /directory or /settings isn't mistaken for a streamer) — not exhaustive, an
// unlisted route only matters if a value were saved there. `handle` marks sites
// whose login segment is prefixed with "@" (TikTok). `linkSel`/`linkPath` read the
// login from a DOM link on paths where the URL doesn't carry it (Twitch VOD).
interface Site {
  host: RegExp;
  ns: string;
  reserved: Set<string>;
  handle?: boolean;
  linkPath?: RegExp;
  linkSel?: string[];
  nameSel: string[];
}

const SITES: Site[] = [
  {
    host: /(^|\.)twitch\.tv$/i,
    ns: "twitch",
    reserved: new Set([
      "directory",
      "videos",
      "settings",
      "subscriptions",
      "following",
      "friends",
      "inventory",
      "wallet",
      "drops",
      "prime",
      "turbo",
      "downloads",
      "jobs",
      "store",
      "search",
      "p",
      "u",
      "team",
      "communities",
      "popout",
      "moderator",
      "payments",
      "clips",
      "collections",
      "dashboard",
      "broadcast",
    ]),
    // A VOD is /videos/<id> (no channel in the URL) — the channel link in the
    // video-info bar carries it. Best-effort hooks, then the broadcaster avatar's
    // link as a fallback (see siteLogin).
    linkPath: /^\/videos\//,
    linkSel: [
      'a[data-a-target="video-info-channel-name"]',
      'a[data-a-target="watch-channel-name"]',
      'a[data-test-selector="video-author"]',
    ],
    nameSel: [
      '[data-a-target="user-display-name"]',
      '[data-a-target="channel-header-display-name"]',
      "h1.tw-title",
    ],
  },
  {
    host: /(^|\.)kick\.com$/i,
    ns: "kick",
    reserved: new Set([
      "browse",
      "categories",
      "category",
      "following",
      "subscriptions",
      "messages",
      "search",
      "help",
      "settings",
      "account",
      "wallet",
      "clips",
      "about",
      "dashboard",
      "creator",
      "partner",
      "terms",
      "privacy",
      "careers",
      "ranking",
      "store",
    ]),
    nameSel: ['[data-testid="channel-username"]'],
  },
  {
    host: /(^|\.)vkvideo\.ru$|(^|\.)vkplay\.live$/i,
    ns: "vkvideo",
    reserved: new Set([
      "app",
      "api",
      "search",
      "following",
      "categories",
      "category",
      "top",
      "about",
      "support",
      "help",
      "settings",
      "feed",
      "promo",
    ]),
    nameSel: ['[class*="DisplayName"]', '[class*="channel-name"]'],
  },
  {
    host: /(^|\.)w\.tv$/i,
    ns: "w",
    reserved: new Set([
      "about",
      "search",
      "help",
      "login",
      "signup",
      "register",
      "terms",
      "privacy",
      "settings",
      "browse",
      "categories",
      "category",
    ]),
    nameSel: ['[class*="channel-name"]', '[class*="DisplayName"]'],
  },
  {
    host: /(^|\.)tiktok\.com$/i,
    ns: "tiktok",
    handle: true,
    reserved: new Set(),
    nameSel: ['[data-e2e="user-title"]', '[data-e2e="live-anchor-username"]'],
  },
];

function siteFor(host: string): Site | null {
  return SITES.find((s) => s.host.test(host)) ?? null;
}

// A bare login → lower-cased key, or null when empty / a reserved route.
function clean(login: string, site: Site): string | null {
  login = login.toLowerCase();
  return login && !site.reserved.has(login) ? login : null;
}

// First path segment of an href ("/<login>/…" → login), cleaned. Null otherwise.
function loginFromHref(href: string, site: Site): string | null {
  const m = href.match(/^\/([^/?#]+)/);
  return m ? clean(m[1], site) : null;
}

// The channel login from a first-path-segment site, or null when the current path
// isn't a channel page. The first segment is the login at any depth; reserved
// routes return null. Twitch VODs (no channel in the URL) fall back to a DOM link.
function siteLogin(site: Site): string | null {
  const first = window.location.pathname.split("/").filter(Boolean)[0] || "";
  if (site.handle) {
    if (first.startsWith("@")) {
      const c = clean(first.slice(1), site);
      if (c) return c;
    }
  } else if (first) {
    const c = clean(first, site);
    if (c) return c;
  }
  if (site.linkSel && (!site.linkPath || site.linkPath.test(window.location.pathname))) {
    // The video-info bar shows the broadcaster name (h1.tw-title on a Twitch VOD);
    // its lower-cased form is the login when they differ only in capitalization.
    // Only accept text shaped like a login, so a localized display name with
    // spaces/punctuation doesn't become a bogus key.
    for (const s of site.nameSel) {
      const t = document.querySelector<HTMLElement>(s)?.textContent?.trim() || "";
      if (/^[A-Za-z0-9_]{2,30}$/.test(t)) {
        const c = clean(t, site);
        if (c) return c;
      }
    }
    for (const s of site.linkSel) {
      const lg = loginFromHref(
        document.querySelector<HTMLAnchorElement>(s)?.getAttribute("href") || "",
        site,
      );
      if (lg) return lg;
    }
    // Fallback: the broadcaster avatar sits inside an anchor to /<login>.
    const a = document
      .querySelector<HTMLElement>('img[class*="avatar" i]')
      ?.closest<HTMLAnchorElement>('a[href^="/"]');
    if (a) {
      const lg = loginFromHref(a.getAttribute("href") || "", site);
      if (lg) return lg;
    }
  }
  return null;
}

// Every stable key the current channel can be addressed by. YouTube exposes BOTH
// a /channel/UC… id and a /@handle (in either DOM order) — collect both so a value
// saved under either form is matched; the id is canonical and comes first. Every
// other site has a single key: "<ns>:<login>" (login lower-cased, so /XQC and /xqc
// share one entry).
export function channelKeys(): string[] {
  const h = window.location.hostname;
  if (YT_HOST.test(h)) {
    if (window.location.pathname !== "/watch") return [];
    let id: string | null = null,
      handle: string | null = null;
    for (const a of document.querySelectorAll<HTMLAnchorElement>(OWNER_SEL)) {
      const href = a.getAttribute("href") || "";
      if (!id) {
        const m = href.match(/\/(channel\/UC[A-Za-z0-9_-]+)/);
        if (m) id = m[1];
      }
      if (!handle) {
        const m = href.match(/\/(@[A-Za-z0-9._-]+)/);
        if (m) handle = m[1];
      }
    }
    return [id, handle].filter((k): k is string => k != null);
  }
  const site = siteFor(h);
  if (site) {
    const login = siteLogin(site);
    return login ? [site.ns + ":" + login] : [];
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
  const site = siteFor(h);
  if (site) {
    for (const s of site.nameSel) {
      const t = (document.querySelector<HTMLElement>(s)?.textContent || "").trim();
      if (t && !t.startsWith("@")) return t;
    }
    return siteLogin(site) || "";
  }
  // YouTube (and the default fall-through): the display name lives in the owner link.
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
