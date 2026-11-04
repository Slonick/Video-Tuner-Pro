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

const guides = () => ({ threshold: -60, target: 5 });

describe("setupGraphs", () => {
  it("does not start polling when the required canvases are not mounted yet", async () => {
    const startPoll = vi.fn(() => () => {});
    vi.doMock("../src/popup/graphs/poll.js", () => ({ startPoll }));
    const { setupGraphs } = await import("../src/popup/graphs/index.js");

    const stop = setupGraphs(
      () => 1,
      () => {},
      () => {},
      guides,
    );
    stop();

    expect(startPoll).not.toHaveBeenCalled();
  });

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
      guides,
    );
    await vi.advanceTimersByTimeAsync(1000);
    stop();

    expect(drawAudio.mock.calls.length).toBeLessThanOrEqual(5);
    expect(drawBuffer.mock.calls.length).toBe(drawAudio.mock.calls.length);
    expect(drawAutoSlow.mock.calls.length).toBe(drawAudio.mock.calls.length);
  });

  it("keeps an active graph on the animation-frame path and tears it down", async () => {
    vi.useFakeTimers();
    const drawAudio = vi.fn();
    const drawBuffer = vi.fn();
    const drawAutoSlow = vi.fn();
    const startPoll = vi.fn((state: { audioActive: boolean; audioEnabled: boolean }) => {
      state.audioActive = true;
      state.audioEnabled = true;
      return vi.fn();
    });
    vi.doMock("../src/popup/graphs/audio-meter.js", () => ({ drawAudio }));
    vi.doMock("../src/popup/graphs/latency-graph.js", () => ({ drawBuffer }));
    vi.doMock("../src/popup/graphs/autoslow-graph.js", () => ({ drawAutoSlow }));
    vi.doMock("../src/popup/graphs/poll.js", () => ({ startPoll }));
    const raf = vi.fn((cb: FrameRequestCallback) => Number(setTimeout(() => cb(Date.now()), 16)));
    const cancel = vi.fn((id: number) => clearTimeout(id));
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    canvas("audioMeter");
    canvas("bufferMeter");
    canvas("autoSlowMeter");

    const { setupGraphs } = await import("../src/popup/graphs/index.js");
    const stop = setupGraphs(
      () => 1,
      () => {},
      () => {},
      guides,
    );
    await vi.advanceTimersByTimeAsync(100);
    const frames = drawAudio.mock.calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(100);

    expect(startPoll).toHaveBeenCalledTimes(1);
    expect(frames).toBeGreaterThan(3);
    expect(drawBuffer).toHaveBeenCalledTimes(frames);
    expect(drawAutoSlow).toHaveBeenCalledTimes(frames);
    expect(cancel).toHaveBeenCalled();
    expect(drawAudio.mock.calls.length).toBe(frames);
  });

  // The threshold / target sliders are React state, not form inputs — the frame
  // must draw whatever the getter currently reports, not a DOM read.
  it("draws the guide lines from the latest getter values", async () => {
    vi.useFakeTimers();
    const drawAudio = vi.fn();
    const drawBuffer = vi.fn();
    vi.doMock("../src/popup/graphs/audio-meter.js", () => ({ drawAudio }));
    vi.doMock("../src/popup/graphs/latency-graph.js", () => ({ drawBuffer }));
    vi.doMock("../src/popup/graphs/autoslow-graph.js", () => ({ drawAutoSlow: vi.fn() }));
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
    const current = { threshold: -30, target: 7 };

    const { setupGraphs } = await import("../src/popup/graphs/index.js");
    const stop = setupGraphs(
      () => 1,
      () => {},
      () => {},
      () => current,
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(drawAudio.mock.calls.at(-1)?.[2]).toBe(-30);
    expect(drawBuffer.mock.calls.at(-1)?.[2]).toBe(7);

    current.threshold = -12;
    current.target = 15;
    await vi.advanceTimersByTimeAsync(300);
    stop();
    expect(drawAudio.mock.calls.at(-1)?.[2]).toBe(-12);
    expect(drawBuffer.mock.calls.at(-1)?.[2]).toBe(15);
  });

  // The audio/speech windows are short (6s/8s), so a throttled sample makes the
  // live edge step by a visible slice of the width every time a point lands. Both
  // record per frame; only the 30s buffer graph keeps its throttle.
  it("records an audio and speech point every frame, and throttles the buffer", async () => {
    vi.useFakeTimers();
    vi.doMock("../src/popup/graphs/audio-meter.js", () => ({ drawAudio: vi.fn() }));
    vi.doMock("../src/popup/graphs/latency-graph.js", () => ({ drawBuffer: vi.fn() }));
    vi.doMock("../src/popup/graphs/autoslow-graph.js", () => ({ drawAutoSlow: vi.fn() }));
    let graph: {
      audioHist: unknown[];
      asHist: unknown[];
      bufHist: unknown[];
    } | null = null;
    vi.doMock("../src/popup/graphs/poll.js", () => ({
      startPoll: (state: Record<string, unknown>) => {
        state.audioActive = true;
        state.asActive = true;
        state.bufLive = true;
        state.bufSmooth = 4;
        graph = state as unknown as typeof graph;
        return vi.fn();
      },
    }));
    let clock = 0;
    vi.stubGlobal("performance", { now: () => clock });
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) =>
        Number(
          setTimeout(() => {
            clock += 16;
            cb(clock);
          }, 16),
        ),
      ),
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
      guides,
    );
    await vi.advanceTimersByTimeAsync(16 * 10);
    stop();

    const g = graph as unknown as { audioHist: unknown[]; asHist: unknown[]; bufHist: unknown[] };
    expect(g.audioHist.length).toBeGreaterThanOrEqual(10);
    expect(g.asHist.length).toBe(g.audioHist.length);
    // 160ms of frames at an 80ms sample step — a fraction of the per-frame count.
    expect(g.bufHist.length).toBeLessThanOrEqual(3);
  });
});
