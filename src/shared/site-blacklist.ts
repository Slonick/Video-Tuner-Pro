// Per-site kill switch: hostnames (stored under SITE_BLACKLIST_KEY) where the
// extension stays completely off. Pure helpers shared by the content script (is this
// page disabled?), the popup's "Disable on this site" switch and the options editor.
// Entries are normalized once on the way in, so matching stays a plain string compare.

export const SITE_BLACKLIST_KEY = "siteBlacklist";

// Anything the user may type or paste (bare host, full URL, host:port, *.host) →
// the canonical host, or null for what isn't one. The URL parser yields the same
// lowercase, punycode hostname `location.hostname` does, and a leading www./m. is
// dropped exactly like content/core/domain.ts normalizeHost does for the page host.
export function normalizeSiteEntry(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  let host: string;
  try {
    host = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `http://${text}`).hostname;
  } catch {
    return null;
  }
  host = host
    .replace(/^\*\./, "")
    .replace(/\.$/, "")
    .replace(/^(?:www|m)\./, "");
  // The parser accepts far more than a real host (commas, "$", …) — keep what DNS or
  // an IP literal could actually name.
  return /^(?:\[[\da-f:.]+\]|[a-z\d_-]+(?:\.[a-z\d_-]+)*)$/.test(host) ? host : null;
}

// A stored value or an edited list → deduped canonical entries in first-seen order.
// Non-lists and unusable items are dropped, so a hand-edited backup can't break matching.
export function normalizeSiteList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const hosts = raw.map(normalizeSiteEntry).filter((host): host is string => host !== null);
  return [...new Set(hosts)];
}

// An entry covers its own host and every subdomain of it: `youtube.com` switches the
// extension off on `music.youtube.com` too, but `music.youtube.com` never reaches
// `youtube.com`. The leading dot keeps `notyoutube.com` out.
const covers = (entry: string, domain: string) => domain === entry || domain.endsWith(`.${entry}`);

// The entry that switches the extension off on `domain` (the page's already
// normalized host), or null. Callers pass a list from normalizeSiteList.
export function matchingSite(domain: string, list: readonly string[]): string | null {
  return domain ? (list.find((entry) => covers(entry, domain)) ?? null) : null;
}

export function isSiteBlacklisted(domain: string, list: readonly string[]): boolean {
  return matchingSite(domain, list) !== null;
}

export function blockSite(list: readonly string[], domain: string): string[] {
  return normalizeSiteList([...list, domain]);
}

// Switching a site back on removes whatever switches it off — its own entry or a parent
// domain's (there is no way to carve an exception out of a covering entry).
export function allowSite(list: readonly string[], domain: string): string[] {
  return list.filter((entry) => !covers(entry, domain));
}
