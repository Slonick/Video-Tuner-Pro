// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountApp, byId, flush, wait } from "./mocks/mount-popup.js";

// The live-sync card via the real <App/>: the allowed delay is saved per scope
// (channel > site > global > 5s) via messaging — dragging previews live (setTarget),
// Save commits (rememberTarget), Reset clears (resetTarget).
const EX = { id: 3, url: "https://example.com/" };
const click = (id: string) => byId(id).click();

describe("loadSyncSettings", () => {
  it("reflects the resolved target + scope from getTarget", async () => {
    await mountApp({
      tab: EX,
      replies: {
        getTarget: { target: 12, scope: "site", channel: null, channelName: "", live: false },
      },
    });
    expect((byId("syncTarget") as HTMLInputElement).value).toBe("12");
    expect(byId("syncTargetVal").textContent).toBe("12");
    expect(byId("syncScopeSite").classList.contains("active")).toBe(true);
  });

  it("shows the Channel segment and preselects it when the target came from the channel", async () => {
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
    expect(byId("syncScopeSeg").classList.contains("has-channel")).toBe(true);
    expect(byId("syncScopeChannel").classList.contains("active")).toBe(true);
  });

  it("dots the slots that hold a saved delay", async () => {
    await mountApp({
      tab: EX,
      settings: { syncTargets: { "example.com": 8 }, syncTargetGlobal: 12 },
      replies: {
        getTarget: { target: 8, scope: "site", channel: null, channelName: "", live: false },
      },
    });
    expect(byId("syncScopeSite").classList.contains("has-saved")).toBe(true);
    expect(byId("syncScopeGlobal").classList.contains("has-saved")).toBe(true);
    expect(byId("syncScopeChannel").classList.contains("has-saved")).toBe(false);
  });

  it("preselects Site (never Global) when the delay came from the global scope", async () => {
    await mountApp({
      tab: EX,
      replies: {
        getTarget: { target: 12, scope: "global", channel: null, channelName: "", live: false },
      },
    });
    expect(byId("syncScopeSite").classList.contains("active")).toBe(true);
    expect(byId("syncScopeGlobal").classList.contains("active")).toBe(false);
  });

  it("clamps an out-of-range target from the page", async () => {
    await mountApp({
      tab: EX,
      replies: {
        getTarget: { target: 999, scope: "site", channel: null, channelName: "", live: false },
      },
    });
    expect((byId("syncTarget") as HTMLInputElement).value).toBe("30");
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
    expect((byId("syncTarget") as HTMLInputElement).value).toBe("6");
    expect(byId("syncTargetVal").textContent).toBe("6");
    click("syncDown");
    click("syncDown");
    await flush();
    expect((byId("syncTarget") as HTMLInputElement).value).toBe("4");
    await wait(220); // 160 ms preview debounce
    expect(lastCall("setTarget")).toMatchObject({ action: "setTarget", target: 4 });
  });

  it("the slider previews live (setTarget) without persisting", async () => {
    const { lastCall, saved } = await mountApp({ tab: EX });
    const slider = byId("syncTarget") as HTMLInputElement;
    slider.value = "9";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(byId("syncTargetVal").textContent).toBe("9");
    await wait(220);
    expect(lastCall("setTarget")).toMatchObject({ action: "setTarget", target: 9 });
    expect((saved().syncTargets as Record<string, number>) ?? {}).not.toHaveProperty("example.com");
  });
});

describe("save / reset by scope", () => {
  it("Save sends rememberTarget for the selected scope and dots the slot", async () => {
    const { lastCall } = await mountApp({ tab: EX });
    click("syncScopeSite");
    await flush();
    click("syncUp"); // 5 → 6
    await flush();
    click("syncSetBtn");
    await flush();
    expect(lastCall("rememberTarget")).toMatchObject({
      action: "rememberTarget",
      scope: "site",
      target: 6,
    });
    expect(byId("syncScopeSite").classList.contains("has-saved")).toBe(true);
  });

  it("Reset clears the slot, sends resetTarget, and pulls the new value back", async () => {
    const { replies, lastCall } = await mountApp({ tab: EX });
    click("syncScopeSite");
    await flush();
    replies.resetTarget = { success: true };
    replies.getTarget = { target: 5, scope: null, channel: null, channelName: "", live: false };
    click("syncResetBtn");
    expect(lastCall("resetTarget")).toMatchObject({ action: "resetTarget", scope: "site" });
    await wait(120); // deferred getTarget
    expect((byId("syncTarget") as HTMLInputElement).value).toBe("5");
  });
});

describe("no content script (storage fallback)", () => {
  it("resolves the target from storage when the page doesn't answer", async () => {
    await mountApp({
      tab: EX,
      settings: { syncTargets: { "example.com": 9 } },
      replies: { getTarget: undefined },
    });
    expect((byId("syncTarget") as HTMLInputElement).value).toBe("9");
    expect(byId("syncScopeSite").classList.contains("active")).toBe(true);
  });
});
