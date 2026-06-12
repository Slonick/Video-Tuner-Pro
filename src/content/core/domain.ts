// Strip a leading "www." / "m." so a site shares one setting across its
// bare/www/mobile hosts (www.twitch.tv → twitch.tv). We do NOT collapse to the
// registrable domain (that would wrongly merge genuinely distinct subdomains
// like docs./mail.google.com or *.github.io tenants).
export function normalizeHost(host: string | null | undefined): string {
  return (host || "").replace(/^(?:www|m)\./i, "");
}

export function getDomain(): string {
  return normalizeHost(window.location.hostname);
}
