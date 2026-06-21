// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountApp, byId, flush, wait, setSlider } from "./mocks/mount-popup.js";

// Drive the speed card through the real <App/>: control the content-script replies,
// then exercise the buttons / slider / nudge / live-lock / scope wiring via the DOM.
const YT = { id: 7, url: "https://www.youtube.com/watch?v=x" };
const readout = () => byId("currentSpeedPct").textContent;
const click = (id: string) => byId(id).click();

describe("speed buttons & readout", () => {
  it("a preset button sets the readout and pushes the speed to the page", async () => {
    const { lastCall } = await mountApp({ tab: YT });
    document.querySelector<HTMLElement>('.btn-speed[data-percent="150"]')!.click();
    await flush();
    expect(readout()).toBe("150%");
    expect(lastCall("setSpeed")).toMatchObject({ action: "setSpeed", speed: 1.5 });
  });

  it("the + / − nudges step the speed by 5%", async () => {
    await mountApp({ tab: YT });
    click("speedUp");
    await flush();
    expect(readout()).toBe("105%");
    click("speedDown");
    await flush();
    expect(readout()).toBe("100%");
  });

  it("the ⟲ button reverts a manual change to the saved speed", async () => {
    const { replies } = await mountApp({ tab: YT });
    document.querySelector<HTMLElement>('.btn-speed[data-percent="175"]')!.click();
    await flush();
    replies.resetToSaved = { success: true };
    replies.getSpeed = {
      speed: 1.5,
      domain: "youtube.com",
      channel: null,
      channelName: "",
      scope: "site",
      live: false,
    };
    click("speedReset");
    await wait(120); // deferred getSpeed round-trip (80 ms)
    expect(readout()).toBe("150%");
  });
});

describe("slider", () => {
  it("input updates the readout immediately and applies after the debounce", async () => {
    const { lastCall } = await mountApp({ tab: YT });
    setSlider("speedSlider", 130, { commit: false }); // drag, not yet released
    await flush();
    expect(readout()).toBe("130%");
    await wait(220); // 160 ms debounce
    expect(lastCall("setSpeed")).toMatchObject({ speed: 1.3 });
  });

  it("release (change) applies immediately", async () => {
    const { lastCall } = await mountApp({ tab: YT });
    setSlider("speedSlider", 120); // drag + release
    await flush();
    expect(lastCall("setSpeed")).toMatchObject({ speed: 1.2 });
  });
});

describe("live lock", () => {
  it("locks the controls and shows the warning on a live stream", async () => {
    await mountApp({
      tab: YT,
      replies: { getSpeed: { speed: 1, channel: null, channelName: "", live: true } },
    });
    expect(byId("liveWarn").style.display).toBe("inline-flex");
    expect(document.querySelector(".speed-section")?.classList.contains("locked")).toBe(true);
  });

  it("stays unlocked on a non-live page", async () => {
    await mountApp({ tab: YT });
    expect(byId("liveWarn").style.display).toBe("none");
    expect(document.querySelector(".speed-section")?.classList.contains("locked")).toBe(false);
  });
});

// The "Save for" scope is a single menu button: the trigger (setDefaultBtn) is just
// "Save" and opens a popover. Inside, .scope-primary names + saves to the active scope,
// every scope is a .scope-row-wrap[data-key] holding a .scope-row (save) + .scope-del
// (remove). Removes are two-step (ConfirmButton): the subline Remove (resetBtn) and the
// row trash both need a second click to confirm.
const openMenu = async () => {
  click("setDefaultBtn");
  await flush();
};
const inMenu = (sel: string) => document.querySelector<HTMLElement>(`.scope-menu ${sel}`);
const primary = () => inMenu(".scope-primary")!;
const row = (scope: string) => inMenu(`.scope-row-wrap[data-key="${scope}"] .scope-row`);
const del = (scope: string) => inMenu(`.scope-row-wrap[data-key="${scope}"] .scope-del`);
const val = (scope: string) => row(scope)?.querySelector(".scope-val");

