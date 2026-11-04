import { api } from "../platform/browser.js";

// Strip a leading "www." / "m." so a site shares one setting across its
// bare/www/mobile hosts (www.twitch.tv → twitch.tv). We do NOT collapse to the
// registrable domain (that would wrongly merge genuinely distinct subdomains
// like docs./mail.google.com or *.github.io tenants).
export function normalizeHost(host: string | null | undefined): string {
  return (host || "").replace(/^(?:www|m)\./i, "");
}

type WhoamiReply = { tab?: { url?: string } } | null | undefined;

// The tab's host as reported by the background, for a subframe that can't read it.
let reportedDomain: string | null = null;
const domainWaiters: Array<() => void> = [];

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return normalizeHost(new URL(url).hostname);
  } catch {
    return null; // an opaque "null" origin
  }
}

function ownHost(): string {
  return normalizeHost(window.location.hostname);
}

// The tab's host, or null while unknown: the top frame's own; in a subframe the top
// origin from ancestorOrigins (missing before Firefox 148, "null" where the embedder's
// referrer policy hides it), else what the background reported.
function knownDomain(): string | null {
  if (window.top === window) return ownHost();
  const origins: DOMStringList | undefined = window.location.ancestorOrigins;
  return (origins?.length ? hostOf(origins[origins.length - 1]) : null) ?? reportedDomain;
}

// The site this frame's settings and blacklist entry belong to: the TAB's host, the
// one the popup shows and saves under. An embedded player follows the page embedding
// it (a youtube.com iframe on news.example is news.example), so switching a page off
// covers its embeds and a youtube.com entry leaves YouTube embeds elsewhere alone.
// The frame's own host stands in until (or unless) the background reports the tab's.
export function getDomain(): string {
  return knownDomain() ?? ownHost();
}

// Run cb once getDomain() has settled: at once when the frame can tell its tab's host
// itself, otherwise after the background answers a single whoami (from sender.tab.url).
export function whenDomainReady(cb: () => void): void {
  if (knownDomain() !== null) {
    cb();
    return;
  }
  domainWaiters.push(cb);
  if (domainWaiters.length > 1) return; // already asked
  let settled = false;
  const finish = (reply: WhoamiReply) => {
    if (settled) return;
    settled = true;
    void api.runtime.lastError;
    reportedDomain = hostOf(reply?.tab?.url) ?? ownHost();
    while (domainWaiters.length) domainWaiters.shift()!();
  };
  try {
    const result = api.runtime.sendMessage({ action: "whoami" }, finish) as unknown as
      | Promise<WhoamiReply>
      | undefined;
    if (result && typeof result.then === "function") {
      void result.then(finish, () => finish(null));
    }
  } catch {
    finish(null);
  }
}
