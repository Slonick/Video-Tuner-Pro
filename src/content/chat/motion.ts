// Motion helpers for the chat surfaces (side column, floating panel, FAB).
// Enter/exit run through WAAPI so they never touch style.transition — that is
// reserved for glide(): a short window during which geometry writes (left/top/
// width/height) transition instead of snapping, matching the viewer's own FLIP
// when the video reflows around the chat.
export const CHAT_MOTION_MS = 320;
export const CHAT_EXIT_MS = 220;
export const CHAT_EASE = "cubic-bezier(0.2, 0, 0, 1)";
const CHAT_EASE_OUT = "cubic-bezier(0.4, 0, 1, 1)";

function motionOk(el: HTMLElement): boolean {
  if (typeof el.animate !== "function") return false;
  try {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

// One-shot entrance from the given keyframe to the element's natural state.
export function animateIn(el: HTMLElement, from: Keyframe): void {
  if (!motionOk(el)) return;
  el.animate([from, { opacity: 1, transform: "none" }], {
    duration: CHAT_MOTION_MS,
    easing: CHAT_EASE,
  });
}

// Exit toward the keyframe, then remove. Falls back to immediate removal when
// animation isn't available (tests, reduced motion). `cleanup` runs right
// before removal either way.
export function animateOutAndRemove(el: HTMLElement, to: Keyframe, cleanup?: () => void): void {
  const done = (): void => {
    cleanup?.();
    el.remove();
  };
  if (!motionOk(el)) {
    done();
    return;
  }
  const anim = el.animate([{ opacity: 1 }, { opacity: 0, ...to }], {
    duration: CHAT_EXIT_MS,
    easing: CHAT_EASE_OUT,
    fill: "forwards",
  });
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    done();
  };
  anim.onfinish = finish;
  anim.oncancel = finish;
  setTimeout(finish, CHAT_EXIT_MS + 120);
}

// While the window is open, geometry writes glide instead of snapping. The
// prior inline transition comes back afterwards; overlapping windows extend.
const glideTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
const glideBase = new WeakMap<HTMLElement, string>();

export function glide(el: HTMLElement, ms: number): void {
  const prev = glideTimers.get(el);
  if (prev != null) clearTimeout(prev);
  else glideBase.set(el, el.style.transition);
  const list = ["left", "top", "right", "bottom", "width", "height", "border-radius"]
    .map((p) => `${p} ${ms}ms ${CHAT_EASE}`)
    .join(",");
  el.style.transition = list;
  glideTimers.set(
    el,
    setTimeout(() => {
      glideTimers.delete(el);
      el.style.transition = glideBase.get(el) ?? "";
      glideBase.delete(el);
    }, ms + 60),
  );
}
