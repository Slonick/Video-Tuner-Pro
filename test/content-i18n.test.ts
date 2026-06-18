import { describe, it, expect, afterEach, vi } from "vitest";
import { i18n } from "../src/content/platform/i18n.js";

// i18n() is a thin guarded wrapper over chrome.i18n.getMessage that must never
// throw — even when the extension context is dead.
afterEach(() => vi.restoreAllMocks());

describe("i18n", () => {
  it("returns the localized message", () => {
    vi.spyOn(globalThis.chrome.i18n, "getMessage").mockReturnValue("Hello");
    expect(i18n("greeting")).toBe("Hello");
  });

  it("passes substitutions through", () => {
    const spy = vi.spyOn(globalThis.chrome.i18n, "getMessage").mockReturnValue("ok");
    i18n("speedPct", ["150"]);
    expect(spy).toHaveBeenCalledWith("speedPct", ["150"]);
  });

  it("returns '' for an unknown key (getMessage yields empty)", () => {
    vi.spyOn(globalThis.chrome.i18n, "getMessage").mockReturnValue("");
    expect(i18n("nope")).toBe("");
  });

  it("returns '' instead of throwing when the context is dead", () => {
    vi.spyOn(globalThis.chrome.i18n, "getMessage").mockImplementation(() => {
      throw new Error("context invalidated");
    });
    expect(i18n("greeting")).toBe("");
  });
});
