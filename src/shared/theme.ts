// Theme preference shared by the popup and options pages. "system" follows the OS
// (the prefers-color-scheme rules in tokens.css); "light"/"dark" force a palette
// via a data-theme attribute on <html> that those rules key off. The on-video
// badge is numbers-only and self-styled, so it isn't themed.
import { STORE } from "./store.js";

export type Theme = "system" | "light" | "dark";
export const THEMES: Theme[] = ["system", "light", "dark"];

export function applyTheme(theme: Theme): void {
  const el = document.documentElement;
  if (theme === "light" || theme === "dark") el.dataset.theme = theme;
  else delete el.dataset.theme;
}

// Read the saved theme and apply it. Called as early as possible on each page to
// keep the flash from the default (system) palette short.
//
// In the on-video overlay iframe two things must be decoupled (the launcher passes
// both as `#vtp-<host>-<os>`):
//   • color-scheme MUST match the HOST's used scheme, or Chrome paints an opaque
//     backdrop and the glass goes solid — set it explicitly so the panel stays
//     transparent on any site (incl. ones that force a scheme via <meta>);
//   • the glass THEME follows the OS, independent of that — so "system" uses the
//     passed OS scheme rather than the iframe's own (unreliable) prefers-color-scheme.
export function initTheme(): void {
  const m = window.parent !== window && /^#vtp-(light|dark)-(light|dark)$/.exec(location.hash);
  if (m) document.documentElement.style.colorScheme = m[1]; // match host → transparent
  STORE.get(["theme"], (r) => {
    const theme = (r.theme as Theme) || "system";
    if (theme === "system" && m) {
      document.documentElement.dataset.theme = m[2]; // glass follows the OS
    } else {
      applyTheme(theme);
    }
  });
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  STORE.set({ theme });
}
