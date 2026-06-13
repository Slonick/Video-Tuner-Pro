// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { applySuperTheater } from "../src/content/theater.js";

const ATTR = "vtp-super-theater";

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute(ATTR);
});

describe("applySuperTheater", () => {
  it("sets the html gate on YouTube when enabled", () => {
    vi.stubGlobal("location", { hostname: "www.youtube.com" });
    applySuperTheater(true);
    expect(document.documentElement.hasAttribute(ATTR)).toBe(true);
  });

  it("removes the gate when disabled", () => {
    vi.stubGlobal("location", { hostname: "www.youtube.com" });
    applySuperTheater(true);
    applySuperTheater(false);
    expect(document.documentElement.hasAttribute(ATTR)).toBe(false);
  });

  it("is a no-op off YouTube", () => {
    vi.stubGlobal("location", { hostname: "www.twitch.tv" });
    applySuperTheater(true);
    expect(document.documentElement.hasAttribute(ATTR)).toBe(false);
  });

  it("injects the stylesheet only once", () => {
    vi.stubGlobal("location", { hostname: "www.youtube.com" });
    applySuperTheater(true);
    applySuperTheater(false);
    applySuperTheater(true);
    expect(document.querySelectorAll("style").length).toBe(1);
  });
});
