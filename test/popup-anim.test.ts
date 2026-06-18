// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tweenSlider } from "../src/popup/core/tween-slider.js";
import { tweenNumber } from "../src/popup/core/tween-number.js";
import { movePill } from "../src/popup/core/seg-pill.js";

// Drive requestAnimationFrame by hand so the tween/pill frame loops are covered
// deterministically (jsdom's real rAF would need wall-clock waits).
let rafMap: Map<number, (t: number) => void>;
let nextId: number;
function flushRaf(now: number): void {
  const entries = [...rafMap];
  rafMap.clear();
  for (const [, cb] of entries) cb(now);
}
function setReducedMotion(reduce: boolean): void {
  window.matchMedia = ((q: string) => ({
    matches: reduce && /prefers-reduced-motion/.test(q),
  })) as typeof window.matchMedia;
}

beforeEach(() => {
  rafMap = new Map();
  nextId = 1;
  globalThis.requestAnimationFrame = ((cb: (t: number) => void) => {
    const id = nextId++;
    rafMap.set(id, cb);
    return id;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    rafMap.delete(id);
  }) as typeof cancelAnimationFrame;
  setReducedMotion(false);
});
afterEach(() => {
  document.body.innerHTML = "";
});

function makeSlider(value: string, step = "5"): HTMLInputElement {
  const s = document.createElement("input");
  s.type = "range";
  s.min = "0";
  s.max = "100";
  s.step = step;
  s.value = value;
  return s;
}

describe("tweenSlider", () => {
  it("glides the value to the target across frames, then restores the step", () => {
    const s = makeSlider("0");
    tweenSlider(s, 100);
    expect(s.step).toBe("any"); // step relaxed for smooth sub-step motion
    flushRaf(0); // start frame (t = 0)
    flushRaf(100); // mid (t = 0.5)
    expect(Number(s.value)).toBeGreaterThan(0);
    expect(Number(s.value)).toBeLessThan(100);
    flushRaf(200); // settle (t = 1)
    expect(s.value).toBe("100");
    expect(s.step).toBe("5");
    expect(rafMap.size).toBe(0); // no further frames queued
  });

  it("no-ops when already at the target", () => {
    const s = makeSlider("50");
    tweenSlider(s, 50);
    expect(s.value).toBe("50");
    expect(rafMap.size).toBe(0);
  });

  it("snaps instantly under reduced motion", () => {
    setReducedMotion(true);
    const s = makeSlider("0");
    tweenSlider(s, 80);
    expect(s.value).toBe("80");
    expect(rafMap.size).toBe(0);
  });

  it("a new tween cancels the previous one and keeps the original step", () => {
    const s = makeSlider("0");
    tweenSlider(s, 100);
    flushRaf(0);
    tweenSlider(s, 20); // restart mid-flight
    flushRaf(0);
    flushRaf(200);
    expect(s.value).toBe("20");
    expect(s.step).toBe("5");
  });
});

describe("tweenNumber", () => {
  it("counts the element to the target across frames", () => {
    const el = document.createElement("span");
    tweenNumber(el, 0, 100, (v) => Math.round(v) + "%");
    flushRaf(0);
    flushRaf(100);
    flushRaf(200);
    expect(el.textContent).toBe("100%");
  });

  it("snaps when from equals to", () => {
    const el = document.createElement("span");
    tweenNumber(el, 42, 42, (v) => String(Math.round(v)));
    expect(el.textContent).toBe("42");
    expect(rafMap.size).toBe(0);
  });

  it("snaps under reduced motion", () => {
    setReducedMotion(true);
    const el = document.createElement("span");
    tweenNumber(el, 0, 10, (v) => String(Math.round(v)));
    expect(el.textContent).toBe("10");
  });

  it("a new tween cancels the previous one", () => {
    const el = document.createElement("span");
    tweenNumber(el, 0, 100, (v) => String(Math.round(v)));
    flushRaf(0);
    tweenNumber(el, 0, 20, (v) => String(Math.round(v)));
    flushRaf(0);
    flushRaf(200);
    expect(el.textContent).toBe("20");
  });
});

describe("movePill", () => {
  function makeGroup(active = true): { group: HTMLElement; pill: HTMLElement } {
    const group = document.createElement("div");
    const pill = document.createElement("span");
    pill.className = "seg-pill";
    const b1 = document.createElement("button");
    b1.className = "scope-opt" + (active ? " active" : "");
    const b2 = document.createElement("button");
    b2.className = "scope-opt";
    group.append(pill, b1, b2);
    for (const [k, v] of [
      ["offsetWidth", 50],
      ["offsetHeight", 24],
      ["offsetLeft", 3],
      ["offsetTop", 2],
    ] as const) {
      Object.defineProperty(b1, k, { value: v, configurable: true });
    }
    return { group, pill };
  }

  it("places the pill over the active cell, skipping the transition on the first call", () => {
    const { group, pill } = makeGroup();
    movePill(group);
    expect(pill.style.width).toBe("50px");
    expect(pill.style.height).toBe("24px");
    expect(pill.style.transform).toBe("translate(3px, 2px)");
    expect(pill.style.opacity).toBe("1");
    expect(pill.style.transition).toBe("none"); // suppressed for the first placement
    flushRaf(0);
    expect(pill.style.transition).toBe(""); // restored next frame
  });

  it("repositions directly on later calls (no transition reset)", () => {
    const { group, pill } = makeGroup();
    movePill(group);
    flushRaf(0); // init
    pill.style.transition = "transform 0.2s";
    movePill(group); // already inited → place() only
    expect(pill.style.transition).toBe("transform 0.2s");
    expect(pill.style.opacity).toBe("1");
  });

  it("hides the pill when there's no active cell", () => {
    const { group, pill } = makeGroup(false);
    movePill(group);
    expect(pill.style.opacity).toBe("0");
  });

  it("ignores a null group or a missing pill", () => {
    expect(() => movePill(null)).not.toThrow();
    const bare = document.createElement("div");
    expect(() => movePill(bare)).not.toThrow();
  });
});
