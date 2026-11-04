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
  it("still reports the last fraction of a second before the buffered end", () => {
    expect(forwardBuffer(fakeVideo([[0, 10]], 9.9))).toBeCloseTo(0.1, 5);
  });
  it("counts a playhead up to 0.25s before a range start as inside it", () => {
    expect(forwardBuffer(fakeVideo([[10, 30]], 9.75))).toBe(20.25);
  });
  it("returns 0 when the playhead is before or between buffered ranges", () => {
    expect(forwardBuffer(fakeVideo([[50, 80]], 10))).toBe(0);
    expect(
      forwardBuffer(
        fakeVideo(
          [
            [0, 5],
            [50, 80],
          ],
          20,
        ),
      ),
    ).toBe(0);
  });
  it("never reports a negative buffer just past a range end", () => {
    expect(forwardBuffer(fakeVideo([[0, 10]], 10.2))).toBe(0);
  });
  it("measures from the next range when the playhead sits in a tiny gap", () => {
    expect(
      forwardBuffer(
        fakeVideo(
          [
            [0, 10],
            [10.3, 30],
          ],
          10.1,
        ),
      ),
    ).toBeCloseTo(19.9, 5);
  });
  it("measures across a tiny gap from a playhead stalled at the range end", () => {
    expect(
      forwardBuffer(
        fakeVideo(
          [
            [0, 10],
            [10.2, 30],
          ],
          10,
        ),
      ),
    ).toBe(20);
  });
});
