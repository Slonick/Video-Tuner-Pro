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
    expect(valOf("acAttack")).toBe("20 ms"); // 0.02 s → 20 ms
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
    document.querySelector<HTMLElement>('.btn-preset[data-preset="movie"]')!.click();
    await flush();
    expect((byId("acThreshold") as HTMLInputElement).value).toBe("-28");
    expect((byId("acRatio") as HTMLInputElement).value).toBe("8");
    expect((byId("acGain") as HTMLInputElement).value).toBe("18"); // manual control preserved
    expect((byId("audioCompToggle") as HTMLInputElement).checked).toBe(true);
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
    const knee = byId("acKnee") as HTMLInputElement;
    ratio.value = "5";
    input(ratio);
    knee.value = "10";
    input(knee);
    await wait(420);
    const s = saved();
    expect(s.audioCompRatio).toBe(5);
    expect(s.audioCompKnee).toBe(10);
  });

  it("the toggle persists the audioComp flag", async () => {
    const { saved } = await mountApp({});
    (byId("audioCompToggle") as HTMLInputElement).click(); // on → off
    await flush();
    expect(saved().audioComp).toBe(false);
  });
});
