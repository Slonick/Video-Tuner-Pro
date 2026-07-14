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
});
