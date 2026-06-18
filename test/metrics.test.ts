import { describe, it, expect } from "vitest";
import { forwardBuffer } from "../src/content/live/metrics.js";

function fakeVideo(ranges: [number, number][], currentTime: number) {
  return {
    currentTime,
    buffered: {
      length: ranges.length,
      start: (i: number) => ranges[i][0],
      end: (i: number) => ranges[i][1],
    },
  } as unknown as HTMLVideoElement;
}

describe("forwardBuffer", () => {
  it("returns seconds buffered ahead within the active range", () => {
    expect(forwardBuffer(fakeVideo([[0, 30]], 10))).toBe(20);
  });
  it("picks the range containing currentTime", () => {
    expect(
      forwardBuffer(
        fakeVideo(
          [
            [0, 5],
            [50, 80],
          ],
          60,
        ),
      ),
    ).toBe(20);
  });
  it("returns 0 when currentTime is in no range", () => {
    expect(forwardBuffer(fakeVideo([[0, 5]], 40))).toBe(0);
  });
  it("returns 0 for empty buffered", () => {
    expect(forwardBuffer(fakeVideo([], 0))).toBe(0);
  });
});
