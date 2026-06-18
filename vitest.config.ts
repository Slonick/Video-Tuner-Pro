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
        // Options page — browser-wired DOM glue; its pure logic lives in
        // src/shared (presets / keymap / sync-config) and is unit-tested there.
        "src/options/**",
        // Canvas drawing & DOM animation — low ROI / brittle to unit-test. The
        // React UI (.tsx) isn't measured at all (include is *.ts); these are the
        // .ts animation/canvas-bridge helpers behind it.
        "src/popup/graphs/**",
        "src/popup/lib/section-anim.ts", // FLIP + scroll-reveal (the old sections.ts)
        "src/popup/hooks/useExpand.ts", // expand/collapse + FLIP orchestration
        "src/popup/hooks/useGraphs.ts", // canvas-meter bridge into graphs/**
        "src/content/badge/icon.ts",
      ],
      reporter: ["text", "text-summary", "html", "json-summary"],
      // CI fails when any metric drops below its floor. Set a few points under the
      // current numbers so routine edits don't trip the gate; ratchet them up as
      // coverage improves. (At time of writing: ~90% stmts, 78% branch, 89% funcs,
      // 95% lines on the gated set — periodic samplers and timer scheduling live in
      // the excluded entry points, so the gated set is the real unit-testable logic.)
      thresholds: {
        statements: 87,
        branches: 74,
        functions: 87,
        lines: 92,
      },
    },
  },
});
