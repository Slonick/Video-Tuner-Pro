import { describe, it, expect, vi, afterEach } from "vitest";
import { cmpVersion } from "../src/shared/update.js";

describe("cmpVersion", () => {
  it("orders dotted numeric versions", () => {
    expect(cmpVersion("3.0.4", "3.0.3")).toBeGreaterThan(0);
    expect(cmpVersion("3.0.3", "3.0.4")).toBeLessThan(0);
    expect(cmpVersion("3.0.10", "3.0.9")).toBeGreaterThan(0); // not lexicographic
    expect(cmpVersion("3.1.0", "3.0.9")).toBeGreaterThan(0);
  });

  it("treats equal and missing/short parts as equal", () => {
    expect(cmpVersion("3.0.0", "3.0.0")).toBe(0);
    expect(cmpVersion("3.0", "3.0.0")).toBe(0);
    expect(cmpVersion("3", "3.0.0")).toBe(0);
  });

  it("counts a longer version's extra non-zero parts", () => {
    expect(cmpVersion("3.0.1", "3.0")).toBeGreaterThan(0);
    expect(cmpVersion("3.0", "3.0.1")).toBeLessThan(0);
  });
});

describe("hasUpdateApi", () => {
  afterEach(() => {
    vi.resetModules();
    (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
    (globalThis as unknown as { chrome?: unknown; browser?: unknown }).browser = undefined;
  });

  it("does not throw when imported without extension globals", async () => {
    (globalThis as unknown as { chrome?: unknown; browser?: unknown }).chrome = undefined;
    (globalThis as unknown as { chrome?: unknown; browser?: unknown }).browser = undefined;
    vi.resetModules();
    const { currentVersion, hasUpdateApi } = await import("../src/shared/update.js");
    expect(hasUpdateApi()).toBe(false);
    expect(currentVersion()).toBe("0");
  });

  it("is true when runtime.requestUpdateCheck exists (Chrome)", async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { requestUpdateCheck: () => {} },
    };
    vi.resetModules();
    const { hasUpdateApi } = await import("../src/shared/update.js");
    expect(hasUpdateApi()).toBe(true);
  });

  it("is false when it's absent (Firefox)", async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = { runtime: {} };
    vi.resetModules();
    const { hasUpdateApi } = await import("../src/shared/update.js");
    expect(hasUpdateApi()).toBe(false);
  });

  it("currentVersion reads the manifest version", async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { getManifest: () => ({ version: "3.2.1" }) },
    };
    vi.resetModules();
    const { currentVersion } = await import("../src/shared/update.js");
    expect(currentVersion()).toBe("3.2.1");
  });

  it("currentVersion is '0' when the manifest has no version", async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { getManifest: () => ({}) },
    };
    vi.resetModules();
    const { currentVersion } = await import("../src/shared/update.js");
    expect(currentVersion()).toBe("0");
  });
});

describe("fetchAmoLatest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("returns the current_version from the AMO payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ current_version: { version: "9.9.9" } }),
      }),
    );
    const { fetchAmoLatest } = await import("../src/shared/update.js");
    expect(await fetchAmoLatest()).toBe("9.9.9");
  });

  it("asks AMO's public API for this add-on as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchAmoLatest } = await import("../src/shared/update.js");
    expect(await fetchAmoLatest()).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://addons.mozilla.org/api/v5/addons/addon/video-speed-controller-pro@slonick.dev/",
      { headers: { accept: "application/json" } },
    );
  });

  it("ignores the body of an error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ current_version: { version: "9.9.9" } }),
      }),
    );
    const { fetchAmoLatest } = await import("../src/shared/update.js");
    expect(await fetchAmoLatest()).toBeNull();
  });

  it("returns null on a failed request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { fetchAmoLatest } = await import("../src/shared/update.js");
    expect(await fetchAmoLatest()).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { fetchAmoLatest } = await import("../src/shared/update.js");
    expect(await fetchAmoLatest()).toBeNull();
  });
});
