// Typed element lookup — the popup's markup is fixed, so a missing id is a bug;
// we assert non-null and let the caller pick the concrete element type.
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
