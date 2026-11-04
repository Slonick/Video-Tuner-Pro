import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 5599);

// Functional E2E: loads the built extension into real Chromium and drives it on a
// local fixture page. Build dist/chrome first (`npm run build`); the suite is kept
// out of the Vitest run and has its own script (`npm run test:e2e`).
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // One persistent extension context per worker; keep it serial for determinism.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Retry once on CI: a pass on retry still fails the gate (failOnFlakyTests).
  retries: process.env.CI ? 1 : 0,
  // A retry is diagnostic, not permission to merge a race. Leave the CI gate red
  // whenever the first attempt failed.
  failOnFlakyTests: !!process.env.CI,
  timeout: 30_000,
  // Generous on purpose: each value-poll waits for the extension to load, read
  // chrome.storage and apply the rate — under contention on the shared CI runner
  // that can briefly exceed a tight budget (still well inside the 30s test cap).
  expect: { timeout: 15_000 },
  // Console list always; a self-contained HTML report on every run (open it with
  // `npx playwright show-report`); inline PR annotations when on CI.
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "test-results/results.json" }], // feeds the CI job summary
    ...(process.env.CI ? [["github"] as [string]] : []),
  ],
  webServer: {
    command: "node e2e/server.mjs",
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Full diagnostics on failure — a step-by-step trace (DOM snapshots + console +
    // network) and a screenshot, both surfaced in the HTML report so a red run has
    // everything needed to debug it. (No `video`: the loaded-extension context is
    // created manually and doesn't honour recordVideo.) Traced from the first
    // attempt: a flaky test usually passes on retry, so a retry-only trace would
    // show nothing. No trace screencast: on a single-core CI runner it costs enough
    // frames to fail the viewer cadence test.
    trace: { mode: "retain-on-first-failure", screenshots: false },
    screenshot: "only-on-failure",
  },
});
