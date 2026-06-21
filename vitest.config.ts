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
        // React UI components — exercised through the popup integration tests, but not
        // unit-gated on their own (brittle to test in isolation). `include: *.ts` used
        // to skip these; vitest 4 began matching .tsx, so exclude them explicitly.
        "src/**/*.tsx",
        "src/types/**",
        "src/content/audio/types.ts", // type-only (interfaces)
        // Entry points / bootstrap glue — wired by the browser, not unit-tested.
        "src/background/**",
        "src/content/index.ts",
        "src/content/inject.ts",
        // Browser-wired sampler: reads the analyser/video and applies the rate.
        // The pure detector + controller live in pace.ts and are unit-tested.
        "src/content/audio/autoslow.ts",
        // Options page — browser-wired DOM glue; its pure logic lives in
        // src/shared (presets / keymap / sync-config) and is unit-tested there.
        "src/options/**",
        // Canvas drawing & DOM animation — low ROI / brittle to unit-test. The
        // React UI (.tsx) isn't measured at all (include is *.ts); these are the
        // .ts animation/canvas-bridge helpers behind it.
        "src/popup/graphs/**",
        "src/popup/hooks/useCardOverlay.ts", // card→overlay FLIP orchestration
        "src/popup/hooks/useGraphs.ts", // canvas-meter bridge into graphs/**
        "src/popup/dom.ts", // getElementById wrapper — only used by graphs/** (excluded)
        "src/content/badge/icon.ts",
      ],
      reporter: ["text", "text-summary", "html", "json-summary"],
      // CI fails when any metric drops below its floor. Set a few points under the
      // current numbers so routine edits don't trip the gate; ratchet them up as
      // coverage improves. (Currently ~87% stmts, 78% branch, 91% funcs, ~90% lines
      // on the gated set.) The stmts/lines floors sit a touch lower because the v8
      // line count drifts ~1% between Node versions (local vs CI), and the now-complete
      // glass rebuild (own controls replacing Radix/motion) moved more pure helpers
      // into React components (.tsx), which the .tsx exclude above deliberately leaves
      // ungated — so the .ts logic that remains is what these floors track.
      thresholds: {
        statements: 85,
        branches: 74,
        functions: 87,
        lines: 88,
      },
    },
  },
});
