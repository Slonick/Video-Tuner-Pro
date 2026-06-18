// Imperative card-expand animations, kept as plain DOM functions so the React
// Section/SpeedCard components can invoke them via refs (the idiomatic way to run
// measure-then-animate work React can't express declaratively). Behaviour is
// unchanged from the original sections.ts.

// Scroll the expanding body into view in sync with the CSS max-height transition.
// Reading the section's live bottom each frame self-corrects for the growing
// body + margin/padding; the last frame closes the full gap so it never stops short.
export function revealOnExpand(sec: Element): void {
  const root = document.scrollingElement || document.documentElement;
  const DUR = 480,
    MARGIN = 12,
    vh = window.innerHeight;
  let start: number | null = null;
  function step(now: number): void {
    if (start === null) start = now;
    const last = now - start >= DUR;
    const below = sec.getBoundingClientRect().bottom - vh + MARGIN;
    const room = root.scrollHeight - vh - root.scrollTop;
    if (below > 0 && room > 0) root.scrollTop += Math.min(below, room) * (last ? 1 : 0.25);
    if (!last) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// FLIP-animate the preset grid as it gains/loses the extra buttons: the shared
// four glide from their old slots to the new ones, the extras ease in/out. Split
// into capture (before React re-renders / changes layout) and animate (in a layout
// effect, after the DOM reflects the new .open state).
export type GridRects = Map<HTMLElement, DOMRect>;

export function captureGridRects(grid: HTMLElement | null): GridRects {
  const first: GridRects = new Map();
  if (!grid) return first;
  for (const b of grid.querySelectorAll<HTMLElement>(".btn-speed")) {
    if (b.offsetParent !== null) first.set(b, b.getBoundingClientRect());
  }
  return first;
}

export function animateGridFrom(grid: HTMLElement | null, first: GridRects): void {
  if (!grid) return;
  const buttons = Array.from(grid.querySelectorAll<HTMLElement>(".btn-speed"));
  const DUR = 300;
  for (const b of buttons) {
    if (b.offsetParent === null) continue; // hidden extra (closing) — nothing to animate
    b.style.transition = "none";
    const fr = first.get(b);
    if (fr) {
      const lr = b.getBoundingClientRect();
      b.style.transform = `translate(${Math.round(fr.left - lr.left)}px, ${Math.round(fr.top - lr.top)}px)`;
    } else {
      b.style.transform = "scale(0.8)"; // newly-shown extra
      b.style.opacity = "0";
    }
  }
  void grid.offsetWidth; // commit the inverted state
  for (const b of buttons) {
    if (b.offsetParent === null) continue;
    b.style.transition = `transform ${DUR}ms ease, opacity ${DUR}ms ease`;
    b.style.transform = "";
    b.style.opacity = "";
  }
  window.setTimeout(() => {
    for (const b of buttons) {
      b.style.transition = "";
      b.style.transform = "";
      b.style.opacity = "";
    }
  }, DUR + 60);
}
