// Per-site key derivation. MUST match the content script's getDomain(): strip a
// leading "www." / "m." so the popup reads/writes the same key the page does.
export function normalizeHost(host: string | null | undefined): string {
  return (host || "").replace(/^(?:www|m)\./i, "");
}
