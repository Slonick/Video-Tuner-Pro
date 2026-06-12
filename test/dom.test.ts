// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { streamLatency } from "../src/content/live/metrics.js";

describe("streamLatency (reads data-vtp-latency)", () => {
  beforeEach(() => { document.documentElement.removeAttribute("data-vtp-latency"); });

  it("is null when the attribute is absent", () => {
    expect(streamLatency()).toBeNull();
  });
  it("parses a positive value", () => {
    document.documentElement.setAttribute("data-vtp-latency", "1.45");
    expect(streamLatency()).toBe(1.45);
  });
  it("is null for non-positive / garbage", () => {
    document.documentElement.setAttribute("data-vtp-latency", "0");
    expect(streamLatency()).toBeNull();
    document.documentElement.setAttribute("data-vtp-latency", "nope");
    expect(streamLatency()).toBeNull();
  });
});
