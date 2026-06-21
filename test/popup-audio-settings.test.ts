// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountApp, byId, flush, wait, sliderValue, setSlider } from "./mocks/mount-popup.js";

// The audio compressor card via the real <App/>: stored values populate the
// sliders/readouts, presets fill them (leaving make-up gain), and edits persist
// (debounced + merged) to the keys the content script reads.
const valOf = (id: string) => byId(id + "Val").textContent;
// The toggle is a Radix Switch (role="switch" button), not a checkbox.
const isOn = (id: string) => byId(id).getAttribute("aria-checked") === "true";

describe("stored values populate the card", () => {
  it("formats each param into its slider + readout", async () => {
    await mountApp({
      settings: {
        audioComp: true,
        audioCompThreshold: -40,
        audioCompKnee: 25,
        audioCompRatio: 6,
        audioCompAttack: 0.02,
        audioCompRelease: 0.5,
        audioCompGain: 12,
      },
    });
    expect(isOn("audioCompToggle")).toBe(true);
    expect(sliderValue("acThreshold")).toBe(-40);
    expect(valOf("acThreshold")).toBe("-40 dB");
    expect(valOf("acRatio")).toBe("6:1");
    expect(valOf("acGain")).toBe("12 dB");
  });

  it("clamps out-of-range stored values to the slider bounds", async () => {
    await mountApp({ settings: { audioCompGain: 999, audioCompRatio: 0 } });
    expect(sliderValue("acGain")).toBe(24);
    expect(sliderValue("acRatio")).toBe(1);
  });
});

describe("compressor preset leaves make-up gain untouched", () => {
  it("fills the comp sliders, turns compression on, but never overwrites gain", async () => {
    await mountApp({});
    setSlider("acGain", 18);
    document.querySelector<HTMLElement>('.btn-preset[data-preset="2"]')!.click(); // Movie
    await flush();
    expect(sliderValue("acThreshold")).toBe(-28);
    expect(sliderValue("acRatio")).toBe(8);
    expect(sliderValue("acGain")).toBe(18); // manual control preserved
    expect(isOn("audioCompToggle")).toBe(true);
  });
});

describe("popup preset quick row + extras (speed parity)", () => {
  const P = (over: Record<string, unknown>) => ({
    threshold: -50,
    knee: 20,
    ratio: 5,
    attack: 0,
    release: 0.3,
    ...over,
  });

  it("renders every preset; only the pinned ones form the quick row, the rest are extra", async () => {
    const presets = Array.from({ length: 6 }, (_, i) =>
      P({ name: `P${i}`, pin: i === 0 || i === 2 }),
    );
    await mountApp({ settings: { compPresets: presets } });
    const btns = [...document.querySelectorAll<HTMLElement>(".btn-preset")];
    expect(btns).toHaveLength(6); // all presets present in the DOM
    const extras = btns
      .filter((b) => b.classList.contains("extra"))
      .map((b) => b.getAttribute("data-preset"))
      .sort();
    // pinned {0,2} are the quick row; everything else is extra
    expect(extras).toEqual(["1", "3", "4", "5"]);
  });

  it("marks no preset extra when all are pinned", async () => {
    await mountApp({
      settings: { compPresets: [P({ name: "A", pin: true }), P({ name: "B", pin: true })] },
    });
    const btns = [...document.querySelectorAll<HTMLElement>(".btn-preset")];
    expect(btns).toHaveLength(2);
    expect(btns.some((b) => b.classList.contains("extra"))).toBe(false);
  });

  it("sizes the grid columns to the pinned count (no empty trailing cell)", async () => {
    await mountApp({
      settings: {
        compPresets: ["A", "B", "C"].map((name) => P({ name, pin: true })),
      },
    });
    const grid = document.querySelector<HTMLElement>(".preset-grid")!;
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, 1fr)"); // 3 pinned → 3 columns
  });

  it("caps the pinned quick row at three", async () => {
    const presets = Array.from({ length: 6 }, (_, i) => P({ name: `P${i}`, pin: i < 5 }));
    await mountApp({ settings: { compPresets: presets } });
    const grid = document.querySelector<HTMLElement>(".preset-grid")!;
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, 1fr)"); // pins normalize to 3
  });

  it("applies the preset at its full-list index, not its visible position", async () => {
    await mountApp({
      settings: {
        compPresets: [
          P({ name: "A", pin: false }),
          P({ name: "B", threshold: -22, ratio: 7, pin: true }),
        ],
      },
    });
    const b = document.querySelector<HTMLElement>('.btn-preset[data-preset="1"]')!;
    expect(b.textContent).toBe("B");
    b.click();
    await flush();
    expect(sliderValue("acThreshold")).toBe(-22);
    expect(sliderValue("acRatio")).toBe(7);
  });
});

