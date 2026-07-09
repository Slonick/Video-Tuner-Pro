// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Slider } from "../src/ui/Slider.js";
import { Switch } from "../src/ui/Switch.js";

let root: Root | null = null;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function pointer(type: string, init: Record<string, unknown> = {}): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(e, key, { value, configurable: true });
  }
  return e;
}

describe("Slider", () => {
  it("commits on pointer cancellation and preserves fractional values", () => {
    const commits: number[] = [];
    act(() => {
      root!.render(
        createElement(Slider, {
          min: 0,
          max: 1,
          step: 0.1,
          value: 0,
          onCommit: (v: number) => commits.push(v),
        }),
      );
    });
    const slider = document.querySelector<HTMLElement>("#root > span")!;
    const track = document.querySelector<HTMLElement>(".slider-track")!;
    track.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;

    act(() => {
      slider.dispatchEvent(pointer("pointerdown", { pointerId: 1, clientX: 30 }));
      slider.dispatchEvent(pointer("pointercancel", { pointerId: 1, clientX: 30 }));
    });

    expect(commits).toEqual([0.3]);
    expect(document.querySelector('[role="slider"]')?.getAttribute("aria-valuenow")).toBe("0.3");
  });
});

describe("Switch", () => {
  it("does not let a cancelled drag suppress the next real click", () => {
    const changes: boolean[] = [];
    function Harness() {
      const [checked, setChecked] = useState(false);
      return createElement(Switch, {
        checked,
        onChange: (next: boolean) => {
          changes.push(next);
          setChecked(next);
        },
      });
    }
    act(() => root!.render(createElement(Harness)));
    const sw = document.querySelector<HTMLElement>('[role="switch"]')!;

    act(() => {
      sw.dispatchEvent(pointer("pointerdown", { pointerId: 1, clientX: 0 }));
      sw.dispatchEvent(pointer("pointermove", { pointerId: 1, clientX: 20 }));
      sw.dispatchEvent(pointer("pointercancel", { pointerId: 1, clientX: 20 }));
      sw.click();
    });

    expect(changes).toEqual([true]);
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("swallows the synthesized click after a committed drag loses pointer capture", () => {
    const changes: boolean[] = [];
    function Harness() {
      const [checked, setChecked] = useState(false);
      return createElement(Switch, {
        checked,
        onChange: (next: boolean) => {
          changes.push(next);
          setChecked(next);
        },
      });
    }
    act(() => root!.render(createElement(Harness)));
    const sw = document.querySelector<HTMLElement>('[role="switch"]')!;

    act(() => {
      sw.dispatchEvent(pointer("pointerdown", { pointerId: 1, clientX: 0 }));
      sw.dispatchEvent(pointer("pointermove", { pointerId: 1, clientX: 20 }));
      sw.dispatchEvent(pointer("pointerup", { pointerId: 1, clientX: 20 }));
      sw.dispatchEvent(pointer("lostpointercapture", { pointerId: 1, clientX: 20 }));
      sw.click();
    });

    expect(changes).toEqual([true]);
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("does not keep swallowing clicks when a committed drag produces no click", async () => {
    const changes: boolean[] = [];
    function Harness() {
      const [checked, setChecked] = useState(false);
      return createElement(Switch, {
        checked,
        onChange: (next: boolean) => {
          changes.push(next);
          setChecked(next);
        },
      });
    }
    act(() => root!.render(createElement(Harness)));
    const sw = document.querySelector<HTMLElement>('[role="switch"]')!;

    act(() => {
      sw.dispatchEvent(pointer("pointerdown", { pointerId: 1, clientX: 0 }));
      sw.dispatchEvent(pointer("pointermove", { pointerId: 1, clientX: 20 }));
      sw.dispatchEvent(pointer("pointerup", { pointerId: 1, clientX: 20 }));
      sw.dispatchEvent(pointer("lostpointercapture", { pointerId: 1, clientX: 20 }));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    act(() => sw.click());

    expect(changes).toEqual([true, false]);
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });
});
