// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { animateIn, animateOutAndRemove, glide, CHAT_EXIT_MS } from "../src/content/chat/motion.js";

// jsdom has no WAAPI — stub animate per element to exercise the motion paths.
type Handlers = { onfinish: (() => void) | null; oncancel: (() => void) | null; calls: unknown[] };

function withAnimate(el: HTMLElement): Handlers {
  const h: Handlers = { onfinish: null, oncancel: null, calls: [] };
  (el as unknown as { animate: unknown }).animate = (...args: unknown[]) => {
    h.calls.push(args);
    const anim = {
      set onfinish(fn: (() => void) | null) {
        h.onfinish = fn;
      },
      set oncancel(fn: (() => void) | null) {
        h.oncancel = fn;
      },
    };
    return anim;
  };
  return h;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("chat motion", () => {
  it("animateIn runs the entrance keyframes when WAAPI is available", () => {
    const el = document.createElement("div");
    const h = withAnimate(el);
    animateIn(el, { opacity: 0 });
    expect(h.calls).toHaveLength(1);
  });

  it("animateIn is a no-op under prefers-reduced-motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const el = document.createElement("div");
    const h = withAnimate(el);
    animateIn(el, { opacity: 0 });
    expect(h.calls).toHaveLength(0);
  });

  it("animateOutAndRemove removes after the exit finishes, once", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const h = withAnimate(el);
    const cleanup = vi.fn();
    animateOutAndRemove(el, {}, cleanup);
    expect(el.isConnected).toBe(true); // still fading
    h.onfinish?.();
    expect(el.isConnected).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CHAT_EXIT_MS + 200); // safety timer must not re-run
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("animateOutAndRemove falls back to the safety timer when no event fires", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    withAnimate(el);
    animateOutAndRemove(el, {});
    vi.advanceTimersByTime(CHAT_EXIT_MS + 200);
    expect(el.isConnected).toBe(false);
  });

  it("animateOutAndRemove removes immediately without WAAPI", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const cleanup = vi.fn();
    animateOutAndRemove(el, {}, cleanup);
    expect(el.isConnected).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("glide opens a geometry transition window and restores the prior inline value", () => {
    const el = document.createElement("div");
    el.style.transition = "opacity 1s";
    glide(el, 400);
    expect(el.style.transition).toContain("left 400ms");
    expect(el.style.transition).toContain("height 400ms");
    vi.advanceTimersByTime(500);
    expect(el.style.transition).toBe("opacity 1s");
  });

  it("overlapping glide windows still restore the original base", () => {
    const el = document.createElement("div");
    el.style.transition = "opacity 1s";
    glide(el, 400);
    glide(el, 300); // must not capture the first window's list as the base
    vi.advanceTimersByTime(400);
    expect(el.style.transition).toBe("opacity 1s");
  });
});
