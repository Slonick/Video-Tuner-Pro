// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountApp, byId, flush, wait } from "./mocks/mount-popup.js";

// The audio compressor card via the real <App/>: stored values populate the
// sliders/readouts, presets fill them (leaving make-up gain), and edits persist
// (debounced + merged) to the keys the content script reads.
const valOf = (id: string) => byId(id + "Val").textContent;
const input = (el: HTMLInputElement) => el.dispatchEvent(new Event("input", { bubbles: true }));

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
    expect((byId("audioCompToggle") as HTMLInputElement).checked).toBe(true);
    expect((byId("acThreshold") as HTMLInputElement).value).toBe("-40");
    expect(valOf("acThreshold")).toBe("-40 dB");
    expect(valOf("acRatio")).toBe("6:1");
    expect(valOf("acGain")).toBe("12 dB");
  });

  it("clamps out-of-range stored values to the slider bounds", async () => {
    await mountApp({ settings: { audioCompGain: 999, audioCompRatio: 0 } });
    expect((byId("acGain") as HTMLInputElement).value).toBe("24");
    expect((byId("acRatio") as HTMLInputElement).value).toBe("1");
  });
});

describe("compressor preset leaves make-up gain untouched", () => {
  it("fills the comp sliders, turns compression on, but never overwrites gain", async () => {
    await mountApp({});
    (byId("audioCompToggle") as HTMLInputElement).checked = false;
    (byId("acGain") as HTMLInputElement).value = "18";
    document.querySelector<HTMLElement>('.btn-preset[data-preset="2"]')!.click(); // Movie
    await flush();
    expect((byId("acThreshold") as HTMLInputElement).value).toBe("-28");
    expect((byId("acRatio") as HTMLInputElement).value).toBe("8");
    expect((byId("acGain") as HTMLInputElement).value).toBe("18"); // manual control preserved
    expect((byId("audioCompToggle") as HTMLInputElement).checked).toBe(true);
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

  it("renders every preset; pins fill the quick row to 4, the rest are extra", async () => {
    const presets = Array.from({ length: 6 }, (_, i) =>
      P({ name: `P${i}`, pin: i === 0 || i === 5 }),
    );
    await mountApp({ settings: { compPresets: presets } });
    const btns = [...document.querySelectorAll<HTMLElement>(".btn-preset")];
    expect(btns).toHaveLength(6); // all presets present in the DOM
    const extras = btns
      .filter((b) => b.classList.contains("extra"))
      .map((b) => b.getAttribute("data-preset"))
      .sort();
    // pinned {0,5} + the two lowest unpinned {1,2} fill the quick four → {3,4} extra.
    expect(extras).toEqual(["3", "4"]);
  });

  it("marks no preset extra when there are 4 or fewer", async () => {
    await mountApp({
      settings: { compPresets: [P({ name: "A", pin: false }), P({ name: "B", pin: false })] },
    });
    const btns = [...document.querySelectorAll<HTMLElement>(".btn-preset")];
    expect(btns).toHaveLength(2);
    expect(btns.some((b) => b.classList.contains("extra"))).toBe(false);
  });

  it("sizes the grid columns to the visible count (no empty trailing cell)", async () => {
    await mountApp({
      settings: {
        compPresets: ["A", "B", "C"].map((name) => P({ name, pin: false })),
      },
    });
    const grid = document.querySelector<HTMLElement>(".preset-grid")!;
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, 1fr)"); // 3 presets → 3 columns
  });

  it("caps the grid at 4 columns when there are more than four", async () => {
    const presets = Array.from({ length: 6 }, (_, i) => P({ name: `P${i}`, pin: i < 2 }));
    await mountApp({ settings: { compPresets: presets } });
    const grid = document.querySelector<HTMLElement>(".preset-grid")!;
    expect(grid.style.gridTemplateColumns).toBe("repeat(4, 1fr)");
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
    expect((byId("acThreshold") as HTMLInputElement).value).toBe("-22");
    expect((byId("acRatio") as HTMLInputElement).value).toBe("7");
  });
});

describe("slider + toggle persistence", () => {
  it("updates the readout live and saves the param after the debounce", async () => {
    const { saved } = await mountApp({});
    const ratio = byId("acRatio") as HTMLInputElement;
    ratio.value = "12";
    input(ratio);
    await flush();
    expect(valOf("acRatio")).toBe("12:1");
    await wait(420); // 350 ms debounce
    expect(saved().audioCompRatio).toBe(12);
  });

  it("saves make-up gain on its own key, independent of the presets", async () => {
    const { saved } = await mountApp({});
    const gain = byId("acGain") as HTMLInputElement;
    gain.value = "9";
    input(gain);
    await wait(420);
    expect(saved().audioCompGain).toBe(9);
  });

  it("merges rapid different-key writes instead of clobbering them", async () => {
    const { saved } = await mountApp({});
    const ratio = byId("acRatio") as HTMLInputElement;
    const threshold = byId("acThreshold") as HTMLInputElement;
    ratio.value = "5";
    input(ratio);
    threshold.value = "-30";
    input(threshold);
    await wait(420);
    const s = saved();
    expect(s.audioCompRatio).toBe(5);
    expect(s.audioCompThreshold).toBe(-30);
  });

  it("the toggle persists the audioComp flag", async () => {
    const { saved } = await mountApp({});
    (byId("audioCompToggle") as HTMLInputElement).click(); // on → off
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

  it("applying a preset with its own gain sets the gain; one without leaves it", async () => {
    await mountApp({
      settings: {
        audioCompGain: 3,
        compPresets: [
          P({ name: "A", gain: 8, pin: true }),
          P({ name: "B", threshold: -22, pin: true }),
        ],
      },
    });
    expect((byId("acGain") as HTMLInputElement).value).toBe("3"); // global to start
    click(1); // B has no gain → unchanged
    await flush();
    expect((byId("acGain") as HTMLInputElement).value).toBe("3");
    click(0); // A carries gain 8
    await flush();
    expect((byId("acGain") as HTMLInputElement).value).toBe("8");
  });

  it("the slider edits the active preset's own gain, not the global", async () => {
    const { saved } = await mountApp({
      settings: { compPresets: [P({ name: "A", threshold: -22, ratio: 7, gain: 6, pin: true })] },
    });
    click(0);
    await flush();
    const g = byId("acGain") as HTMLInputElement;
    g.value = "10";
    g.dispatchEvent(new Event("input", { bubbles: true }));
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
    const g = byId("acGain") as HTMLInputElement;
    g.value = "9";
    g.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(420);
    const s = saved();
    expect(s.audioCompGain).toBe(9);
    expect((s.compPresets as Array<{ gain?: number }>)[0].gain).toBeUndefined(); // preset untouched
  });
});
