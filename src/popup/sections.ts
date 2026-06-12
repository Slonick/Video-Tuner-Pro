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

function toggleSection(btn: HTMLElement): void {
  const body = btn.dataset.target ? document.getElementById(btn.dataset.target) : null;
  if (!body) return;
  const open = body.classList.toggle("open");
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) revealOnExpand(body);
}

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
  const place = () => {
    const head = info.closest(".sec-head") || info;
    const need = tip.offsetHeight + 16;
    info.classList.toggle("tip-below", head.getBoundingClientRect().top < need);
  };
  info.addEventListener("mouseenter", place);
  info.addEventListener("focusin", place);
});
