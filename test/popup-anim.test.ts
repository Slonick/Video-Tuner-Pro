// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tweenNumber } from "../src/popup/core/tween-number.js";

// tweenNumber uses the extension's requestAnimationFrame helper, so the tests let
// it run and wait for the landing value rather than hand-stepping frames.
function setReducedMotion(reduce: boolean): void {
  window.matchMedia = ((q: string) => ({
    matches: reduce && /prefers-reduced-motion/.test(q),
  })) as typeof window.matchMedia;
}

beforeEach(() => setReducedMotion(false));
afterEach(() => {
  document.body.innerHTML = "";
});

describe("tweenNumber", () => {
  it("animates the element to the target", async () => {
    const el = document.createElement("span");
    tweenNumber(el, 0, 100, (v) => Math.round(v) + "%");
    await vi.waitFor(() => expect(el.textContent).toBe("100%"));
  });

  it("snaps when from equals to", () => {
    const el = document.createElement("span");
    tweenNumber(el, 42, 42, (v) => String(Math.round(v)));
    expect(el.textContent).toBe("42");
  });

  it("snaps under reduced motion", () => {
    setReducedMotion(true);
    const el = document.createElement("span");
    tweenNumber(el, 0, 10, (v) => String(Math.round(v)));
    expect(el.textContent).toBe("10");
  });

  it("a new tween cancels the previous one and lands on the latest target", async () => {
    const el = document.createElement("span");
    tweenNumber(el, 0, 100, (v) => String(Math.round(v)));
    tweenNumber(el, 0, 20, (v) => String(Math.round(v)));
    await vi.waitFor(() => expect(el.textContent).toBe("20"));
  });
});
