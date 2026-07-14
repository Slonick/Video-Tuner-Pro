import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasSponsorDataConsent,
  removeSponsorDataConsent,
  requestSponsorDataConsent,
} from "../src/shared/sponsor-consent.js";

type BrowserRoot = typeof globalThis & { browser?: unknown };

afterEach(() => {
  delete (globalThis as BrowserRoot).browser;
});

function installFirefox(granted: string[] = []) {
  const permissions = {
    getAll: vi.fn().mockResolvedValue({ data_collection: granted }),
    request: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
  };
  (globalThis as BrowserRoot).browser = {
    permissions,
    runtime: {
      getManifest: () => ({ browser_specific_settings: { gecko: { id: "test@example" } } }),
    },
  };
  return { permissions };
}

describe("SponsorBlock data consent", () => {
  it("uses the explicit toggle as consent on Chromium", async () => {
    expect(await hasSponsorDataConsent()).toBe(true);
    expect(await requestSponsorDataConsent()).toBe(true);
    expect(await removeSponsorDataConsent()).toBe(true);
  });

  it("checks and requests Firefox browsingActivity permission", async () => {
    const { permissions } = installFirefox([]);
    expect(await hasSponsorDataConsent()).toBe(false);
    expect(await requestSponsorDataConsent()).toBe(true);
    expect(permissions.request).toHaveBeenCalledWith({
      data_collection: ["browsingActivity"],
    });
  });

  it("recognises an existing permission and removes it on opt-out", async () => {
    const { permissions } = installFirefox(["browsingActivity"]);
    expect(await hasSponsorDataConsent()).toBe(true);
    expect(await removeSponsorDataConsent()).toBe(true);
    expect(permissions.remove).toHaveBeenCalledWith({
      data_collection: ["browsingActivity"],
    });
  });
});
