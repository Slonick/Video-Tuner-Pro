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
  const speedThumb = () => byId("speedSlider").querySelector('[role="slider"]')!;

  it("input updates the readout immediately and applies after the debounce", async () => {
    const { lastCall } = await mountApp({ tab: YT });
    setSlider("speedSlider", 130, { commit: false }); // drag, not yet released
    await flush();
    expect(readout()).toBe("130%");
    await wait(220); // 160 ms debounce
    expect(lastCall("setSpeed")).toMatchObject({ speed: 1.3 });
  });

  it("a late initial getSpeed response does not overwrite a user slider edit", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getSpeed: {
          __delayMs: 80,
          speed: 1,
          channel: null,
          channelName: "",
          scope: null,
          live: false,
        },
      },
    });
    setSlider("speedSlider", 130, { commit: false });
    await flush();
    expect(readout()).toBe("130%");
    await wait(120);
    expect(readout()).toBe("130%");
  });

  it("exposes the speed value to assistive tech as percent, not percent×100", async () => {
    await mountApp({ tab: YT });
    expect(speedThumb().getAttribute("aria-valuenow")).toBe("100");
    expect(speedThumb().getAttribute("aria-valuetext")).toBe("100%");
  });

  it("release (change) applies immediately", async () => {
    const { lastCall } = await mountApp({ tab: YT });
    setSlider("speedSlider", 120); // drag + release
    await flush();
    expect(lastCall("setSpeed")).toMatchObject({ speed: 1.2 });
  });
});

