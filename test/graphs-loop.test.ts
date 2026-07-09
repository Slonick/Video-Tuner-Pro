// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function canvas(id: string): HTMLCanvasElement {
  const el = document.createElement("canvas");
  el.id = id;
  el.getContext = vi.fn(() => ({})) as unknown as HTMLCanvasElement["getContext"];
  document.body.appendChild(el);
  return el;
}

describe("setupGraphs", () => {
  it("backs off drawing while every graph is idle", async () => {
    vi.useFakeTimers();
    const drawAudio = vi.fn();
    const drawBuffer = vi.fn();
    const drawAutoSlow = vi.fn();
    vi.doMock("../src/popup/graphs/audio-meter.js", () => ({ drawAudio }));
    vi.doMock("../src/popup/graphs/latency-graph.js", () => ({ drawBuffer }));
    vi.doMock("../src/popup/graphs/autoslow-graph.js", () => ({ drawAutoSlow }));
    vi.doMock("../src/popup/graphs/poll.js", () => ({ startPoll: () => () => {} }));
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => Number(setTimeout(() => cb(Date.now()), 16))),
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => clearTimeout(id)),
    );
    canvas("audioMeter");
    canvas("bufferMeter");
    canvas("autoSlowMeter");
    const { setupGraphs } = await import("../src/popup/graphs/index.js");

    const stop = setupGraphs(
      () => 1,
      () => {},
      () => {},
    );
    await vi.advanceTimersByTimeAsync(1000);
    stop();

    expect(drawAudio.mock.calls.length).toBeLessThanOrEqual(5);
    expect(drawBuffer.mock.calls.length).toBe(drawAudio.mock.calls.length);
    expect(drawAutoSlow.mock.calls.length).toBe(drawAudio.mock.calls.length);
  });
});
