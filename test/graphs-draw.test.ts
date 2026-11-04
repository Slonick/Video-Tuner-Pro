// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { cornerReadout, fitCanvas, levelMark, smoothLine } from "../src/popup/graphs/draw-util.js";
import { drawAudio } from "../src/popup/graphs/audio-meter.js";
import { drawAutoSlow } from "../src/popup/graphs/autoslow-graph.js";
import { drawBuffer } from "../src/popup/graphs/latency-graph.js";
import { createGraphState } from "../src/popup/graphs/state.js";

interface MockContext extends CanvasRenderingContext2D {
  gradient: { addColorStop: ReturnType<typeof vi.fn> };
}

function mockContext(): MockContext {
  const gradient = { addColorStop: vi.fn() };
  return {
    gradient,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
    fillText: vi.fn(),
    roundRect: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    createLinearGradient: vi.fn(() => gradient),
  } as unknown as MockContext;
}

function canvas(w = 320, h = 80): HTMLCanvasElement {
  const el = document.createElement("canvas");
  Object.defineProperty(el, "clientWidth", { value: w, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: h, configurable: true });
  return el;
}

function graph() {
  const aCanvas = canvas();
  const bCanvas = canvas();
  const asCanvas = canvas();
  const acx = mockContext();
  const bcx = mockContext();
  const ascx = mockContext();
  return {
    g: createGraphState(aCanvas, acx, bCanvas, bcx, asCanvas, ascx),
    acx,
    bcx,
    ascx,
  };
}

describe("fitCanvas", () => {
  it("resizes the backing store when devicePixelRatio changes without a CSS resize", () => {
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 100, configurable: true });
    Object.defineProperty(canvas, "clientHeight", { value: 50, configurable: true });
    const cx = { setTransform: vi.fn() } as unknown as CanvasRenderingContext2D;

    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
    fitCanvas(canvas, cx);
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(50);

    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    fitCanvas(canvas, cx);
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    expect(cx.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
  });

  it("does not reset the backing store when CSS size and DPR are unchanged", () => {
    const el = canvas(100, 50);
    const cx = mockContext();
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });

    fitCanvas(el, cx);
    fitCanvas(el, cx);

    expect(cx.setTransform).toHaveBeenCalledTimes(1);
  });
});

describe("drawing utilities", () => {
  it("draws scale levels without leaking canvas state", () => {
    const cx = mockContext();
    levelMark(cx, -20, "−20", 250, 300, 60, { dash: [2, 3], alpha: 0.4 });

    expect(cx.save).toHaveBeenCalledOnce();
    expect(cx.setLineDash).toHaveBeenCalledWith([2, 3]);
    expect(cx.fillText).toHaveBeenCalledWith("−20", 260, 7);
    expect(cx.restore).toHaveBeenCalledOnce();
  });

  it("draws compact readouts and ignores an empty row set", () => {
    const cx = mockContext();
    cornerReadout(cx, []);
    expect(cx.save).not.toHaveBeenCalled();

    cornerReadout(cx, [
      { label: "Out", value: "−18 dB", color: "blue" },
      { label: "In", value: "−12 dB", color: "gray" },
    ]);
    expect(cx.roundRect).toHaveBeenCalledOnce();
    expect(cx.fillText).toHaveBeenCalledWith("Out", expect.any(Number), expect.any(Number));
    expect(cx.fillText).toHaveBeenCalledWith("−12 dB", expect.any(Number), expect.any(Number));
  });

  it("handles empty, two-point and smoothed polylines", () => {
    const cx = mockContext();
    smoothLine(cx, []);
    expect(cx.moveTo).not.toHaveBeenCalled();

    smoothLine(cx, [
      { x: 0, y: 1 },
      { x: 2, y: 3 },
    ]);
    expect(cx.lineTo).toHaveBeenCalledWith(2, 3);

    smoothLine(cx, [
      { x: 0, y: 1 },
      { x: 2, y: 3 },
      { x: 4, y: 5 },
    ]);
    expect(cx.quadraticCurveTo).toHaveBeenCalled();
  });
});

