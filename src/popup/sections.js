// Collapsible sections: expand/collapse on the header or the bottom chevron,
// smooth scroll-into-view on expand, tooltip flipping, and the first-enable
// auto-expand. Registering listeners runs when this module is imported.
import { STORE } from "./env.js";

// Smoothly bring an expanding section's body fully into view, in sync with the
// CSS max-height transition. Reading the section's live bottom each frame
// self-corrects for the growing body + margin/padding, so it lands exactly — on
// the last frame, close the full remaining gap so it never stops short.
function revealOnExpand(el) {
  const root = document.scrollingElement || document.documentElement;
  const sec = el.closest(".sync-section") || el;
  const DUR = 480, MARGIN = 12, vh = window.innerHeight;
  let start = null;
  function step(now) {
    if (start === null) start = now;
    const last = now - start >= DUR;
    const below = sec.getBoundingClientRect().bottom - vh + MARGIN;
    const room = (root.scrollHeight - vh) - root.scrollTop;
    if (below > 0 && room > 0) root.scrollTop += Math.min(below, room) * (last ? 1 : 0.25);
    if (!last) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function toggleSection(btn) {
  const body = document.getElementById(btn.dataset.target);
  const open = body.classList.toggle("open");
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) revealOnExpand(body);   // scroll the revealed sliders into view
}

// The first time a section is switched on, auto-expand it so the user sees its
// settings. Tracked by a persistent flag so it only happens once, ever.
export function autoExpandOnFirstEnable(enabled, bodyId, seenKey) {
  if (!enabled) return;
  STORE.get([seenKey], (r) => {
    if (r[seenKey]) return;
    const body = document.getElementById(bodyId);
    body.classList.add("open");
    const btn = document.querySelector('.sec-main[data-target="' + bodyId + '"]');
    if (btn) btn.setAttribute("aria-expanded", "true");
    STORE.set({ [seenKey]: true });
  });
}

// Section headers expand/collapse their body (independent of the on/off switch).
document.querySelectorAll(".sec-main").forEach((btn) => {
  btn.addEventListener("click", () => toggleSection(btn));
});
// The bottom chevron toggles the same section it belongs to.
document.querySelectorAll(".expand-hint").forEach((hint) => {
  hint.addEventListener("click", () => {
    const btn = hint.closest(".sync-section")?.querySelector(".sec-main");
    if (btn) toggleSection(btn);
  });
});

// Info tooltips open upward (above the section) by default; if the section is
// near the top of the popup there's no room, so flip them below instead.
document.querySelectorAll(".info").forEach((info) => {
  const tip = info.querySelector(".tip");
  if (!tip) return;
  const place = () => {
    const head = info.closest(".sec-head") || info;
    const need = tip.offsetHeight + 16; // tip height + gap above the header
    info.classList.toggle("tip-below", head.getBoundingClientRect().top < need);
  };
  info.addEventListener("mouseenter", place);
  info.addEventListener("focusin", place);
});
