// Slide a single accent "pill" to the active option of a segmented group (the
// scope picker, the audio presets) so the selection glides between cells instead
// of the fill crossfading. The pill is a <span class="seg-pill"> inside the
// group; it's sized and positioned over the .active button by measuring its box.
// The first placement per group skips the transition so the pill doesn't slide
// in from the corner when the popup opens. The 2-row speed grid keeps its
// crossfade — a pill can't travel across rows cleanly.
const inited = new WeakSet<HTMLElement>();

export function movePill(group: HTMLElement | null): void {
  if (!group) return;
  const pill = group.querySelector<HTMLElement>(".seg-pill");
  if (!pill) return;
  const active = group.querySelector<HTMLElement>(".active");
  if (!active || active.offsetWidth === 0) {
    pill.style.opacity = "0";
    return;
  }

  const place = (): void => {
    pill.style.opacity = "1";
    pill.style.width = active.offsetWidth + "px";
    pill.style.height = active.offsetHeight + "px";
    pill.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
  };

  if (inited.has(group)) {
    place();
  } else {
    inited.add(group);
    const t = pill.style.transition;
    pill.style.transition = "none";
    place();
    requestAnimationFrame(() => {
      pill.style.transition = t;
    });
  }
}
