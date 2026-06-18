// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountApp, byId, flush, wait } from "./mocks/mount-popup.js";

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
    const slider = byId("speedSlider") as HTMLInputElement;
    slider.value = "130";
    slider.dispatchEvent(new Event("input"));
    await flush();
    expect(readout()).toBe("130%");
    await wait(220); // 160 ms debounce
    expect(lastCall("setSpeed")).toMatchObject({ speed: 1.3 });
  });

  it("release (change) applies immediately", async () => {
    const { lastCall } = await mountApp({ tab: YT });
    const slider = byId("speedSlider") as HTMLInputElement;
    slider.value = "120";
    slider.dispatchEvent(new Event("change"));
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

describe("scope control", () => {
  it("shows the channel segment on a YouTube watch page but defaults to Site", async () => {
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
    expect(byId("scopeSeg").classList.contains("has-channel")).toBe(true);
    expect(byId("scopeSite").classList.contains("active")).toBe(true);
  });

  it("preselects Channel only when a channel speed is saved", async () => {
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
    expect(byId("scopeChannel").classList.contains("active")).toBe(true);
  });

  it("defaults to Site when the page speed comes from the global scope", async () => {
    await mountApp({
      tab: YT,
      replies: {
        getSpeed: { speed: 1.5, channel: "UCabc", channelName: "Ch", scope: "global", live: false },
      },
    });
    expect(byId("scopeSite").classList.contains("active")).toBe(true);
  });

  it("Remember sends the selected scope", async () => {
    const { lastCall } = await mountApp({
      tab: YT,
      replies: {
        getSpeed: { speed: 1, channel: "UCabc", channelName: "Ch", scope: null, live: false },
      },
    });
    document.querySelector<HTMLElement>('.btn-speed[data-percent="150"]')!.click(); // → 1.5
    await flush();
    click("scopeChannel");
    await flush();
    click("setDefaultBtn");
    expect(lastCall("remember")).toMatchObject({
      action: "remember",
      scope: "channel",
      speed: 1.5,
    });
  });

  it("selecting a speed scope leaves the live-sync scope buttons untouched", async () => {
    await mountApp({ tab: YT });
    click("scopeChannel");
    await flush();
    expect(byId("scopeChannel").classList.contains("active")).toBe(true);
    // The live-sync card keeps its own default (Site) — the speed pick doesn't move it.
    expect(byId("syncScopeSite").classList.contains("active")).toBe(true);
    expect(byId("syncScopeChannel").classList.contains("active")).toBe(false);
    expect(byId("syncScopeGlobal").classList.contains("active")).toBe(false);
  });

  it("dots the slot on Save and clears the dot on Reset", async () => {
    const { replies } = await mountApp({ tab: YT });
    click("scopeSite");
    await flush();
    click("setDefaultBtn");
    await flush();
    expect(byId("scopeSite").classList.contains("has-saved")).toBe(true);
    replies.reset = { success: true };
    replies.getSpeed = { speed: 1, channel: null, channelName: "", scope: null, live: false };
    click("resetBtn");
    await flush();
    expect(byId("scopeSite").classList.contains("has-saved")).toBe(false);
  });

  it("Reset forgets the selected scope and pulls the fallback speed back", async () => {
    const { replies, lastCall } = await mountApp({ tab: YT });
    click("scopeGlobal");
    await flush();
    replies.reset = { success: true };
    replies.getSpeed = { speed: 1.8, channel: null, channelName: "", scope: null, live: false };
    click("resetBtn");
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
    expect(byId("scopeSite").classList.contains("active")).toBe(true);
  });

  it("Save writes the per-site speed to storage when messaging fails", async () => {
    const { saved } = await mountApp({ tab: YT, replies: { getSpeed: undefined } });
    document.querySelector<HTMLElement>('.btn-speed[data-percent="150"]')!.click(); // → 1.5
    await flush();
    click("scopeSite");
    await flush();
    click("setDefaultBtn"); // remember has no reply → falls back to storage
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
    click("scopeSite");
    await flush();
    click("resetBtn"); // reset has no reply → falls back to storage
    await flush();
    expect((saved().domains as Record<string, number>)["youtube.com"]).toBeUndefined();
  });
});
