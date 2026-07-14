import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

interface Manifest {
  version?: string;
  permissions?: string[];
  content_security_policy?: { extension_pages?: string };
  web_accessible_resources?: Array<{
    resources?: string[];
    use_dynamic_url?: boolean;
  }>;
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

  it("serves exposed resources through a per-session dynamic URL", () => {
    const exposed = manifest.web_accessible_resources?.find((entry) =>
      entry.resources?.includes("quality-inject.js"),
    );
    expect(exposed?.use_dynamic_url).toBe(true);
  });
});
