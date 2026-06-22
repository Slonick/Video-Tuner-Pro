// @vitest-environment jsdom
// In the on-video overlay the popup is an embedded iframe. Firefox can't resolve the
// host tab via tabs.query({active,currentWindow}) there (and may not expose tabs.* at
// all), so getActiveTab + the content messaging must route through the background
// (whoami / relayToTab) instead of tabs.*.
import { describe, it, expect, vi, afterEach } from "vitest";

const realTop = Object.getOwnPropertyDescriptor(window, "top");

afterEach(() => {
  if (realTop) Object.defineProperty(window, "top", realTop);
  vi.resetModules();
});

function embed(responses: Record<string, unknown>): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      lastError: null,
      sendMessage: (msg: Record<string, unknown>, cb: (r: unknown) => void) => {
        sent.push(msg);
        cb(responses[msg.action as string]);
      },
    },
    tabs: {
      query: () => {
        throw new Error("tabs.query must not run when embedded");
      },
      sendMessage: () => {
        throw new Error("tabs.sendMessage must not run when embedded");
      },
    },
  };
  Object.defineProperty(window, "top", { value: {}, configurable: true });
  return sent;
}

describe("popup embedded (overlay) routing", () => {
  it("resolves the host tab via the background, not tabs.query", async () => {
    const sent = embed({ whoami: { tab: { id: 42, url: "https://example.com/" } } });
    vi.resetModules();
    const { EMBEDDED, getActiveTab } = await import("../src/popup/platform/browser.js");
    expect(EMBEDDED).toBe(true);
    expect(await getActiveTab()).toEqual({ id: 42, url: "https://example.com/" });
    expect(sent).toContainEqual({ action: "whoami" });
  });

  it("relays content-script messages through the background", async () => {
    const sent = embed({ relayToTab: { success: true, speed: 1.5 } });
    vi.resetModules();
    const { sendToTab } = await import("../src/popup/platform/browser.js");
    expect(await sendToTab(42, { action: "setSpeed", speed: 1.5 })).toEqual({
      success: true,
      speed: 1.5,
    });
    expect(sent).toContainEqual({
      action: "relayToTab",
      tabId: 42,
      msg: { action: "setSpeed", speed: 1.5 },
    });
  });
});
