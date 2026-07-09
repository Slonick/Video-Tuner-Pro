// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fitCanvas } from "../src/popup/graphs/draw-util.js";

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
});
