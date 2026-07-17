import { describe, it, expect } from "vitest";
import { anchorFromRect, positionFromAnchor } from "../src/content/chat/anchor.js";

// The floating chat panel remembers its spot relative to the video box's
// nearest edges: the half the panel's center falls in picks the edge, and the
// distance to it survives box moves and resizes.
const box = { left: 100, top: 50, width: 800, height: 450 };

describe("chat panel anchoring", () => {
  it("anchors to the left/top edges when the panel sits in the top-left quadrant", () => {
    const a = anchorFromRect({ left: 120, top: 70, width: 200, height: 150 }, box);
    expect(a).toEqual({ h: "left", v: "top", dx: 20, dy: 20 });
  });

  it("anchors to the right/bottom edges when the panel sits in the bottom-right quadrant", () => {
    const a = anchorFromRect({ left: 660, top: 320, width: 200, height: 150 }, box);
    // right edge: 900 - (660+200) = 40; bottom edge: 500 - (320+150) = 30.
    expect(a).toEqual({ h: "right", v: "bottom", dx: 40, dy: 30 });
  });

  it("keeps a negative distance when the panel hangs past the box edge", () => {
    const a = anchorFromRect({ left: 60, top: 70, width: 200, height: 150 }, box);
    expect(a.h).toBe("left");
    expect(a.dx).toBe(-40);
  });

  it("round-trips: position → anchor → same position", () => {
    const rect = { left: 640, top: 90, width: 220, height: 160 };
    const a = anchorFromRect(rect, box);
    const pos = positionFromAnchor(a, { width: rect.width, height: rect.height }, box);
    expect(pos).toEqual({ left: rect.left, top: rect.top });
  });

  it("a right/bottom anchor follows the box when it grows", () => {
    const a = { h: "right" as const, v: "bottom" as const, dx: 24, dy: 96 };
    const small = positionFromAnchor(a, { width: 200, height: 150 }, box);
    const grown = positionFromAnchor(
      a,
      { width: 200, height: 150 },
      { ...box, width: 1000, height: 600 },
    );
    expect(grown.left - small.left).toBe(200);
    expect(grown.top - small.top).toBe(150);
  });
});
