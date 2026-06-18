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
  background: "rgba(0,0,0,0.55)",
  padding: "5px 9px",
  borderRadius: "6px",
  whiteSpace: "nowrap",
  opacity: 0,
  transition: "opacity .25s",
  WebkitBackdropFilter: "blur(3px)",
  backdropFilter: "blur(3px)",
};

// Small dot left of the speed: its colour says whether the value that follows is
// for a live stream (latency/buffer) or a regular video (remaining time). The
// colour is set imperatively in overlay.ts; kept a non-<span> so the badge's text
// stays the first/only <span> the tests and queries reach for.
const DOT_STYLE: CSSProperties = {
  display: "inline-block",
  width: "7px",
  height: "7px",
  borderRadius: "50%",
  marginRight: "6px",
  flexShrink: 0,
  background: "#0a84ff",
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

interface Props {
  divRef: (n: HTMLDivElement | null) => void;
  dotRef: (n: HTMLElement | null) => void;
  textRef: (n: HTMLSpanElement | null) => void;
  pinRef: (n: HTMLSpanElement | null) => void;
}

function Badge({ divRef, dotRef, textRef, pinRef }: Props) {
  return (
    <div ref={divRef} style={BADGE_STYLE}>
      <i ref={dotRef} style={DOT_STYLE} aria-hidden="true"></i>
      <span ref={textRef}></span>
      <span ref={pinRef} role="button" style={PIN_STYLE}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
          <path d="M16 9V4h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
        </svg>
      </span>
    </div>
  );
}

export interface BadgeRefs {
  host: HTMLDivElement; // shadow host (light DOM) — re-parented + marked for cleanup
  el: HTMLDivElement; // the badge itself (inside the shadow root)
  dotEl: HTMLElement; // video/stream indicator dot
  textEl: HTMLSpanElement; // speed/time text
  pinEl: HTMLSpanElement; // pin button
}

// Create the shadow host, render the badge into it synchronously, and hand the
// nodes back so overlay.ts can drive them imperatively.
export function mountBadge(): BadgeRefs {
  const host = document.createElement("div");
  host.setAttribute("data-vtp-badge", ""); // marker (light DOM) so a re-injected instance removes a leftover
  // Render straight into the shadow root (no wrapper element) so the badge is its
  // only child — overlay.ts and the tests can find it as the shadow's lone div.
  const shadow = host.attachShadow({ mode: "open" });

  let el: HTMLDivElement | null = null;
  let dotEl: HTMLElement | null = null;
  let textEl: HTMLSpanElement | null = null;
  let pinEl: HTMLSpanElement | null = null;
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
      />,
    ),
  );
  return { host, el: el!, dotEl: dotEl!, textEl: textEl!, pinEl: pinEl! };
}
