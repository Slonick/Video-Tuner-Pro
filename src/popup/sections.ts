import { STORE } from "./platform/storage.js";

// Scroll the expanding body into view in sync with the CSS max-height transition.
// Reading the section's live bottom each frame self-corrects for the growing
// body + margin/padding; the last frame closes the full gap so it never stops short.
function revealOnExpand(el: Element): void {
  const root = document.scrollingElement || document.documentElement;
  const sec = el.closest(".sync-section") || el;
  const DUR = 480, MARGIN = 12, vh = window.innerHeight;
  let start: number | null = null;
  function step(now: number): void {
    if (start === null) start = now;
    const last = now - start >= DUR;
    const below = sec.getBoundingClientRect().bottom - vh + MARGIN;
    const room = (root.scrollHeight - vh) - root.scrollTop;
    if (below > 0 && room > 0) root.scrollTop += Math.min(below, room) * (last ? 1 : 0.25);
    if (!last) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// FLIP-animate the preset grid as it gains/loses the extra buttons: the shared
// four glide from their old slots to the new ones, the extras ease in/out. The
// layout change itself is done by `apply()` (toggling .open → the :has CSS shows
// the extras); we just measure positions around it and animate the delta.
function flipPresetGrid(apply: () => void): void {
  const grid = document.querySelector<HTMLElement>(".presetgrid");
  if (!grid) { apply(); return; }
  const buttons = Array.from(grid.querySelectorAll<HTMLElement>(".btn-speed"));
  const DUR = 300;
  const first = new Map<HTMLElement, DOMRect>();
  for (const b of buttons) if (b.offsetParent !== null) first.set(b, b.getBoundingClientRect());

  apply(); // layout changes here

  for (const b of buttons) {
    if (b.offsetParent === null) continue; // hidden extra (closing) — nothing to animate
    b.style.transition = "none";
    const fr = first.get(b);
    if (fr) {
      const lr = b.getBoundingClientRect();
      b.style.transform = `translate(${Math.round(fr.left - lr.left)}px, ${Math.round(fr.top - lr.top)}px)`;
    } else {
      b.style.transform = "scale(0.8)";  // newly-shown extra
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
    for (const b of buttons) { b.style.transition = ""; b.style.transform = ""; b.style.opacity = ""; }
  }, DUR + 60);
}

function toggleSection(btn: HTMLElement): void {
  const body = btn.dataset.target ? document.getElementById(btn.dataset.target) : null;
  if (!body) return;
  const apply = () => {
    const open = body.classList.toggle("open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) revealOnExpand(body);
    else body.style.overflow = "";   // clip again (CSS hidden) while it collapses
  };
  if (body.id === "speedBody") flipPresetGrid(apply);
  else apply();
}

// A collapsed body clips with overflow:hidden (for the max-height animation).
// Once it's fully open, drop the clip so an in-body info tooltip can overflow the
// body instead of being cut off at its edge.
document.querySelectorAll<HTMLElement>(".sync-body").forEach((body) => {
  body.addEventListener("transitionend", (e) => {
    if (e.propertyName === "max-height" && body.classList.contains("open")) {
      body.style.overflow = "visible";
    }
  });
});

// Auto-expand a section the first time it's switched on so the user sees its
// settings; a persistent flag ensures this happens only once, ever.
export function autoExpandOnFirstEnable(enabled: boolean, bodyId: string, seenKey: string): void {
  if (!enabled) return;
  STORE.get([seenKey], (r) => {
    if (r[seenKey]) return;
    const body = document.getElementById(bodyId);
    if (!body) return;
    body.classList.add("open");
    const btn = document.querySelector('.sec-main[data-target="' + bodyId + '"]');
    if (btn) btn.setAttribute("aria-expanded", "true");
    STORE.set({ [seenKey]: true });
  });
}

document.querySelectorAll<HTMLElement>(".sec-main").forEach((btn) => {
  btn.addEventListener("click", () => toggleSection(btn));
});
document.querySelectorAll(".expand-hint").forEach((hint) => {
  hint.addEventListener("click", () => {
    const btn = hint.closest(".sync-section")?.querySelector<HTMLElement>(".sec-main");
    if (btn) toggleSection(btn);
  });
});

// Tooltips open upward by default; flip them below when the section sits too
// near the top of the popup to leave room above.
document.querySelectorAll(".info").forEach((info) => {
  const tip = info.querySelector<HTMLElement>(".tip");
  if (!tip) return;
  // Toggle-row tooltips are pinned below (their row has content above), so don't
  // auto-flip them back up.
  if (info.closest(".extra-row")) return;
  const place = () => {
    const head = info.closest(".sec-head") || info;
    const need = tip.offsetHeight + 16;
    info.classList.toggle("tip-below", head.getBoundingClientRect().top < need);
  };
  info.addEventListener("mouseenter", place);
  info.addEventListener("focusin", place);
});
