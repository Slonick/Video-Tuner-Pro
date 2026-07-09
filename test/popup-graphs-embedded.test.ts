// @vitest-environment jsdom
// The graphs (audio meter, latency, auto-slow) are fed by polling the page's content
// script for monitor/history data. In the on-video overlay the popup is an embedded
// iframe, and on Firefox tabs.* can't reach the content script from there — so the
// poll must route through the background relay (relayToTab), exactly like the rest of
// the embedded popup. Regression guard: poll.ts once called tabs.sendMessage directly,
// which threw under Firefox's overlay and left every graph empty.
import { describe, it, expect, vi, afterEach } from "vitest";
import type { GraphState } from "../src/popup/graphs/state.js";

const realTop = Object.getOwnPropertyDescriptor(window, "top");

afterEach(() => {
  if (realTop) Object.defineProperty(window, "top", realTop);
  vi.useRealTimers();
  vi.resetModules();
});

// Firefox overlay: no `browser` promise API exposed here, tabs.* throws, and the
// only way out is runtime.sendMessage to the background. relayToTab replies with the
// content script's answer to its inner `msg.action`.
function embed(replies: Record<string, unknown>): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  (globalThis as unknown as { browser?: unknown }).browser = undefined;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      lastError: null,
      sendMessage: (msg: Record<string, unknown>, cb: (r: unknown) => void) => {
        sent.push(msg);
        const inner = (msg.msg as { action?: string } | undefined)?.action;
        cb(msg.action === "relayToTab" && inner ? replies[inner] : undefined);
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

// A GraphState carrying only the canvases poll.ts never touches — it reads/writes
// plain data fields, so stub elements are enough (jsdom has no 2D context anyway).
async function makeState(): Promise<GraphState> {
  const { createGraphState } = await import("../src/popup/graphs/state.js");
  const canvas = {} as HTMLCanvasElement;
  const ctx = {} as CanvasRenderingContext2D;
  return createGraphState(canvas, ctx, canvas, ctx, null, null);
}

describe("graph polling under the Firefox overlay", () => {
  it("polls monitor data through the background relay, never tabs.sendMessage", async () => {
    const sent = embed({
      getMonitor: { audio: { active: true, enabled: true, in: -20, out: -25 } },
    });
    vi.resetModules();
    vi.useFakeTimers();
    const { startPoll } = await import("../src/popup/graphs/poll.js");
    const g = await makeState();

    const stop = startPoll(
      g,
      () => 42,
      () => {},
      () => {},
    );
    await vi.advanceTimersByTimeAsync(80);
    stop();

    expect(sent).toContainEqual({
      action: "relayToTab",
      tabId: 42,
      msg: { action: "getMonitor" },
      route: "video",
    });
    expect(g.audioActive).toBe(true);
    expect(g.tgt.in).toBe(-20);
    expect(g.tgt.out).toBe(-25);
  });

  it("backs off monitor polling while all graphs are idle", async () => {
    const sent = embed({ getMonitor: {} });
    vi.resetModules();
    vi.useFakeTimers();
    const { startPoll } = await import("../src/popup/graphs/poll.js");
    const g = await makeState();

    const stop = startPoll(
      g,
      () => 42,
      () => {},
      () => {},
    );
    await vi.advanceTimersByTimeAsync(80);
    expect(sent).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(900);
    expect(sent).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(100);
    stop();
    expect(sent).toHaveLength(2);
  });

  it("seeds history through the relay too once a graph goes active", async () => {
    const sent = embed({
      getMonitor: { audio: { active: true, enabled: true, in: -10, out: -10 } },
      getHistory: { audio: [[-30, -30]], audioStep: 150 },
    });
    vi.resetModules();
    vi.useFakeTimers();
    const { startPoll } = await import("../src/popup/graphs/poll.js");
    const g = await makeState();

    const stop = startPoll(
      g,
      () => 7,
      () => {},
      () => {},
    );
    await vi.advanceTimersByTimeAsync(160);
    stop();

    expect(sent).toContainEqual({
      action: "relayToTab",
      tabId: 7,
      msg: { action: "getHistory" },
      route: "video",
    });
    expect(g.histSeeded).toBe(true);
    expect(g.audioHist.length).toBeGreaterThan(0);
  });
});

describe("graph polling in the toolbar popup (Chrome / non-embedded)", () => {
  it("talks to the content script directly via tabs.sendMessage", async () => {
    const calls: { tabId: number; msg: Record<string, unknown> }[] = [];
    (globalThis as unknown as { browser?: unknown }).browser = undefined;
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { lastError: null },
      tabs: {
        sendMessage: (tabId: number, msg: Record<string, unknown>, cb: (r: unknown) => void) => {
          calls.push({ tabId, msg });
          if (msg.action === "getMonitor")
            cb({ audio: { active: true, enabled: true, in: -5, out: -5 } });
          else cb(undefined);
        },
      },
    };
    Object.defineProperty(window, "top", { value: window, configurable: true });
    vi.resetModules();
    vi.useFakeTimers();
    const { startPoll } = await import("../src/popup/graphs/poll.js");
    const g = await makeState();

    const stop = startPoll(
      g,
      () => 99,
      () => {},
      () => {},
    );
    await vi.advanceTimersByTimeAsync(80);
    stop();

    expect(calls).toContainEqual({ tabId: 99, msg: { action: "getMonitor" } });
    expect(g.audioActive).toBe(true);
  });
});