describe("live lock", () => {
  const speedThumb = () => byId("speedSlider").querySelector('[role="slider"]')!;

  it("locks the controls and shows the warning on a live stream", async () => {
    await mountApp({
      tab: YT,
      replies: { getSpeed: { speed: 1, channel: null, channelName: "", live: true } },
    });
    expect(byId("liveWarn").style.display).toBe("inline-flex");
    expect(document.querySelector(".speed-section")?.classList.contains("locked")).toBe(true);
  });

  it("does not let keyboard slider input change speed while live-locked", async () => {
    const { lastCall } = await mountApp({
      tab: YT,
      replies: { getSpeed: { speed: 1, channel: null, channelName: "", live: true } },
    });
    expect(speedThumb().getAttribute("aria-disabled")).toBe("true");
    speedThumb().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flush();
    expect(readout()).toBe("100%");
    expect(lastCall("setSpeed")).toBeUndefined();
  });

  it("disables the nudge and reset buttons while live-locked", async () => {
    const { lastCall } = await mountApp({
      tab: YT,
      replies: { getSpeed: { speed: 1, channel: null, channelName: "", live: true } },
    });

    for (const id of ["speedDown", "speedUp", "speedReset"]) {
      expect((byId(id) as HTMLButtonElement).disabled).toBe(true);
      click(id);
    }
    await flush();

    expect(readout()).toBe("100%");
    expect(lastCall("setSpeed")).toBeUndefined();
    expect(lastCall("resetToSaved")).toBeUndefined();
  });

  it("disables preset buttons while live-locked", async () => {
    const { lastCall } = await mountApp({
      tab: YT,
      replies: { getSpeed: { speed: 1, channel: null, channelName: "", live: true } },
    });
    const preset = document.querySelector<HTMLButtonElement>('.btn-speed[data-percent="150"]')!;

    expect(preset.disabled).toBe(true);
    preset.click();
    await flush();

    expect(readout()).toBe("100%");
    expect(lastCall("setSpeed")).toBeUndefined();
  });

  it("disables saving speed while live-locked", async () => {
    const { lastCall } = await mountApp({
      tab: YT,
      replies: { getSpeed: { speed: 1, channel: null, channelName: "", live: true } },
    });
    const save = byId("setDefaultBtn") as HTMLButtonElement;

    expect(save.disabled).toBe(true);
    save.click();
    await flush();

    expect(document.querySelector(".scope-menu")).toBeNull();
    expect(lastCall("remember")).toBeUndefined();
  });

  it("stays unlocked on a non-live page", async () => {
    await mountApp({ tab: YT });
    expect(byId("liveWarn").style.display).toBe("none");
    expect(document.querySelector(".speed-section")?.classList.contains("locked")).toBe(false);
  });

  it("does not keep polling speed on a non-live page", async () => {
    const { sendSpy } = await mountApp({ tab: YT });
    const getSpeedCalls = () =>
      sendSpy.mock.calls.filter((c) => (c[1] as { action: string }).action === "getSpeed").length;
    const before = getSpeedCalls();

    await wait(1100);

    expect(getSpeedCalls()).toBe(before);
  });

  it("detects when an open non-live popup becomes live", async () => {
    let calls = 0;
    await mountApp({
      tab: YT,
      replies: {
        getSpeed: () => ({
          speed: ++calls >= 2 ? 1.05 : 1,
          channel: null,
          channelName: "",
          scope: null,
          live: calls >= 2,
        }),
      },
    });
    expect(byId("liveWarn").style.display).toBe("none");

    await wait(1700);

    expect(byId("liveWarn").style.display).toBe("inline-flex");
    expect(readout()).toBe("105%");
  });

  it("keeps polling speed while live so the catch-up readout updates", async () => {
    let speed = 1;
    const { sendSpy } = await mountApp({
      tab: YT,
      replies: {
        getSpeed: () => ({
          speed,
          channel: null,
          channelName: "",
          scope: null,
          live: true,
        }),
      },
    });
    const getSpeedCalls = () =>
      sendSpy.mock.calls.filter((c) => (c[1] as { action: string }).action === "getSpeed").length;
    const before = getSpeedCalls();
    speed = 1.05;

    await wait(1100);

    expect(getSpeedCalls()).toBeGreaterThan(before);
    expect(readout()).toBe("105%");
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
    replies.reset = (_msg: unknown, chrome: typeof globalThis.chrome) => {
      chrome.storage.local.set({ domains: {} });
      return { success: true };
    };
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

  it("does not fake a channel speed save when the page does not answer", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getSpeed: {
          speed: 1.5,
          channel: "UCabc",
          channelName: "Some Channel",
          scope: null,
          live: false,
        },
        remember: undefined,
      },
    });
    await openMenu();
    row("channel")!.click();
    await flush();
    await openMenu();
    expect(val("channel")).toBeFalsy();
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
    const { replies } = await mountApp({ tab: YT, replies: { remember: { success: true } } });
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
    await wait(120);
    await openMenu();
    expect(val("site")).toBeFalsy();
  });

  it("does not show Saved when the page rejects a save", async () => {
    await mountApp({ tab: YT, replies: { remember: { success: false } } });
    await openMenu();
    primary().click();
    await flush();
    expect(byId("setDefaultBtn").textContent).toContain("Save");
    await openMenu();
    expect(val("site")).toBeFalsy();
  });

  it("keeps the saved scope when the page rejects a reset", async () => {
    await mountApp({
      tab: YT,
      settings: { domains: { "youtube.com": 1.5 } },
      replies: {
        getSpeed: { speed: 1.5, channel: null, channelName: "", scope: "site", live: false },
        reset: { success: false },
      },
    });
    await openMenu();
    expect(val("site")).toBeTruthy();
    click("resetBtn");
    await flush();
    click("resetBtn");
    await flush();
    await openMenu();
    expect(val("site")).toBeTruthy();
  });

  it("does not fake channel speed removal when the page does not answer", async () => {
    await mountApp({
      tab: YT,
      settings: { channels: { UCabc: 1.5 } },
      replies: {
        getSpeed: {
          speed: 1.5,
          channel: "UCabc",
          channelName: "Some Channel",
          scope: "channel",
          live: false,
        },
        reset: undefined,
      },
    });
    await openMenu();
    expect(val("channel")).toBeTruthy();
    click("resetBtn");
    await flush();
    click("resetBtn");
    await flush();
    await openMenu();
    expect(val("channel")).toBeTruthy();
  });

  it("marks a channel value saved under an alternate YouTube key", async () => {
    await mountApp({
      tab: YT,
      settings: { channels: { "@some-handle": 1.5 } },
      replies: {
        getSpeed: {
          speed: 1.5,
          channel: "channel/UCabc",
          channelKeys: ["channel/UCabc", "@some-handle"],
          channelName: "Some Channel",
          scope: "channel",
          live: false,
        },
      },
    });

    await openMenu();
    expect(val("channel")?.textContent).toContain("150%");
  });

  it("shows the latest saved YouTube alias when both channel keys exist", async () => {
    await mountApp({
      tab: YT,
      settings: { channels: { "channel/UCabc": 2.0, "@some-handle": 1.5 } },
      replies: {
        getSpeed: {
          speed: 1.5,
          channel: "channel/UCabc",
          channelKeys: ["channel/UCabc", "@some-handle"],
          channelName: "Some Channel",
          scope: "channel",
          live: false,
        },
      },
    });

    await openMenu();
    expect(val("channel")?.textContent).toContain("150%");
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

describe("viewer auto-open scope control", () => {
  const pickViewerAuto = (label: string) => {
    const btn = Array.from(byId("viewerAutoVisual").querySelectorAll("button")).find(
      (el) => el.textContent === label,
    ) as HTMLElement | undefined;
    btn?.click();
  };
  const openViewerAutoMenu = async () => {
    click("viewerAutoSetBtn");
    await flush();
  };

  it("carries a beta marker on the auto-open row", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getViewerAuto: { mode: "off", scope: null, channel: "UCabc", channelName: "Ch" },
      },
    });
    expect(document.querySelector(".viewer-mode-option .beta-glyph")?.textContent).toBe("β");
    expect(document.querySelector(".sec-title-row .beta-glyph")).toBeNull();
  });

  it("saves the selected auto-open mode to a chosen scope", async () => {
    const { lastCall } = await mountApp({
      tab: YT,
      replies: {
        getViewerAuto: { mode: "off", scope: null, channel: "UCabc", channelName: "Ch" },
        setViewerState: { success: true, mode: "theater" },
      },
    });
    pickViewerAuto("Theater");
    await flush();
    click("viewerAutoModeToggle");
    await flush();
    await openViewerAutoMenu();
    row("channel")!.click();
    await flush();
    expect(lastCall("rememberViewerAuto")).toMatchObject({
      action: "rememberViewerAuto",
      scope: "channel",
      mode: "theater",
    });
  });

  it("does not mark viewer auto as saved when the page rejects the save", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getViewerAuto: { mode: "theater", scope: "site", channel: null, channelName: "" },
        rememberViewerAuto: { success: false },
      },
    });
    await openViewerAutoMenu();
    primary().click();
    await flush();
    expect(byId("viewerAutoSetBtn").textContent).toContain("Save");
    await openViewerAutoMenu();
    expect(val("site")).toBeFalsy();
  });

  it("does not fake a channel viewer auto save when the page does not answer", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getViewerAuto: { mode: "theater", scope: null, channel: "UCabc", channelName: "Ch" },
        rememberViewerAuto: undefined,
      },
    });
    await openViewerAutoMenu();
    row("channel")!.click();
    await flush();
    expect(byId("viewerAutoSetBtn").textContent).toContain("Save");
    await openViewerAutoMenu();
    expect(val("channel")).toBeFalsy();
  });

  it("does not mark viewer auto as saved when the storage fallback write fails", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getViewerAuto: { mode: "theater", scope: "site", channel: null, channelName: "" },
        rememberViewerAuto: undefined,
      },
      failSetKeys: ["viewerAutoSites"],
    });
    await openViewerAutoMenu();
    primary().click();
    await flush();
    expect(byId("viewerAutoSetBtn").textContent).toContain("Save");
    await openViewerAutoMenu();
    expect(val("site")).toBeFalsy();
  });

  it("keeps the mode buttons in sync with the page viewer state", async () => {
    const { emitRuntimeMessage, lastCall } = await mountApp({
      tab: YT,
      replies: {
        getViewerState: { mode: "normal" },
        setViewerState: { success: true, mode: "theater" },
      },
    });
    expect(byId("viewerAutoVisual").querySelector('[aria-checked="true"]')?.textContent).toBe(
      "Viewer",
    );
    pickViewerAuto("Theater");
    await flush();
    expect(lastCall("setViewerState")).toMatchObject({
      action: "setViewerState",
      mode: "theater",
      live: false,
    });
    expect(byId("viewerAutoVisual").querySelector('[aria-checked="true"]')?.textContent).toBe(
      "Theater",
    );
    await wait(1300);
    emitRuntimeMessage({ action: "viewerStateChanged", mode: "off" }, { tab: { id: YT.id } });
    await flush();
    expect(byId("viewerAutoVisual").querySelector('[aria-checked="true"]')?.textContent).toBe(
      "Off",
    );
  });

  it("keeps a just-picked page mode when the initial page state resolves late", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getViewerState: { __delayMs: 80, mode: "off" },
        setViewerState: { success: true, mode: "theater" },
      },
    });

    pickViewerAuto("Theater");
    await flush();
    await wait(120);

    expect(byId("viewerAutoVisual").querySelector('[aria-checked="true"]')?.textContent).toBe(
      "Theater",
    );
  });

  it("ignores an older viewer-mode response after a newer pick", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getViewerState: { mode: "normal" },
        setViewerState: (msg: Record<string, unknown>) =>
          msg.mode === "theater"
            ? { __delayMs: 80, success: true, mode: "theater" }
            : { success: true, mode: msg.mode },
      },
    });

    pickViewerAuto("Theater");
    await flush();
    pickViewerAuto("Off");
    await flush();
    await wait(120);

    expect(byId("viewerAutoVisual").querySelector('[aria-checked="true"]')?.textContent).toBe(
      "Off",
    );
  });

  it("ignores page viewer events while a picked mode is waiting out stale replies", async () => {
    const { emitRuntimeMessage } = await mountApp({
      tab: YT,
      replies: {
        getViewerState: { __delayMs: 80, mode: "normal" },
        setViewerState: { success: true, mode: "theater" },
      },
    });

    pickViewerAuto("Theater");
    await flush();
    emitRuntimeMessage({ action: "viewerStateChanged", mode: "off" }, { tab: { id: YT.id } });
    await wait(120);

    expect(byId("viewerAutoVisual").querySelector('[aria-checked="true"]')?.textContent).toBe(
      "Theater",
    );
  });

  it("refreshes page viewer state instead of applying unidentified runtime events", async () => {
    const { emitRuntimeMessage, replies } = await mountApp({
      tab: YT,
      replies: {
        getViewerState: { mode: "normal" },
      },
    });
    replies.getViewerState = { mode: "theater" };

    emitRuntimeMessage({ action: "viewerStateChanged", mode: "off" }, {});
    await flush();

    expect(byId("viewerAutoVisual").querySelector('[aria-checked="true"]')?.textContent).toBe(
      "Theater",
    );
  });

  it("does not poll stale page state after a just-picked mode", async () => {
    const { replies } = await mountApp({
      tab: YT,
      replies: {
        getViewerState: { mode: "normal" },
        setViewerState: { success: true, mode: "theater" },
      },
    });
    pickViewerAuto("Theater");
    await flush();
    replies.getViewerState = { mode: "normal" };
    await wait(760);
    expect(byId("viewerAutoVisual").querySelector('[aria-checked="true"]')?.textContent).toBe(
      "Theater",
    );
  });

  it("rolls back the page mode buttons when the page rejects a viewer mode change", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getViewerState: { mode: "off" },
        setViewerState: { success: false, mode: "off" },
      },
    });

    pickViewerAuto("Theater");
    await flush();

    expect(byId("viewerAutoVisual").querySelector('[aria-checked="true"]')?.textContent).toBe(
      "Off",
    );
  });

  it("does not expand viewer-mode settings while the feature is disabled", async () => {
    await mountApp({
      tab: YT,
      settings: { viewerAutoEnabled: false },
    });
    document.querySelector<HTMLElement>(".viewer-auto-section .sec-main")!.click();
    await flush();
    expect(document.querySelector(".viewer-auto-section")?.className).not.toContain("is-overlay");
  });

  it("blocks viewer controls with an honest reason for an embedded player", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getSpeed: {
          speed: 1,
          channel: null,
          channelName: "",
          scope: null,
          live: false,
          viewerSupported: false,
        },
      },
    });
    await flush();

    expect(byId("viewerAutoToggle").hasAttribute("disabled")).toBe(true);
    expect(document.querySelector(".viewer-drm-note")?.textContent).toContain("Embedded player");
  });

  it("rolls back the background-video toggle when storage rejects it", async () => {
    const { saved } = await mountApp({
      tab: YT,
      failSetKeys: ["viewerBackdropVideo"],
    });
    document.querySelector<HTMLElement>(".viewer-auto-section .sec-main")!.click();
    await flush();
    byId("viewerBackdropVideoToggle").click();
    await flush();

    expect(saved().viewerBackdropVideo).toBeUndefined();
    expect(byId("viewerBackdropVideoToggle").getAttribute("aria-checked")).toBe("false");
  });

  it("uses the switch as a global master toggle without changing page state", async () => {
    const { lastCall, saved } = await mountApp({
      tab: YT,
      settings: { viewerAutoEnabled: true },
      replies: {
        getViewerState: { mode: "normal" },
      },
    });
    click("viewerAutoToggle");
    await flush();
    expect(saved().viewerAutoEnabled).toBe(false);
    expect(lastCall("setViewerState")).toBeUndefined();
    expect(byId("viewerAutoVisual").querySelector('[aria-checked="true"]')?.textContent).toBe(
      "Viewer",
    );
  });

  it("rolls back the global viewer-mode switch when storage rejects it", async () => {
    const { saved } = await mountApp({
      tab: YT,
      settings: { viewerAutoEnabled: true },
      failSetKeys: ["viewerAutoEnabled"],
    });

    click("viewerAutoToggle");
    await flush();

    expect(saved().viewerAutoEnabled).toBe(true);
    expect(byId("viewerAutoToggle").getAttribute("aria-checked")).toBe("true");
  });

  it("uses the inner auto-open switch without changing page state", async () => {
    const { lastCall } = await mountApp({
      tab: YT,
      replies: {
        getViewerAuto: { mode: "off", scope: null, channel: "UCabc", channelName: "Ch" },
        getViewerState: { mode: "theater" },
      },
    });
    click("viewerAutoModeToggle");
    await flush();
    await openViewerAutoMenu();
    row("channel")!.click();
    await flush();
    expect(lastCall("setViewerState")).toBeUndefined();
    expect(lastCall("rememberViewerAuto")).toMatchObject({
      action: "rememberViewerAuto",
      scope: "channel",
      mode: "theater",
    });
  });

  it("keeps a just-picked auto-open setting when the saved mode resolves late", async () => {
    const { lastCall } = await mountApp({
      tab: YT,
      replies: {
        getViewerAuto: {
          __delayMs: 80,
          mode: "off",
          scope: null,
          channel: "UCabc",
          channelName: "Ch",
        },
        getViewerState: { mode: "theater" },
      },
    });
    click("viewerAutoModeToggle");
    await flush();
    await wait(120);
    await openViewerAutoMenu();
    row("channel")!.click();
    await flush();
    expect(lastCall("rememberViewerAuto")).toMatchObject({
      action: "rememberViewerAuto",
      scope: "channel",
      mode: "theater",
    });
  });

  it("resets the saved viewer auto mode for the active scope", async () => {
    const { replies, lastCall } = await mountApp({
      tab: YT,
      settings: { viewerAutoSites: { "youtube.com": "normal" } },
      replies: {
        getViewerAuto: { mode: "normal", scope: "site", channel: null, channelName: "" },
      },
    });
    await openViewerAutoMenu();
    expect(primary().textContent).toContain("for this site");
    replies.resetViewerAuto = { success: true };
    replies.getViewerAuto = { mode: "off", scope: null, channel: null, channelName: "" };
    click("viewerAutoResetBtn");
    await flush();
    click("viewerAutoResetBtn");
    await wait(120);
    expect(lastCall("resetViewerAuto")).toMatchObject({
      action: "resetViewerAuto",
      scope: "site",
    });
  });

  it("keeps viewer auto saved when the page rejects a reset", async () => {
    await mountApp({
      tab: YT,
      settings: { viewerAutoSites: { "youtube.com": "normal" } },
      replies: {
        getViewerAuto: { mode: "normal", scope: "site", channel: null, channelName: "" },
        resetViewerAuto: { success: false },
      },
    });
    await openViewerAutoMenu();
    expect(val("site")).toBeTruthy();
    click("viewerAutoResetBtn");
    await flush();
    click("viewerAutoResetBtn");
    await flush();
    await openViewerAutoMenu();
    expect(val("site")).toBeTruthy();
  });

  it("does not fake channel viewer auto removal when the page does not answer", async () => {
    await mountApp({
      tab: YT,
      settings: { viewerAutoChannels: { UCabc: "normal" } },
      replies: {
        getViewerAuto: { mode: "normal", scope: "channel", channel: "UCabc", channelName: "Ch" },
        resetViewerAuto: undefined,
      },
    });
    await openViewerAutoMenu();
    expect(val("channel")).toBeTruthy();
    click("viewerAutoResetBtn");
    await flush();
    click("viewerAutoResetBtn");
    await flush();
    await openViewerAutoMenu();
    expect(val("channel")).toBeTruthy();
  });

  it("saves the selected viewer fill mode to a chosen scope", async () => {
    const { lastCall } = await mountApp({
      tab: YT,
      replies: {
        getViewerFit: { mode: "contain", scope: null, channel: "UCabc", channelName: "Ch" },
      },
    });
    const btn = Array.from(byId("viewerFitSeg").querySelectorAll("button")).find(
      (el) => el.textContent === "Crop",
    ) as HTMLElement | undefined;
    btn?.click();
    await flush();
    click("viewerFitSetBtn");
    await flush();
    row("channel")!.click();
    await flush();
    expect(lastCall("setViewerFit")).toMatchObject({ action: "setViewerFit", mode: "cover" });
    expect(lastCall("rememberViewerFit")).toMatchObject({
      action: "rememberViewerFit",
      scope: "channel",
      mode: "cover",
    });
  });

  it("does not mark viewer fill as saved when the page rejects the save", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getViewerFit: { mode: "cover", scope: "site", channel: null, channelName: "" },
        rememberViewerFit: { success: false },
      },
    });
    click("viewerFitSetBtn");
    await flush();
    primary().click();
    await flush();
    expect(byId("viewerFitSetBtn").textContent).toContain("Save");
    click("viewerFitSetBtn");
    await flush();
    expect(val("site")).toBeFalsy();
  });

  it("rolls back the fill mode segment when the page rejects a mode change", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getViewerFit: { mode: "contain", scope: null, channel: null, channelName: "" },
        setViewerFit: { success: false, mode: "contain" },
      },
    });
    const crop = Array.from(byId("viewerFitSeg").querySelectorAll("button")).find(
      (el) => el.textContent === "Crop",
    ) as HTMLElement | undefined;

    crop?.click();
    await flush();

    expect(
      Array.from(byId("viewerFitSeg").querySelectorAll("button"))
        .find((el) => el.textContent === "Fit")
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("keeps a local fill mode pick when the initial page state resolves late", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getViewerFit: {
          __delayMs: 80,
          mode: "contain",
          scope: null,
          channel: null,
          channelName: "",
        },
        setViewerFit: { success: true, mode: "cover" },
      },
    });
    const crop = Array.from(byId("viewerFitSeg").querySelectorAll("button")).find(
      (el) => el.textContent === "Crop",
    ) as HTMLElement | undefined;

    crop?.click();
    await wait(120);

    expect(
      Array.from(byId("viewerFitSeg").querySelectorAll("button"))
        .find((el) => el.textContent === "Crop")
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("does not fake a channel viewer fill save when the page does not answer", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getViewerFit: { mode: "cover", scope: null, channel: "UCabc", channelName: "Ch" },
        rememberViewerFit: undefined,
      },
    });
    click("viewerFitSetBtn");
    await flush();
    row("channel")!.click();
    await flush();
    expect(byId("viewerFitSetBtn").textContent).toContain("Save");
    click("viewerFitSetBtn");
    await flush();
    expect(val("channel")).toBeFalsy();
  });

  it("resets the saved viewer fill mode for the active scope and re-resolves", async () => {
    const { replies, lastCall } = await mountApp({
      tab: YT,
      settings: {
        viewerFitGlobal: "fill",
        viewerFitSites: { "youtube.com": "cover" },
      },
      replies: {
        getViewerFit: { mode: "cover", scope: "site", channel: null, channelName: "" },
        resetViewerFit: (_msg: unknown, chrome: typeof globalThis.chrome) => {
          chrome.storage.local.set({ viewerFitSites: {} });
          return { success: true };
        },
      },
    });
    click("viewerFitSetBtn");
    await flush();
    expect(primary().textContent).toContain("for this site");
    replies.getViewerFit = { mode: "fill", scope: "global", channel: null, channelName: "" };
    click("viewerFitResetBtn");
    await flush();
    click("viewerFitResetBtn");
    await wait(120);
    expect(lastCall("resetViewerFit")).toMatchObject({
      action: "resetViewerFit",
      scope: "site",
    });
    click("viewerFitSetBtn");
    await flush();
    expect(val("site")).toBeFalsy();
    expect(
      Array.from(byId("viewerFitSeg").querySelectorAll("button"))
        .find((el) => el.textContent === "Stretch")
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("keeps viewer fill saved when the page rejects a reset", async () => {
    await mountApp({
      tab: YT,
      settings: { viewerFitSites: { "youtube.com": "cover" } },
      replies: {
        getViewerFit: { mode: "cover", scope: "site", channel: null, channelName: "" },
        resetViewerFit: { success: false },
      },
    });
    click("viewerFitSetBtn");
    await flush();
    expect(val("site")).toBeTruthy();
    click("viewerFitResetBtn");
    await flush();
    click("viewerFitResetBtn");
    await flush();
    click("viewerFitSetBtn");
    await flush();
    expect(val("site")).toBeTruthy();
  });

  it("removes the viewer fill site map when storage fallback clears its last entry", async () => {
    const { saved } = await mountApp({
      tab: YT,
      settings: { viewerFitSites: { "youtube.com": "cover" } },
      replies: {
        getViewerFit: { mode: "cover", scope: "site", channel: null, channelName: "" },
        resetViewerFit: undefined,
      },
    });
    click("viewerFitSetBtn");
    await flush();
    expect(val("site")).toBeTruthy();
    click("viewerFitResetBtn");
    await flush();
    click("viewerFitResetBtn");
    await flush();
    expect(saved().viewerFitSites).toBeUndefined();
    click("viewerFitSetBtn");
    await flush();
    expect(val("site")).toBeFalsy();
  });

  it("does not fake channel viewer fill removal when the page does not answer", async () => {
    await mountApp({
      tab: YT,
      settings: { viewerFitChannels: { UCabc: "cover" } },
      replies: {
        getViewerFit: { mode: "cover", scope: "channel", channel: "UCabc", channelName: "Ch" },
        resetViewerFit: undefined,
      },
    });
    click("viewerFitSetBtn");
    await flush();
    expect(val("channel")).toBeTruthy();
    click("viewerFitResetBtn");
    await flush();
    click("viewerFitResetBtn");
    await flush();
    click("viewerFitSetBtn");
    await flush();
    expect(val("channel")).toBeTruthy();
  });

  it("stores the viewer background video toggle globally", async () => {
    const { saved } = await mountApp({ tab: YT, settings: { viewerBackdropVideo: false } });
    click("viewerBackdropVideoToggle");
    await flush();
    expect(saved().viewerBackdropVideo).toBe(true);
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

  it("does not show Saved when the storage fallback write fails", async () => {
    const { saved } = await mountApp({
      tab: YT,
      replies: { getSpeed: undefined },
      failSetKeys: ["domains"],
    });
    document.querySelector<HTMLElement>('.btn-speed[data-percent="150"]')!.click();
    await flush();
    await openMenu();
    primary().click();
    await flush();

    expect(saved().domains).toBeUndefined();
    expect(byId("setDefaultBtn").textContent).toContain("Save");
    expect(byId("setDefaultBtn").textContent).not.toContain("Saved");
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
    expect(saved().domains).toBeUndefined();
  });
});
