import { describe, it, expect } from "vitest";
import { createMockChrome } from "./mocks/chrome.js";
import { loadMessages } from "./mocks/locale.js";
import { scenario } from "./mocks/scenarios.js";

describe("createMockChrome", () => {
  it("storage round-trips and get() filters by requested keys", () => {
    const c = createMockChrome({ settings: { audioComp: true, liveSyncTarget: 5 } });
    let got: Record<string, unknown> = {};
    c.storage.sync.get(["liveSyncTarget"], (r) => {
      got = r;
    });
    expect(got).toEqual({ liveSyncTarget: 5 });
    c.storage.sync.set({ liveSyncTarget: 8 });
    c.storage.sync.get(["liveSyncTarget"], (r) => {
      got = r;
    });
    expect(got).toEqual({ liveSyncTarget: 8 });
  });

  it("i18n returns the message and substitutes placeholders", () => {
    const c = createMockChrome({ messages: { hi: { message: "Catch-up $1%" } } });
    expect(c.i18n.getMessage("hi", ["130"])).toBe("Catch-up 130%");
    expect(c.i18n.getMessage("missing")).toBe("");
  });

  it("tabs.sendMessage routes actions to scenario data", () => {
    const c = createMockChrome(scenario("live"));
    let mon: any, sp: any;
    c.tabs.sendMessage(1, { action: "getMonitor" }, (r) => {
      mon = r;
    });
    c.tabs.sendMessage(1, { action: "getSpeed" }, (r) => {
      sp = r;
    });
    expect(mon.live).toBe(true);
    expect(typeof mon.buffer).toBe("number");
    expect(sp.speed).toBe(1.3);
  });
});

describe("loadMessages", () => {
  it("loads real locale strings from disk", async () => {
    const en = await loadMessages("en");
    expect(en.meterLatency.message).toBe("Latency");
    expect(typeof en.extName.message).toBe("string");
  });
});
