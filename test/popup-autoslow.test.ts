// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountApp, byId, flush, wait, sliderValue, setSlider } from "./mocks/mount-popup.js";

// The auto-slow card via the real <App/>: the master enable is a GLOBAL flag
// (autoSlowEnabled, a StoredToggle in the header). The target rate is saved per scope
// (channel > site > global) via messaging — the slider previews live (setAutoSlow),
// Save commits the target (rememberAutoSlow), Reset clears it (resetAutoSlow).
const EX = { id: 4, url: "https://example.com/" };
const click = (id: string) => byId(id).click();
// The toggle is a Radix Switch (role="switch" button), not a checkbox.
const isOn = (id: string) => byId(id).getAttribute("aria-checked") === "true";
const reply = (over: Record<string, unknown> = {}) => ({
  getAutoSlow: { enabled: true, target: 6, scope: "site", channel: null, ...over },
});
// "Save for" is a single menu button: the trigger (autoSlowSetBtn) opens a popover;
// .scope-primary saves to the active scope; the subline Remove (autoSlowResetBtn) is a
// two-step ConfirmButton — a second click confirms.
const openMenu = async () => {
  click("autoSlowSetBtn");
  await flush();
};
const primary = () => document.querySelector<HTMLElement>(".scope-menu .scope-primary")!;

describe("auto-slow card", () => {
  it("reflects the global enable flag + per-scope target + scope", async () => {
    await mountApp({ tab: EX, replies: reply({ target: 8 }), settings: { autoSlowEnabled: true } });
    expect(isOn("autoSlowToggle")).toBe(true); // from the global autoSlowEnabled flag
    expect(sliderValue("autoSlowTarget")).toBe(8); // from the resolved per-scope target
    await openMenu();
    expect(primary().textContent).toContain("for this site");
  });

  it("carries a beta marker in the header", async () => {
    await mountApp({ tab: EX, replies: reply() });
    expect(document.querySelector(".beta-glyph")?.textContent).toBe("β");
    expect(byId("autoSlowToggle")).not.toBeNull();
  });

  it("defaults the save target to Channel when the bundle came from a channel", async () => {
    await mountApp({ tab: EX, replies: reply({ scope: "channel", channel: "twitch:x" }) });
    await openMenu();
    expect(primary().textContent).toContain("for this channel");
  });

  it("the header toggle flips the global autoSlowEnabled flag", async () => {
    await mountApp({ tab: EX, replies: reply(), settings: { autoSlowEnabled: false } });
    expect(isOn("autoSlowToggle")).toBe(false);
    click("autoSlowToggle");
    await flush();
    expect(isOn("autoSlowToggle")).toBe(true);
  });

  it("the target slider previews live (debounced setAutoSlow)", async () => {
    const { lastCall } = await mountApp({ tab: EX, replies: reply() });
    setSlider("autoSlowTarget", 9);
    await wait(220);
    expect(lastCall("setAutoSlow")).toMatchObject({ action: "setAutoSlow", target: 9 });
  });

  it("Save sends rememberAutoSlow for the selected scope", async () => {
    const { lastCall } = await mountApp({ tab: EX, replies: reply({ target: 7 }) });
    await openMenu();
    primary().click();
    await flush();
    expect(lastCall("rememberAutoSlow")).toMatchObject({
      action: "rememberAutoSlow",
      scope: "site",
      target: 7,
    });
  });

  it("Reset sends resetAutoSlow and pulls the re-resolved value back", async () => {
    const { replies, lastCall } = await mountApp({
      tab: EX,
      replies: reply({ target: 8 }),
      settings: { autoSlowSites: { "example.com": { on: true, target: 8 } } }, // Site saved → Reset enabled
    });
    await flush();
    replies.resetAutoSlow = { success: true };
    replies.getAutoSlow = { enabled: false, target: 6, scope: null, channel: null };
    await openMenu();
    click("autoSlowResetBtn"); // arm
    await flush();
    click("autoSlowResetBtn"); // confirm
    await wait(120);
    expect(lastCall("resetAutoSlow")).toMatchObject({ action: "resetAutoSlow", scope: "site" });
  });

  it("the per-target Reset sends resetAutoSlowToSaved and pulls the saved value", async () => {
    const { replies, lastCall } = await mountApp({ tab: EX, replies: reply() });
    replies.resetAutoSlowToSaved = { success: true };
    replies.getAutoSlow = { enabled: true, target: 9, scope: "site", channel: null };
    click("autoSlowReset");
    expect(lastCall("resetAutoSlowToSaved")).toMatchObject({ action: "resetAutoSlowToSaved" });
    await wait(120); // deferred getAutoSlow pull
    expect(sliderValue("autoSlowTarget")).toBe(9);
  });

  it("the per-target Reset falls back to storage when the page doesn't answer", async () => {
    await mountApp({ tab: EX, replies: { getAutoSlow: undefined } });
    click("autoSlowReset");
    await wait(120);
    expect(Number.isFinite(sliderValue("autoSlowTarget"))).toBe(true);
  });
});

// The global response knobs surfaced on the card (Slowest speed + Soft knee) write
// their own storage keys live — not per-site — via useAutoSlowKnobs. Reaction / Hold
// / Ease-back live in the options page only.
describe("auto-slow response knobs (global)", () => {
  // aria-valuenow is rounded to an integer, so the fractional knee is read off its
  // aria-valuetext readout instead (e.g. "±0.5 /s").
  const sliderText = (id: string) =>
    byId(id).querySelector('[role="slider"]')!.getAttribute("aria-valuetext");

  it("loads the stored floor (as a fraction) + knee into the sliders", async () => {
    await mountApp({
      tab: EX,
      replies: reply(),
      settings: { autoSlowFloor: 0.7, autoSlowKnee: 1.5 },
    });
    expect(sliderValue("asFloor")).toBe(70); // 0.7 → 70%
    expect(sliderText("asKnee")).toBe("±1.5 /s");
  });

  it("defaults the knobs when nothing is stored", async () => {
    await mountApp({ tab: EX, replies: reply() });
    expect(sliderValue("asFloor")).toBe(100);
    expect(sliderText("asKnee")).toBe("±0.5 /s");
  });

  it("does not surface the Reaction knob on the card (options-only)", async () => {
    await mountApp({ tab: EX, replies: reply() });
    expect(document.getElementById("asReaction")).toBeNull();
  });

  it("applies edits from the sliders (setFloor / setKnee run their write path)", async () => {
    await mountApp({ tab: EX, replies: reply() });
    setSlider("asFloor", 85);
    setSlider("asKnee", 2); // → max, ±2.0 /s
    await flush();
    expect(sliderValue("asFloor")).toBe(85);
    expect(sliderText("asKnee")).toBe("±2.0 /s");
  });
});
