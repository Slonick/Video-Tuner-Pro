import { describe, it, expect } from "vitest";
import { badgeFraction } from "../src/content/core/badge-pos.js";

const video = { left: 100, top: 50, width: 800, height: 400 };
const badge = { width: 60, height: 20 };

describe("badgeFraction", () => {
  it("at the video's top-left → 0,0", () => {
    expect(badgeFraction({ left: 100, top: 50, ...badge }, video)).toEqual({ fx: 0, fy: 0 });
  });

  it("mid-video → the badge's top-left as a fraction", () => {
    expect(badgeFraction({ left: 500, top: 250, ...badge }, video)).toEqual({ fx: 0.5, fy: 0.5 });
  });

  it("clamps so the whole badge stays inside past the right/bottom edge", () => {
    expect(badgeFraction({ left: 5000, top: 5000, ...badge }, video)).toEqual({
      fx: 740 / 800, // (width - badgeW) / width
      fy: 380 / 400, // (height - badgeH) / height
    });
  });

  it("clamps negatives back to 0", () => {
    expect(badgeFraction({ left: -200, top: -200, ...badge }, video)).toEqual({ fx: 0, fy: 0 });
  });

  it("a zero-size video gives 0,0 (no divide-by-zero)", () => {
    expect(
      badgeFraction({ left: 0, top: 0, ...badge }, { left: 0, top: 0, width: 0, height: 0 }),
    ).toEqual({ fx: 0, fy: 0 });
  });
});
