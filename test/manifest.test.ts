import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

interface Manifest {
  version?: string;
  permissions?: string[];
  content_security_policy?: { extension_pages?: string };
  content_scripts?: Array<{
    matches?: string[];
    js?: string[];
    run_at?: string;
    all_frames?: boolean;
    world?: string;
  }>;
  web_accessible_resources?: Array<{
    resources?: string[];
    use_dynamic_url?: boolean;
  }>;
  browser_specific_settings?: {
    gecko?: {
      data_collection_permissions?: {
        required?: string[];
        optional?: string[];
      };
    };
  };
}

const manifest = JSON.parse(readFileSync("src/manifest.json", "utf8")) as Manifest;
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { version?: string };
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
  version?: string;
  packages?: Record<string, { version?: string }>;
};

describe("extension manifest hardening", () => {
  it("keeps the release version synchronized across every package source", () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.version).toBe(manifest.version);
    expect(packageLock.version).toBe(manifest.version);
    expect(packageLock.packages?.[""]?.version).toBe(manifest.version);
  });

  it("does not request activeTab alongside persistent all-host access", () => {
    expect(manifest.permissions).not.toContain("activeTab");
  });

  it("pins the extension-page CSP to packaged scripts", () => {
    expect(manifest.content_security_policy?.extension_pages).toBe(
      "script-src 'self'; object-src 'self';",
    );
  });

  it("exposes only the overlay popup to pages, through a per-session dynamic URL", () => {
    const exposed = manifest.web_accessible_resources ?? [];
    expect(exposed.flatMap((entry) => entry.resources ?? [])).toEqual(["popup/popup.html"]);
    expect(exposed.every((entry) => entry.use_dynamic_url === true)).toBe(true);
  });

  it("injects every content script at document_start in all frames, in the right world", () => {
    const entry = (file: string) => manifest.content_scripts?.find((cs) => cs.js?.includes(file));
    for (const file of ["content.js", "inject.js", "page-bridge.js"]) {
      expect(entry(file)?.run_at, file).toBe("document_start");
      expect(entry(file)?.all_frames, file).toBe(true);
    }
    expect(entry("content.js")?.world).toBeUndefined();
    expect(entry("content.js")?.matches).toEqual(["<all_urls>"]);
    expect(entry("page-bridge.js")?.world).toBe("MAIN");
    expect(entry("page-bridge.js")?.matches).toEqual(["<all_urls>"]);
    expect(entry("inject.js")?.world).toBe("MAIN");
    expect(entry("inject.js")?.matches?.length).toBeGreaterThan(0);
  });

  it("declares SponsorBlock browsing data as optional in Firefox", () => {
    const permissions = manifest.browser_specific_settings?.gecko?.data_collection_permissions;
    expect(permissions?.required).toEqual(["none"]);
    expect(permissions?.optional).toEqual(["browsingActivity"]);
  });
});
