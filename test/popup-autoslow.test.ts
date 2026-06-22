// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountApp, byId, flush, wait, sliderValue, setSlider } from "./mocks/mount-popup.js";

// The auto-slow card via the real <App/>: enable + target rate are saved per scope
// (channel > site > global) via messaging — the toggle/slider preview live
// (setAutoSlow), Save commits (rememberAutoSlow), Reset clears (resetAutoSlow).
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
  it("reflects the resolved enable + target + scope from getAutoSlow", async () => {
    await mountApp({ tab: EX, replies: reply({ target: 8 }) });
    expect(isOn("autoSlowToggle")).toBe(true);
    expect(sliderValue("autoSlowTarget")).toBe(8);
    await openMenu();
    expect(primary().textContent).toContain("for this site");
  });

  it("defaults the save target to Channel when the bundle came from a channel", async () => {
    await mountApp({ tab: EX, replies: reply({ scope: "channel", channel: "twitch:x" }) });
    await openMenu();
    expect(primary().textContent).toContain("for this channel");
  });

  it("the toggle previews live via setAutoSlow", async () => {
    const { lastCall } = await mountApp({
      tab: EX,
      replies: reply({ enabled: false, scope: null }),
    });
    click("autoSlowToggle");
    await flush();
    expect(lastCall("setAutoSlow")).toMatchObject({
      action: "setAutoSlow",
      enabled: true,
      target: 6,
    });
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
      enabled: true,
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

// The global response knobs (Slowest speed + Soft knee + Reaction) write their own
// storage keys live — not per-site — via useAutoSlowKnobs.
describe("auto-slow response knobs (global)", () => {
  // aria-valuenow is rounded to an integer, so the fractional knee is read off its
  // aria-valuetext readout instead (e.g. "±0.5 /s").
  const sliderText = (id: string) =>
    byId(id).querySelector('[role="slider"]')!.getAttribute("aria-valuetext");

  it("loads the stored floor (as a fraction) + knee + reaction into the sliders", async () => {
    await mountApp({
      tab: EX,
      replies: reply(),
      settings: { autoSlowFloor: 0.7, autoSlowKnee: 1.5, autoSlowReaction: 30 },
    });
    expect(sliderValue("asFloor")).toBe(70); // 0.7 → 70%
    expect(sliderText("asKnee")).toBe("±1.5 /s");
    expect(sliderValue("asReaction")).toBe(30);
  });

  it("defaults the knobs when nothing is stored", async () => {
    await mountApp({ tab: EX, replies: reply() });
    expect(sliderValue("asFloor")).toBe(100);
    expect(sliderText("asKnee")).toBe("±0.5 /s");
    expect(sliderValue("asReaction")).toBe(50);
  });

  it("applies edits from the sliders (setFloor / setKnee / setReaction run their write path)", async () => {
    await mountApp({ tab: EX, replies: reply() });
    setSlider("asFloor", 85);
    setSlider("asKnee", 2); // → max, ±2.0 /s
    setSlider("asReaction", 60);
    await flush();
    expect(sliderValue("asFloor")).toBe(85);
    expect(sliderText("asKnee")).toBe("±2.0 /s");
    expect(sliderValue("asReaction")).toBe(60);
  });
});
