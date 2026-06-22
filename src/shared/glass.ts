// Our own liquid-glass effect — no library. An SVG displacement filter that, when
// referenced from `backdrop-filter`, refracts the content behind an element like
// real glass (the turbulence map bends the backdrop; pair it with blur + saturate).
// Works anywhere: inject the filter into the popup document OR a content-script
// shadow root, then style the element with
//   backdrop-filter: blur(..) saturate(..) url(#vtp-glass);
export const GLASS_FILTER_ID = "vtp-glass";

// User-tunable glass opacity (General settings). A multiplier on every glass tint's
// alpha (tokens.css fills + the content-script inline surfaces all read
// `--glass-opacity`), so one value scales the whole glass from sheer to solid.
export const GLASS_OPACITY_KEY = "glassOpacity";
export const DEFAULT_GLASS_OPACITY = 1;
export const GLASS_OPACITY_MIN = 0.3;
export const GLASS_OPACITY_MAX = 1.4;

export function clampGlassOpacity(raw: unknown): number {
  const n = Number(raw);
  if (Number.isNaN(n)) return DEFAULT_GLASS_OPACITY;
  return Math.min(GLASS_OPACITY_MAX, Math.max(GLASS_OPACITY_MIN, n));
}

// Set the multiplier on an element (documentElement for pages, the shadow host for
// the on-video badge/launcher) so it cascades to every glass surface under it.
export function applyGlassOpacity(el: HTMLElement, v: number): void {
  el.style.setProperty("--glass-opacity", String(v));
}

// The SVG-filter refraction, as a backdrop-filter token — but ONLY where the engine
// actually renders an `url(#…)` inside backdrop-filter. Firefox parses it as valid
// (so CSS.supports can't tell) yet drops the WHOLE backdrop-filter at paint time,
// which kills the blur too. Gate it off there so Gecko still gets blur+saturate
// (just no liquid ripple); Chromium keeps the full effect.
const SUPPORTS_REFRACTION =
  typeof navigator === "undefined" || !/\bGecko\/|firefox/i.test(navigator.userAgent);
export const GLASS_REFRACTION = SUPPORTS_REFRACTION ? ` url(#${GLASS_FILTER_ID})` : "";

// scale = refraction strength, baseFrequency = ripple size. Tweak to taste.
const FILTER_SVG =
  `<svg aria-hidden="true" style="position:absolute;width:0;height:0;pointer-events:none">` +
  `<filter id="${GLASS_FILTER_ID}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">` +
  `<feTurbulence type="fractalNoise" baseFrequency="0.01 0.01" numOctaves="2" seed="7" result="noise"/>` +
  `<feGaussianBlur in="noise" stdDeviation="1.5" result="soft"/>` +
  `<feDisplacementMap in="SourceGraphic" in2="soft" scale="50" xChannelSelector="R" yChannelSelector="G"/>` +
  `</filter></svg>`;

// Card backdrop-filter, applied at runtime: lightningcss strips `url(#…)` out of
// backdrop-filter in the BUILT css, so the displacement must be (re)added here
// where it survives. The blur/saturate stay tunable via the same tokens.
const CARD_RULE =
  `.sync-section,.card,.meter canvas{` +
  `-webkit-backdrop-filter:blur(var(--card-blur)) saturate(var(--glass-saturate))!important;` +
  `backdrop-filter:blur(var(--card-blur)) saturate(var(--glass-saturate))${GLASS_REFRACTION}!important;}`;

// Inject the filter once into a document or shadow root (idempotent). For a
// Document we also inject CARD_RULE so the popup/options cards get the refraction
// that lightningcss dropped; shadow-root callers (badge/FAB) set it inline.
export function ensureGlassFilter(root: Document | ShadowRoot): void {
  if (root.querySelector(`#${GLASS_FILTER_ID}`)) return;
  // DOMParser, not innerHTML: the AMO linter flags every innerHTML assignment, and
  // this filter is a static, trusted SVG string anyway. parseFromString builds it in
  // the SVG namespace; appendChild adopts the node into the target document.
  const svg = new DOMParser().parseFromString(FILTER_SVG, "image/svg+xml").documentElement;
  if (!svg || svg.tagName === "parsererror") return;
  const host = root instanceof Document ? (root.body ?? root.documentElement) : root;
  host.appendChild(svg);
  if (root instanceof Document) {
    const style = document.createElement("style");
    style.textContent = CARD_RULE;
    (root.head ?? host).appendChild(style);
  }
}