describe("latency and buffer graph", () => {
  it("shows a live-only hint for ordinary videos", () => {
    const { g, bcx } = graph();
    drawBuffer(g, 10_000, 5);
    expect(bcx.fillText).toHaveBeenCalledWith("Live streams only", 160, 40);
  });

  it("draws mirrored latency and buffer-ahead series with target and bitrate", () => {
    const { g, bcx } = graph();
    g.bufLive = true;
    g.bufAhead = 8;
    g.bufAheadShown = 8;
    g.bufShown = 12;
    g.bufBitrateShown = 2_500_000;
    g.bufHist.push({ t: 9_000, v: 10, a: 7 }, { t: 9_500, v: 12, a: 8 });

    drawBuffer(g, 10_000, 5);

    expect(bcx.createLinearGradient).toHaveBeenCalled();
    expect(bcx.gradient.addColorStop).toHaveBeenCalled();
    expect(bcx.fillText).toHaveBeenCalledWith("5s", expect.any(Number), expect.any(Number));
    expect(bcx.fillText).toHaveBeenCalledWith("≈ 2.5 Mbps", 3, 78);
  });

  it("draws the single buffer series and low-buffer warning without latency", () => {
    const { g, bcx } = graph();
    g.bufLive = true;
    g.bufShown = 4;
    g.bufLimited = true;
    g.bufBitrateShown = 640_000;
    g.bufHist.push({ t: 9_000, v: 3 }, { t: 9_500, v: 4 });

    drawBuffer(g, 10_000, 5);

    expect(bcx.fillText).toHaveBeenCalledWith("5s", expect.any(Number), expect.any(Number));
    expect(bcx.fillText).toHaveBeenCalledWith("≈ 640 kbps", 3, 78);
    expect(bcx.fillText).toHaveBeenCalledWith("⚠ Low buffer — catch-up limited", 317, 78);
  });
});

describe("audio graph", () => {
  it("shows disabled and waiting states instead of a fake −100 dB reading", () => {
    const { g, acx } = graph();
    drawAudio(g, 1_000, -24);
    expect(acx.fillText).toHaveBeenCalledWith("Compression off", expect.any(Number), 40);

    acx.fillText.mockClear();
    g.audioEnabled = true;
    drawAudio(g, 1_000, -24);
    expect(acx.fillText).toHaveBeenCalledWith("Waiting for audio…", expect.any(Number), 40);
  });

  it("draws input, output, threshold line + highlight and labelled readout", () => {
    const { g, acx } = graph();
    g.audioActive = true;
    g.audioEnabled = true;
    g.compAnim = 1;
    g.audioHist.push({ t: 900, in: -12, out: -20 }, { t: 950, in: -8, out: -18 });

    drawAudio(g, 1_000, -24);

    expect(acx.createLinearGradient).toHaveBeenCalled();
    expect(acx.setLineDash).toHaveBeenCalledWith([3, 3]);
    expect(acx.fillText).toHaveBeenCalledWith("−24 dB", expect.any(Number), expect.any(Number));
    expect(acx.fillText).toHaveBeenCalledWith("Out", expect.any(Number), expect.any(Number));
    expect(acx.fillText).toHaveBeenCalledWith("In", expect.any(Number), expect.any(Number));
  });
});

describe("auto-slow graph", () => {
  it("shows distinct disabled and listening hints", () => {
    const { g, ascx } = graph();
    drawAutoSlow(g, 1_000);
    expect(ascx.fillText).toHaveBeenCalledWith(
      "Auto-slow off",
      expect.any(Number),
      expect.any(Number),
    );

    ascx.fillText.mockClear();
    g.asEnabled = true;
    drawAutoSlow(g, 1_000);
    expect(ascx.fillText).toHaveBeenCalledWith(
      "Waiting for speech…",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("draws speech-rate and resulting-speed series", () => {
    const { g, ascx } = graph();
    g.asEnabled = true;
    g.asHist.push({ t: 900, rate: 8, speed: 1.4 }, { t: 950, rate: 10, speed: 1.2 });

    drawAutoSlow(g, 1_000);

    expect(ascx.stroke).toHaveBeenCalledTimes(3);
    expect(ascx.lineTo).toHaveBeenCalled();
  });
});
