import { defineConfig } from "@playwright/test";

// Functional E2E: loads the built extension into real Chromium and drives it on a
// local fixture page. Build dist/chrome first (`npm run build`); the suite is kept
// out of the Vitest run and has its own script (`npm run test:e2e`).
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // One persistent extension context per worker; keep it serial for determinism.
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [["list"]],
  webServer: {
    command: "node e2e/server.mjs",
    port: 5599,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:5599",
  },
});