describe("slider + toggle persistence", () => {
  it("updates the readout live and saves the param after the debounce", async () => {
    const { saved } = await mountApp({});
    setSlider("acRatio", 12);
    await flush();
    expect(valOf("acRatio")).toBe("12:1");
    await wait(420); // 350 ms debounce
    expect(saved().audioCompRatio).toBe(12);
  });

  it("saves make-up gain on its own key, independent of the presets", async () => {
    const { saved } = await mountApp({});
    setSlider("acGain", 9);
    await wait(420);
    expect(saved().audioCompGain).toBe(9);
  });

  it("merges rapid different-key writes instead of clobbering them", async () => {
    const { saved } = await mountApp({});
    setSlider("acRatio", 5);
    setSlider("acThreshold", -30);
    await wait(420);
    const s = saved();
    expect(s.audioCompRatio).toBe(5);
    expect(s.audioCompThreshold).toBe(-30);
  });

  it("the toggle persists the audioComp flag", async () => {
    const { saved } = await mountApp({});
    byId("audioCompToggle").click(); // on → off
    await flush();
    expect(saved().audioComp).toBe(false);
  });
});

describe("compressor preset gain routing", () => {
  const P = (over: Record<string, unknown>) => ({
    threshold: -50,
    knee: 20,
    ratio: 5,
    attack: 0,
    release: 0.3,
    ...over,
  });
  const click = (i: number) =>
    document.querySelector<HTMLElement>(`.btn-preset[data-preset="${i}"]`)!.click();

  it("a preset with its own gain sets the gain; one without falls back to the global", async () => {
    await mountApp({
      settings: {
        audioCompGain: 3,
        audioCompBaseGain: 3,
        compPresets: [
          P({ name: "A", gain: 8, pin: true }),
          P({ name: "B", threshold: -22, pin: true }),
        ],
      },
    });
    expect(sliderValue("acGain")).toBe(3); // global to start
    click(0); // A carries gain 8
    await flush();
    expect(sliderValue("acGain")).toBe(8);
    click(1); // B has no gain → back to the global base, not stuck at 8
    await flush();
    expect(sliderValue("acGain")).toBe(3);
  });

  it("the slider edits the active preset's own gain, not the global", async () => {
    const { saved } = await mountApp({
      settings: { compPresets: [P({ name: "A", threshold: -22, ratio: 7, gain: 6, pin: true })] },
    });
    click(0);
    await flush();
    setSlider("acGain", 10);
    await wait(420);
    const s = saved();
    expect(s.audioCompGain).toBe(10); // applied live
    expect((s.compPresets as Array<{ gain?: number }>)[0].gain).toBe(10); // persisted on the preset
  });

  it("the slider edits the global gain when the active preset has none", async () => {
    const { saved } = await mountApp({
      settings: { compPresets: [P({ name: "A", threshold: -22, ratio: 7, pin: true })] },
    });
    click(0);
    await flush();
    setSlider("acGain", 9);
    await wait(420);
    const s = saved();
    expect(s.audioCompGain).toBe(9); // applied live
    expect(s.audioCompBaseGain).toBe(9); // and stored as the global base
    expect((s.compPresets as Array<{ gain?: number }>)[0].gain).toBeUndefined(); // preset untouched
  });
});
