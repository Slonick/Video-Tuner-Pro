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

  it("treats a browser global without the gecko manifest settings as Chromium", async () => {
    const { permissions } = installFirefox([]);
    for (const manifest of [
      {},
      { browser_specific_settings: null },
      { browser_specific_settings: {} },
    ]) {
      (globalThis as BrowserRoot).browser = {
        permissions,
        runtime: { getManifest: () => manifest },
      };
      expect(await hasSponsorDataConsent()).toBe(true);
    }
    expect(permissions.getAll).not.toHaveBeenCalled();
  });

  it("treats a browser global without a manifest reader as Chromium", async () => {
    const { permissions } = installFirefox([]);
    (globalThis as BrowserRoot).browser = { permissions, runtime: {} };
    expect(await hasSponsorDataConsent()).toBe(true);
    (globalThis as BrowserRoot).browser = { permissions };
    expect(await hasSponsorDataConsent()).toBe(true);
    expect(permissions.getAll).not.toHaveBeenCalled();
  });

  it("treats Firefox without the data-collection permission API as consented", async () => {
    (globalThis as BrowserRoot).browser = {
      permissions: null,
      runtime: { getManifest: () => ({ browser_specific_settings: { gecko: {} } }) },
    };
    expect(await hasSponsorDataConsent()).toBe(true);
  });

  it.each(["getAll", "request", "remove"])(
    "treats a permissions API missing %s as unavailable (consented)",
    async (missing) => {
      const { permissions } = installFirefox([]);
      const partial: Record<string, unknown> = { ...permissions };
      delete partial[missing];
      (globalThis as BrowserRoot).browser = {
        permissions: partial,
        runtime: { getManifest: () => ({ browser_specific_settings: { gecko: {} } }) },
      };
      expect(await hasSponsorDataConsent()).toBe(true);
      expect(await requestSponsorDataConsent()).toBe(true);
      expect(await removeSponsorDataConsent()).toBe(true);
      expect(permissions.getAll).not.toHaveBeenCalled();
      expect(permissions.request).not.toHaveBeenCalled();
      expect(permissions.remove).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the Firefox permission calls reject", async () => {
    const { permissions } = installFirefox(["browsingActivity"]);
    permissions.getAll.mockRejectedValue(new Error("dead object"));
    permissions.request.mockRejectedValue(new Error("not a user gesture"));
    permissions.remove.mockRejectedValue(new Error("dead object"));
    expect(await hasSponsorDataConsent()).toBe(false);
    expect(await requestSponsorDataConsent()).toBe(false);
    expect(await removeSponsorDataConsent()).toBe(false);
  });
});
