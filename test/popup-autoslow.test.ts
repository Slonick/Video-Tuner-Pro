// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountApp, byId, flush, wait } from "./mocks/mount-popup.js";

// The auto-slow card via the real <App/>: enable + target rate are saved per scope
// (channel > site > global) via messaging — the toggle/slider preview live
// (setAutoSlow), Save commits (rememberAutoSlow), Reset clears (resetAutoSlow).
const EX = { id: 4, url: "https://example.com/" };
const click = (id: string) => byId(id).click();
const reply = (over: Record<string, unknown> = {}) => ({
  getAutoSlow: { enabled: true, target: 6, scope: "site", channel: null, ...over },
});

describe("auto-slow card", () => {
  it("reflects the resolved enable + target + scope from getAutoSlow", async () => {
    await mountApp({ tab: EX, replies: reply({ target: 8 }) });
    expect((byId("autoSlowToggle") as HTMLInputElement).checked).toBe(true);
    expect((byId("autoSlowTarget") as HTMLInputElement).value).toBe("8");
    expect(byId("autoScopeSite").classList.contains("active")).toBe(true);
  });

  it("preselects the Channel scope when the bundle came from a channel", async () => {
    await mountApp({ tab: EX, replies: reply({ scope: "channel", channel: "twitch:x" }) });
    expect(byId("autoScopeSeg").classList.contains("has-channel")).toBe(true);
    expect(byId("autoScopeChannel").classList.contains("active")).toBe(true);
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
    const s = byId("autoSlowTarget") as HTMLInputElement;
    s.value = "9";
    s.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(220);
    expect(lastCall("setAutoSlow")).toMatchObject({ action: "setAutoSlow", target: 9 });
  });

  it("Save sends rememberAutoSlow for the selected scope", async () => {
    const { lastCall } = await mountApp({ tab: EX, replies: reply({ target: 7 }) });
    click("autoSlowSetBtn");
    await flush();
    expect(lastCall("rememberAutoSlow")).toMatchObject({
      action: "rememberAutoSlow",
      scope: "site",
      enabled: true,
      target: 7,
    });
  });

  it("Reset sends resetAutoSlow and pulls the re-resolved value back", async () => {
    const { replies, lastCall } = await mountApp({ tab: EX, replies: reply({ target: 8 }) });
    replies.resetAutoSlow = { success: true };
    replies.getAutoSlow = { enabled: false, target: 6, scope: null, channel: null };
    click("autoSlowResetBtn");
    await wait(120);
    expect(lastCall("resetAutoSlow")).toMatchObject({ action: "resetAutoSlow", scope: "site" });
  });
});
