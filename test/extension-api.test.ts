import { afterEach, describe, expect, it, vi } from "vitest";
import { getExtensionApi } from "../src/shared/extension-api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getExtensionApi", () => {
  it("ignores a host-page browser global without an extension runtime", () => {
    const chromeApi = globalThis.chrome;
    vi.stubGlobal("browser", { storage: undefined });

    expect(getExtensionApi()).toBe(chromeApi);
  });

  it("prefers Firefox's live browser extension API", () => {
    const browserApi = {
      runtime: { id: "firefox-extension", getURL: vi.fn(), sendMessage: vi.fn() },
      storage: { local: { get: vi.fn() } },
    } as unknown as typeof chrome;
    vi.stubGlobal("browser", browserApi);

    expect(getExtensionApi()).toBe(browserApi);
  });

  it("ignores a browser-shaped global whose runtime cannot open extension URLs", () => {
    const chromeApi = globalThis.chrome;
    vi.stubGlobal("browser", {
      runtime: { id: "page-impostor", sendMessage: vi.fn() },
      storage: { local: { get: vi.fn() } },
    });

    expect(getExtensionApi()).toBe(chromeApi);
  });

  it.each([
    ["an empty runtime id", { id: "", getURL: vi.fn(), sendMessage: vi.fn() }, true],
    ["no sendMessage", { id: "ext", getURL: vi.fn() }, true],
    ["no storage.local", { id: "ext", getURL: vi.fn(), sendMessage: vi.fn() }, false],
  ])("ignores a browser global with %s", (_case, runtime, withStorage) => {
    const chromeApi = globalThis.chrome;
    vi.stubGlobal("browser", { runtime, storage: withStorage ? { local: { get: vi.fn() } } : {} });

    expect(getExtensionApi()).toBe(chromeApi);
  });

  it("ignores a browser global whose runtime throws on access (dead object)", () => {
    const chromeApi = globalThis.chrome;
    vi.stubGlobal("browser", {
      get runtime() {
        throw new Error("can't access dead object");
      },
      storage: { local: { get: vi.fn() } },
    });

    expect(getExtensionApi()).toBe(chromeApi);
  });

  it("falls back to a present browser global when there is no chrome global", () => {
    const orphaned = { runtime: {} };
    vi.stubGlobal("chrome", undefined);
    vi.stubGlobal("browser", orphaned);

    expect(getExtensionApi()).toBe(orphaned);
  });

  it("throws when neither global exists", () => {
    vi.stubGlobal("chrome", undefined);
    vi.stubGlobal("browser", undefined);

    expect(() => getExtensionApi()).toThrow("Extension API unavailable");
  });
});
