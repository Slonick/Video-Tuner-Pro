import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default to fast Node env; DOM-touching tests opt in per-file with
    //   // @vitest-environment jsdom
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],

    coverage: {
      provider: "v8",
      // Measure every source file, not just the ones a test happens to import —
      // so a new untested module actually shows up (and can fail the gate) instead
      // of silently not counting.
      all: true,
      include: ["src/**/*.ts"],
      // Code we deliberately don't unit-test (browser-wired glue, canvas drawing,
      // DOM animation) — excluded so the threshold gate reflects only the logic we
      // mean to cover. Trim or extend this list as coverage grows.
      exclude: [
        "src/**/*.d.ts",
        "src/types/**",
        "src/content/audio/types.ts",      // type-only (interfaces)
        // Entry points / bootstrap glue — wired by the browser, not unit-tested.
        "src/background/**",
        "src/content/index.ts",
        "src/content/inject.ts",
        "src/popup/index.ts",
        // Canvas drawing & DOM animation — low ROI / brittle to unit-test.
        "src/popup/graphs/**",
        "src/popup/sections.ts",
        "src/content/badge/icon.ts",
      ],
      reporter: ["text", "text-summary", "html", "json-summary"],
      // CI fails when any metric drops below its floor. Set a few points under the
      // current numbers so routine edits don't trip the gate; ratchet them up as
      // coverage improves. (At time of writing: ~75% stmts, 65% branch, 74% funcs,
      // 80% lines on the gated set.)
      thresholds: {
        statements: 72,
        branches: 60,
        functions: 70,
        lines: 75,
      },
    },
  },
});
