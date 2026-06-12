// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { fmtTime, parseClock } from "../src/content/badge/overlay.js";
import { speedLabel } from "../src/content/badge/icon.js";

describe("fmtTime", () => {
  it("mm:ss under an hour", () => {
    expect(fmtTime(0)).toBe("0:00");
    expect(fmtTime(65)).toBe("1:05");
    expect(fmtTime(90)).toBe("1:30");
  });
  it("h:mm:ss at/over an hour", () => {
    expect(fmtTime(3661)).toBe("1:01:01");
  });
  it("clamps negatives to 0:00", () => {
    expect(fmtTime(-5)).toBe("0:00");
  });
});

describe("parseClock", () => {
  it("parses H:MM:SS (SponsorBlock style)", () => {
    expect(parseClock("(1:54:13)")).toBe(1 * 3600 + 54 * 60 + 13);
  });
  it("parses MM:SS", () => {
    expect(parseClock("12:34")).toBe(12 * 60 + 34);
  });
  it("returns 0 for garbage / null", () => {
    expect(parseClock("nope")).toBe(0);
    expect(parseClock(null)).toBe(0);
  });
});

describe("speedLabel", () => {
  it("always shows one decimal place minimum", () => {
    expect(speedLabel(1)).toBe("1.0");
    expect(speedLabel(2)).toBe("2.0");
    expect(speedLabel(1.5)).toBe("1.5");
    expect(speedLabel(1.25)).toBe("1.25");
  });
});
