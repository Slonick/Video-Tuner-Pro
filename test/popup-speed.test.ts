// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMockChrome } from "./mocks/chrome.js";

// Drive the popup's speed card directly: stub tabs.sendMessage so we control the
// content-script replies, then exercise the buttons / slider / nudge / live-lock /
// channel-menu wiring.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const byId = (id: string) => document.getElementById(id) as HTMLElement;

let init: () => Promise<void>;
let pollSpeed: () => void;
let ctx: { activeTabId: number | null; currentDomain: string; liveMisses: number };
let sendSpy: ReturnType<typeof vi.fn>;
// What a tabs.sendMessage(action) call resolves to, per test.
let replies: Record<string, unknown>;

beforeAll(async () => {
  const html = read("../src/popup/popup.html");
  document.body.innerHTML = html.replace(/[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*/, "")
    .replace(/<script[\s\S]*?<\/script>/g, "");
  const messages = JSON.parse(read("../src/_locales/en/messages.json"));
  const chrome = createMockChrome({ messages, tab: { id: 7, url: "https://www.youtube.com/watch?v=x" } });
  (globalThis as unknown as { chrome: typeof chrome }).chrome = chrome;

  ({ init, pollSpeed } = await import("../src/popup/speed.js"));
  ({ ctx } = await import("../src/popup/state.js"));
});

beforeEach(async () => {
  const chrome = globalThis.chrome;
  chrome.runtime.lastError = undefined as unknown as chrome.runtime.LastError;
  replies = {
    getSpeed: { speed: 1, domain: "youtube.com", channel: null, channelName: "", live: false },
    setSpeed: { success: true, speed: undefined, live: false },
  };
  sendSpy = vi.spyOn(chrome.tabs, "sendMessage").mockImplementation(((_id: number, msg: { action: string; speed?: number }, cb?: (r?: unknown) => void) => {
    const base = replies[msg.action] as Record<string, unknown> | undefined;
    // setSpeed echoes the requested speed unless a test overrides it.
    const resp = base && msg.action === "setSpeed" && base.speed === undefined ? { ...base, speed: msg.speed } : base;
    cb?.(resp);
  }) as unknown as typeof chrome.tabs.sendMessage) as unknown as ReturnType<typeof vi.fn>;
  // Populate ctx.activeTabId / currentDomain so the action senders actually fire.
  await init();
});

afterEach(() => {
  vi.useRealTimers();   // never let a failed fake-timer test leak into the next
  sendSpy.mockClear();
});

const lastCall = (action: string) => sendSpy.mock.calls.filter((c) => (c[1] as { action: string }).action === action).at(-1)?.[1];

describe("speed buttons & readout", () => {
  it("a preset button sets the readout and pushes the speed to the page", () => {
    byId("currentSpeedPct").textContent = "100%";
    document.querySelector<HTMLElement>('.btn-speed[data-percent="150"]')!.click();
    expect(byId("currentSpeedPct").textContent).toBe("150%");
    expect(lastCall("setSpeed")).toMatchObject({ action: "setSpeed", speed: 1.5 });
  });

  it("the + / − nudges step the speed by 5%", () => {
    byId("currentSpeedPct").textContent = "100%";
    byId("speedUp").click();
    expect(byId("currentSpeedPct").textContent).toBe("105%");
    byId("speedDown").click();
    expect(byId("currentSpeedPct").textContent).toBe("100%");
  });

  it("reset returns to 100%", () => {
    byId("currentSpeedPct").textContent = "175%";
    byId("resetBtn").click();
    expect(byId("currentSpeedPct").textContent).toBe("100%");
  });
});

describe("slider", () => {
  it("input updates the readout immediately and applies after the debounce", () => {
    vi.useFakeTimers();
    const slider = byId("speedSlider") as HTMLInputElement;
    slider.value = "130";
    slider.dispatchEvent(new Event("input"));
    expect(byId("currentSpeedPct").textContent).toBe("130%");
    vi.advanceTimersByTime(160);
    expect(lastCall("setSpeed")).toMatchObject({ speed: 1.3 });
    vi.useRealTimers();
  });

  it("release (change) applies immediately", () => {
    const slider = byId("speedSlider") as HTMLInputElement;
    slider.value = "120";
    slider.dispatchEvent(new Event("change"));
    expect(lastCall("setSpeed")).toMatchObject({ speed: 1.2 });
  });
});

describe("live lock", () => {
  it("locks the speed controls and shows the warning when the page is a live stream", async () => {
    replies.getSpeed = { speed: 1, domain: "youtube.com", channel: null, channelName: "", live: true };
    await init();
    await new Promise((r) => setTimeout(r, 0));
    expect(byId("liveWarn").style.display).toBe("inline-flex");
    expect(document.querySelector(".speed-section")?.classList.contains("locked")).toBe(true);
  });

  it("unlocks again on a non-live page", async () => {
    replies.getSpeed = { speed: 1, domain: "youtube.com", channel: null, channelName: "", live: false };
    await init();
    await new Promise((r) => setTimeout(r, 0));
    expect(byId("liveWarn").style.display).toBe("none");
    expect(document.querySelector(".speed-section")?.classList.contains("locked")).toBe(false);
  });
});

describe("channel menus", () => {
  it("shows the channel scope label and channel affordance on a YouTube watch page", async () => {
    replies.getSpeed = { speed: 1, domain: "youtube.com", channel: "UCabc", channelName: "Some Channel", live: false };
    await init();
    await new Promise((r) => setTimeout(r, 0));
    expect(byId("speedScope").textContent).toBe("Some Channel");
    expect(byId("resetSplit").classList.contains("has-channel")).toBe(true);
  });

  it("a caret opens its split menu and clicking elsewhere closes it", () => {
    const caret = byId("resetCaret");
    caret.click();
    expect(caret.closest(".split")?.classList.contains("open")).toBe(true);
    document.body.click();
    expect(document.querySelector(".split.open")).toBeNull();
  });

  it("remember-channel pushes a rememberChannel message", () => {
    byId("currentSpeedPct").textContent = "140%";
    byId("rememberChannelBtn").click();
    expect(lastCall("rememberChannel")).toMatchObject({ action: "rememberChannel", speed: 1.4 });
  });

  it("reset-channel resets and pulls the fallback speed back into the readout", () => {
    vi.useFakeTimers();
    replies.resetChannel = { success: true };
    // The content falls back to the domain speed (or 100%); the popup re-reads it.
    replies.getSpeed = { speed: 1.8, domain: "youtube.com", channel: null, channelName: "", live: false };
    byId("resetChannelBtn").click();
    expect(lastCall("resetChannel")).toMatchObject({ action: "resetChannel" });
    vi.advanceTimersByTime(80);         // deferred getSpeed round-trip
    expect(byId("currentSpeedPct").textContent).toBe("180%");
    vi.useRealTimers();
  });
});

describe("pollSpeed", () => {
  it("locks and updates the readout while the page reports live", () => {
    ctx.liveMisses = 0;
    replies.getSpeed = { speed: 1.6, domain: "youtube.com", channel: null, channelName: "", live: true };
    pollSpeed();
    expect(byId("liveWarn").style.display).toBe("inline-flex");
    expect(byId("currentSpeedPct").textContent).toBe("160%");
  });

  it("unlocks only after several consecutive non-live polls (debounced)", () => {
    // Start locked.
    replies.getSpeed = { speed: 1, domain: "youtube.com", channel: null, channelName: "", live: true };
    pollSpeed();
    expect(document.querySelector(".speed-section")?.classList.contains("locked")).toBe(true);

    ctx.liveMisses = 0;
    replies.getSpeed = { speed: 1, domain: "youtube.com", channel: null, channelName: "", live: false };
    pollSpeed(); pollSpeed(); pollSpeed();
    expect(document.querySelector(".speed-section")?.classList.contains("locked")).toBe(true); // 3 misses < 4
    pollSpeed();
    expect(document.querySelector(".speed-section")?.classList.contains("locked")).toBe(false); // 4th miss unlocks
  });

  it("no-ops when there is no active tab", () => {
    ctx.activeTabId = null;
    const before = sendSpy.mock.calls.length;
    pollSpeed();
    expect(sendSpy.mock.calls.length).toBe(before);
  });
});
