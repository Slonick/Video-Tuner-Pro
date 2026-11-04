// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Slider } from "../src/ui/Slider.js";
import { Switch } from "../src/ui/Switch.js";
import { Segmented } from "../src/ui/Segmented.js";
import { Tooltip } from "../src/ui/Tooltip.js";

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
  vi.restoreAllMocks();
  vi.useRealTimers();
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

describe("Segmented", () => {
  it("changes selection by click and wrapped arrow-key navigation", () => {
    const changes: string[] = [];
    Object.defineProperties(HTMLElement.prototype, {
      offsetWidth: { get: () => 80, configurable: true },
      offsetHeight: { get: () => 30, configurable: true },
      offsetLeft: {
        get(this: HTMLElement) {
          return Array.from(this.parentElement?.children ?? []).indexOf(this) * 80;
        },
        configurable: true,
      },
      offsetTop: { get: () => 0, configurable: true },
    });
    function Harness() {
      const [value, setValue] = useState("one");
      return createElement(Segmented, {
        items: [
          { value: "one", label: "One" },
          { value: "two", label: "Two" },
          { value: "three", label: "Three" },
        ],
        value,
        ariaLabel: "Mode",
        onChange: (next: string) => {
          changes.push(next);
          setValue(next);
        },
      });
    }
    act(() => root!.render(createElement(Harness)));
    const group = document.querySelector<HTMLElement>('[role="radiogroup"]')!;
    expect(group.classList.contains("has-pill")).toBe(true);

    act(() => document.querySelectorAll<HTMLButtonElement>('[role="radio"]')[1].click());
    expect(changes).toEqual(["two"]);

    act(() =>
      group.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
    );
    expect(changes).toEqual(["two", "one"]);

    act(() =>
      group.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
    );
    expect(changes).toEqual(["two", "one", "three"]);
  });

  it("does not change while disabled", () => {
    const onChange = vi.fn();
    act(() =>
      root!.render(
        createElement(Segmented, {
          items: [
            { value: "one", label: "One" },
            { value: "two", label: "Two" },
          ],
          value: "one",
          ariaLabel: "Mode",
          disabled: true,
          onChange,
        }),
      ),
    );
    const group = document.querySelector<HTMLElement>('[role="radiogroup"]')!;
    act(() => {
      document.querySelectorAll<HTMLButtonElement>('[role="radio"]')[1].click();
      group.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(group.classList.contains("is-disabled")).toBe(true);
  });
});

describe("Tooltip", () => {
  it("opens on hover, associates accessible content, repositions, and closes on Escape", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.classList.contains("tip")) return { ...({} as DOMRect), width: 120, height: 30 };
      return {
        ...({} as DOMRect),
        top: 4,
        bottom: 24,
        left: 20,
        right: 60,
        width: 40,
        height: 20,
      };
    });
    act(() =>
      root!.render(
        createElement(Tooltip, {
          trigger: createElement("button", { id: "tip-trigger" }, "Help"),
          content: "Useful explanation",
          bubbleClassName: "warn",
        }),
      ),
    );
    const trigger = document.getElementById("tip-trigger")!;
    act(() => trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));

    const tip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tip.textContent).toBe("Useful explanation");
    expect(tip.classList.contains("warn")).toBe(true);
    expect(trigger.getAttribute("aria-describedby")).toBe(tip.id);
    expect(tip.style.top).toBe("32px");

    act(() => window.dispatchEvent(new Event("resize")));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(trigger.hasAttribute("aria-describedby")).toBe(false);
  });

  it("opens on focus, flips a bottom tooltip upward, and closes on blur", () => {
    Object.defineProperty(window, "innerHeight", { value: 100, configurable: true });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.classList.contains("tip")) return { ...({} as DOMRect), width: 100, height: 30 };
      return {
        ...({} as DOMRect),
        top: 70,
        bottom: 90,
        left: 10,
        right: 50,
        width: 40,
        height: 20,
      };
    });
    act(() =>
      root!.render(
        createElement(Tooltip, {
          trigger: createElement("button", { id: "focus-trigger" }, "Help"),
          content: "Bottom tip",
          side: "bottom",
        }),
      ),
    );
    const trigger = document.getElementById("focus-trigger")!;
    act(() => trigger.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    expect(document.querySelector<HTMLElement>('[role="tooltip"]')?.style.top).toBe("32px");

    act(() => trigger.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("takes the Escape that closes it, so the embedded overlay stays open", () => {
    act(() =>
      root!.render(
        createElement(Tooltip, {
          trigger: createElement("button", { id: "esc-trigger" }, "Help"),
          content: "Tip",
        }),
      ),
    );
    const trigger = document.getElementById("esc-trigger")!;
    act(() => trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    // The embedded popup closes the whole overlay on an Escape nothing else handled.
    let overlayClosed = false;
    const overlay = (e: KeyboardEvent) => {
      overlayClosed = e.key === "Escape" && !e.defaultPrevented;
    };
    document.addEventListener("keydown", overlay);
    act(() =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    document.removeEventListener("keydown", overlay);

    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(overlayClosed).toBe(false);
  });
});
