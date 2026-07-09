// The on-video badge rendered with React into a shadow root (so page CSS can't
// touch it). React renders only the static structure — the div, the text span and
// the pin span — and exposes them via refs. All behaviour (positioning, drag,
// auto-hide, pin toggle) stays imperative in overlay.ts, wired as native
// listeners on these refs: that keeps event ordering identical to the original
// (a pin click must not bubble into a badge drag, which React's delegated events
// would not guarantee).
import type { CSSProperties } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ensureGlassFilter, GLASS_REFRACTION } from "../../shared/glass.js";

export const BADGE_HOST_ID = "vtp-badge-host";

const BADGE_STYLE: CSSProperties = {
  position: "fixed",
  zIndex: 2147483646,
  pointerEvents: "none",
  cursor: "grab",
  touchAction: "none",
  userSelect: "none",
  display: "flex",
  alignItems: "center",
  font: "600 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif",
  color: "#fff",
  // Liquid glass over the video: a translucent dark tint heavily blurred +
  // saturated/brightened so the moving video refracts through it, hairline edge.
  background: "rgb(20 20 22 / calc(0.32 * var(--glass-opacity, 1)))",
  padding: "10px 16px",
  borderRadius: "13px",
  boxShadow: "0 0 0 1px rgba(255,255,255,0.14)",
  whiteSpace: "nowrap",
  opacity: 0,
  transition: "opacity .25s",
  WebkitBackdropFilter: GLASS_REFRACTION + "blur(7px) saturate(180%) brightness(1.04)",
  backdropFilter: GLASS_REFRACTION + "blur(7px) saturate(180%) brightness(1.04)",
};

// Small red dot left of the speed, shown only on live streams (the value that
// follows is latency/buffer); a regular video shows remaining time and no dot.
// Visibility is toggled imperatively in overlay.ts; kept a non-<span> so the
// badge's text stays the first/only <span> the tests and queries reach for.
const DOT_STYLE: CSSProperties = {
  display: "none",
  width: "7px",
  height: "7px",
  borderRadius: "50%",
  marginRight: "6px",
  flexShrink: 0,
  background: "#ff453a",
};

const PIN_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "15px",
  height: "15px",
  margin: "-2px -3px -2px 3px",
  cursor: "pointer",
  color: "#fff",
  transition: "opacity .15s,transform .15s",
};

const NOTICE_STYLE: CSSProperties = {
  position: "absolute",
  left: "calc(100% + 8px)",
  top: "50%",
  padding: "8px 11px",
  borderRadius: "999px",
  background: "rgb(20 20 22 / calc(0.34 * var(--glass-opacity, 1)))",
  boxShadow: "0 0 0 1px rgba(255,255,255,0.16),0 14px 36px rgba(0,0,0,0.24)",
  WebkitBackdropFilter: GLASS_REFRACTION + "blur(7px) saturate(180%) brightness(1.04)",
  backdropFilter: GLASS_REFRACTION + "blur(7px) saturate(180%) brightness(1.04)",
  opacity: 0,
  pointerEvents: "none",
  transform: "translate(-18px, -50%) scale(.36)",
  transformOrigin: "left center",
  transition: "opacity .2s, transform .34s cubic-bezier(.16,1,.3,1)",
};

const BADGE_KEYFRAMES = `
@keyframes vtp-badge-notice-in {
  0% { opacity: 0; transform: translate(-22px, -50%) scale(.24); }
  62% { opacity: 1; transform: translate(3px, -50%) scale(1.04); }
  100% { opacity: 1; transform: translate(0, -50%) scale(1); }
}
`;

interface Props {
  divRef: (n: HTMLDivElement | null) => void;
  dotRef: (n: HTMLElement | null) => void;
  textRef: (n: HTMLSpanElement | null) => void;
  pinRef: (n: HTMLSpanElement | null) => void;
  noticeRef: (n: HTMLSpanElement | null) => void;
}

function Badge({ divRef, dotRef, textRef, pinRef, noticeRef }: Props) {
  return (
    <div ref={divRef} style={BADGE_STYLE}>
      <i ref={dotRef} style={DOT_STYLE} aria-hidden="true"></i>
      <span ref={textRef}></span>
      <span ref={pinRef} role="button" tabIndex={0} style={PIN_STYLE}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
          <path d="M16 9V4h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
        </svg>
      </span>
      <span ref={noticeRef} style={NOTICE_STYLE}></span>
    </div>
  );
}

export interface BadgeRefs {
  host: HTMLDivElement; // shadow host (light DOM) — re-parented + marked for cleanup
  el: HTMLDivElement; // the badge itself (inside the shadow root)
  dotEl: HTMLElement; // video/stream indicator dot
  textEl: HTMLSpanElement; // speed/time text
  pinEl: HTMLSpanElement; // pin button
  noticeEl: HTMLSpanElement; // transient playback notice bubble
}

// Create the shadow host, render the badge into it synchronously, and hand the
// nodes back so overlay.ts can drive them imperatively.
export function mountBadge(): BadgeRefs {
  const host = document.createElement("div");
  host.id = BADGE_HOST_ID;
  host.setAttribute("data-vtp-badge", ""); // marker (light DOM) so a re-injected instance removes a leftover
  // Render straight into the shadow root (no wrapper element) so the badge is its
  // only child — overlay.ts and the tests can find it as the shadow's lone div.
  const shadow = host.attachShadow({ mode: "open" });

  let el: HTMLDivElement | null = null;
  let dotEl: HTMLElement | null = null;
  let textEl: HTMLSpanElement | null = null;
  let pinEl: HTMLSpanElement | null = null;
  let noticeEl: HTMLSpanElement | null = null;
  flushSync(() =>
    createRoot(shadow).render(
      <Badge
        divRef={(n) => {
          el = n;
        }}
        dotRef={(n) => {
          dotEl = n;
        }}
        textRef={(n) => {
          textEl = n;
        }}
        pinRef={(n) => {
          pinEl = n;
        }}
        noticeRef={(n) => {
          noticeEl = n;
        }}
      />,
    ),
  );
  // Inject our liquid-glass displacement filter into this shadow (the badge is
  // static and never re-renders, so React won't remove this trailing node). It's
  // not a <div>, so overlay.ts/tests still find the badge via querySelector("div").
  ensureGlassFilter(shadow);
  const style = document.createElement("style");
  style.textContent = BADGE_KEYFRAMES;
  shadow.append(style);
  return { host, el: el!, dotEl: dotEl!, textEl: textEl!, pinEl: pinEl!, noticeEl: noticeEl! };
}
