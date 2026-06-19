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
  // Retry once on CI so a failing test re-runs WITH a trace captured.
  retries: process.env.CI ? 1 : 0,
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
    port: 5599,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:5599",
    // Full diagnostics on failure — a step-by-step trace (filmstrip + DOM
    // snapshots + console + network) and a screenshot, both surfaced in the HTML
    // report so a red run has everything needed to debug it. (No `video`: the
    // loaded-extension context is created manually and doesn't honour recordVideo;
    // the trace's filmstrip covers it.)
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
});