describe("scope control", () => {
  it("offers Channel in the Save menu on a YouTube watch page but defaults to Site", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getSpeed: {
          speed: 1,
          channel: "UCabc",
          channelName: "Some Channel",
          scope: null,
          live: false,
        },
      },
    });
    expect(byId("speedScope").textContent).toBe("Some Channel");
    await openMenu();
    expect(primary().textContent).toContain("for this site");
    expect(row("channel")).toBeTruthy();
  });

  it("defaults the save target to Channel when the page speed is a channel override", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getSpeed: {
          speed: 1.5,
          channel: "UCabc",
          channelName: "Ch",
          scope: "channel",
          live: false,
        },
      },
    });
    await openMenu();
    expect(primary().textContent).toContain("for this channel");
  });

  it("targets Global on the Save button when the speed resolves from the global scope", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getSpeed: { speed: 1.5, channel: "UCabc", channelName: "Ch", scope: "global", live: false },
      },
    });
    await openMenu();
    expect(primary().textContent).toContain("everywhere");
  });

  it("after Reset, the Save button retargets to the next scope the value falls to", async () => {
    const { replies } = await mountApp({
      tab: YT,
      settings: { domains: { "youtube.com": 1.5 } }, // Site saved → Clear enabled
      replies: {
        getSpeed: { speed: 1.5, channel: null, channelName: "", scope: "site", live: false },
      },
    });
    await openMenu();
    expect(primary().textContent).toContain("for this site");
    // Clear Site → the page now resolves the speed from Global; the primary retargets.
    replies.reset = { success: true };
    replies.getSpeed = { speed: 1.2, channel: null, channelName: "", scope: "global", live: false };
    click("resetBtn"); // arm the active-scope remove
    await flush();
    click("resetBtn"); // confirm → remove Site
    await wait(120); // deferred getSpeed round-trip
    await openMenu();
    expect(primary().textContent).toContain("everywhere");
  });

  it("Save to a menu scope sends that scope", async () => {
    const { lastCall } = await mountApp({
      tab: YT,
      replies: {
        getSpeed: { speed: 1, channel: "UCabc", channelName: "Ch", scope: null, live: false },
      },
    });
    document.querySelector<HTMLElement>('.btn-speed[data-percent="150"]')!.click(); // → 1.5
    await flush();
    await openMenu();
    row("channel")!.click();
    await flush();
    expect(lastCall("remember")).toMatchObject({
      action: "remember",
      scope: "channel",
      speed: 1.5,
    });
  });

  it("picking a speed save scope leaves the live-sync scope button untouched", async () => {
    const { lastCall } = await mountApp({ tab: YT });
    await openMenu();
    row("global")!.click();
    await flush();
    expect(lastCall("remember")).toMatchObject({ scope: "global" });
    // The live-sync card keeps its own default target (Site) — the speed pick
    // doesn't move it.
    byId("syncSetBtn").click();
    await flush();
    expect(primary().textContent).toContain("for this site");
  });

  it("marks the saved scope in the menu and clears it on Reset", async () => {
    const { replies } = await mountApp({ tab: YT });
    await openMenu();
    primary().click(); // save to the active scope (Site)
    await flush();
    // Saved state shows as the value on the active scope's row.
    await openMenu();
    expect(val("site")).toBeTruthy();
    replies.reset = { success: true };
    replies.getSpeed = { speed: 1, channel: null, channelName: "", scope: null, live: false };
    click("resetBtn"); // arm — menu is open
    await flush();
    click("resetBtn"); // confirm → remove the active scope (Site)
    await flush();
    await openMenu();
    expect(val("site")).toBeFalsy();
  });

  it("Reset from the menu forgets that scope and pulls the fallback speed back", async () => {
    const { replies, lastCall } = await mountApp({ tab: YT, settings: { globalSpeed: 1.5 } });
    await flush();
    replies.reset = { success: true };
    replies.getSpeed = { speed: 1.8, channel: null, channelName: "", scope: null, live: false };
    await openMenu();
    del("global")!.click(); // arm the Global trash
    await flush();
    del("global")!.click(); // confirm (✓) → reset Global
    expect(lastCall("reset")).toMatchObject({ action: "reset", scope: "global" });
    await wait(120); // deferred getSpeed round-trip
    expect(readout()).toBe("180%");
  });
});

// chrome:// / store pages have no content script — getSpeed never answers, so the
// card resolves and persists straight to storage (site > global > 100%).
describe("no content script (storage fallback)", () => {
  it("resolves the speed from storage when the page doesn't answer", async () => {
    await mountApp({ tab: YT, settings: { globalSpeed: 1.8 }, replies: { getSpeed: undefined } });
    expect(readout()).toBe("180%");
    await openMenu();
    expect(primary().textContent).toContain("for this site");
  });

  it("Save writes the per-site speed to storage when messaging fails", async () => {
    const { saved } = await mountApp({ tab: YT, replies: { getSpeed: undefined } });
    document.querySelector<HTMLElement>('.btn-speed[data-percent="150"]')!.click(); // → 1.5
    await flush();
    await openMenu();
    primary().click(); // active scope Site; remember has no reply → storage fallback
    await flush();
    expect((saved().domains as Record<string, number>)["youtube.com"]).toBe(1.5);
  });

  it("Reset clears the per-site speed from storage when messaging fails", async () => {
    const { saved } = await mountApp({
      tab: YT,
      settings: { domains: { "youtube.com": 2 } },
      replies: { getSpeed: undefined },
    });
    expect(readout()).toBe("200%");
    await openMenu();
    click("resetBtn"); // arm
    await flush();
    click("resetBtn"); // confirm → active scope Site; reset has no reply → storage fallback
    await flush();
    expect((saved().domains as Record<string, number>)["youtube.com"]).toBeUndefined();
  });
});
