// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountApp, byId, flush, wait, sliderValue, setSlider } from "./mocks/mount-popup.js";

// The live-sync card via the real <App/>: the allowed delay is saved per scope
// (channel > site > global > 5s) via messaging — dragging previews live (setTarget),
// Save commits (rememberTarget), Reset clears (resetTarget).
const EX = { id: 3, url: "https://example.com/" };
const click = (id: string) => byId(id).click();
// "Save for" is a single menu button: the trigger (syncSetBtn) is just "Save" and
// opens a popover. .scope-primary names + saves to the active scope; every scope is a
// .scope-row-wrap[data-key] holding .scope-row (save) + .scope-del (remove). Removes
// are two-step (ConfirmButton): syncResetBtn (subline) needs a second click to confirm.
const openMenu = async () => {
  click("syncSetBtn");
  await flush();
};
const primary = () => document.querySelector<HTMLElement>(".scope-menu .scope-primary")!;
const row = (scope: string) =>
  document.querySelector<HTMLElement>(
    `.scope-menu .scope-row-wrap[data-key="${scope}"] .scope-row`,
  );
const val = (scope: string) => row(scope)?.querySelector(".scope-val");

describe("loadSyncSettings", () => {
  it("reflects the resolved target + scope from getTarget", async () => {
    await mountApp({
      tab: EX,
      replies: {
        getTarget: { target: 12, scope: "site", channel: null, channelName: "", live: false },
      },
    });
    expect(sliderValue("syncTarget")).toBe(12);
    expect(byId("syncTargetVal").textContent).toBe("12");
    await openMenu();
    expect(primary().textContent).toContain("for this site");
  });

  it("defaults the save target to Channel when the target came from the channel", async () => {
    await mountApp({
      tab: EX,
      replies: {
        getTarget: {
          target: 7,
          scope: "channel",
          channel: "twitch:x",
          channelName: "X",
          live: true,
        },
      },
    });
    await openMenu();
    expect(primary().textContent).toContain("for this channel");
  });

  it("shows each saved scope's value in the menu", async () => {
    await mountApp({
      tab: EX,
      settings: { syncTargets: { "example.com": 8 }, syncTargetGlobal: 12 },
      replies: {
        getTarget: { target: 8, scope: "site", channel: null, channelName: "", live: false },
      },
    });
    // The menu shows the value stored at each scope on its row (active included).
    await openMenu();
    expect(val("site")!.textContent).toContain("8");
    expect(row("global")!.textContent).toContain("12");
  });

  it("targets Global on the Save button when the delay resolves from the global scope", async () => {
    await mountApp({
      tab: EX,
      replies: {
        getTarget: { target: 12, scope: "global", channel: null, channelName: "", live: false },
      },
    });
    await openMenu();
    expect(primary().textContent).toContain("everywhere");
  });

  it("clamps an out-of-range target from the page", async () => {
    await mountApp({
      tab: EX,
      replies: {
        getTarget: { target: 999, scope: "site", channel: null, channelName: "", live: false },
      },
    });
    expect(sliderValue("syncTarget")).toBe(30);
  });
});

describe("toggle + slider", () => {
  it("the toggle persists the liveSync flag", async () => {
    const { saved } = await mountApp({ tab: EX });
    const t = byId("liveSyncToggle") as HTMLInputElement;
    t.click(); // on → off
    await flush();
    expect(saved().liveSync).toBe(false);
  });

  it("the +/− buttons nudge the delay (slider + readout) and preview live", async () => {
    const { lastCall } = await mountApp({ tab: EX });
    click("syncUp");
    await flush();
    expect(sliderValue("syncTarget")).toBe(6);
    expect(byId("syncTargetVal").textContent).toBe("6");
    click("syncDown");
    click("syncDown");
    await flush();
    expect(sliderValue("syncTarget")).toBe(4);
    await wait(220); // 160 ms preview debounce
    expect(lastCall("setTarget")).toMatchObject({ action: "setTarget", target: 4 });
  });

  it("the slider previews live (setTarget) without persisting", async () => {
    const { lastCall, saved } = await mountApp({ tab: EX });
    setSlider("syncTarget", 9, { commit: false });
    await flush();
    expect(byId("syncTargetVal").textContent).toBe("9");
    await wait(220);
    expect(lastCall("setTarget")).toMatchObject({ action: "setTarget", target: 9 });
    expect((saved().syncTargets as Record<string, number>) ?? {}).not.toHaveProperty("example.com");
  });
});

describe("save / reset by scope", () => {
  it("Save sends rememberTarget for the default scope and marks it saved", async () => {
    const { lastCall } = await mountApp({ tab: EX });
    click("syncUp"); // 5 → 6
    await flush();
    await openMenu();
    primary().click(); // save to the active scope (Site)
    await flush();
    expect(lastCall("rememberTarget")).toMatchObject({
      action: "rememberTarget",
      scope: "site",
      target: 6,
    });
    // Saved state shows as the value on the active scope's row.
    await openMenu();
    expect(val("site")).toBeTruthy();
  });

  it("Reset clears the slot, sends resetTarget, and pulls the new value back", async () => {
    const { replies, lastCall } = await mountApp({
      tab: EX,
      settings: { syncTargets: { "example.com": 8 } }, // Site saved → Reset enabled
    });
    await flush();
    replies.resetTarget = { success: true };
    replies.getTarget = { target: 9, scope: null, channel: null, channelName: "", live: false };
    await openMenu();
    click("syncResetBtn"); // arm
    await flush();
    click("syncResetBtn"); // confirm → clear the active scope (Site)
    expect(lastCall("resetTarget")).toMatchObject({ action: "resetTarget", scope: "site" });
    await wait(120); // deferred getTarget
    expect(sliderValue("syncTarget")).toBe(9);
  });

  it("the per-target Reset sends resetTargetToSaved and pulls the saved value", async () => {
    const { replies, lastCall } = await mountApp({ tab: EX });
    replies.resetTargetToSaved = { success: true };
    replies.getTarget = { target: 8, scope: "site", channel: null, channelName: "", live: false };
    click("syncReset");
    expect(lastCall("resetTargetToSaved")).toMatchObject({ action: "resetTargetToSaved" });
    await wait(120); // deferred getTarget pull
    expect(sliderValue("syncTarget")).toBe(8);
  });

  it("the per-target Reset falls back to storage when the page doesn't answer", async () => {
    await mountApp({
      tab: EX,
      settings: { syncTargets: { "example.com": 7 } },
      replies: { getTarget: undefined },
    });
    click("syncReset");
    await wait(120);
    expect(sliderValue("syncTarget")).toBe(7);
  });
});

describe("no content script (storage fallback)", () => {
  it("resolves the target from storage when the page doesn't answer", async () => {
    await mountApp({
      tab: EX,
      settings: { syncTargets: { "example.com": 9 } },
      replies: { getTarget: undefined },
    });
    expect(sliderValue("syncTarget")).toBe(9);
    await openMenu();
    expect(primary().textContent).toContain("for this site");
  });
});
