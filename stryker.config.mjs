// Mutation testing: checks that the unit tests actually fail when the logic they
// cover is broken. Scoped to the logic core (no React UI, viewer/launcher DOM
// choreography or CSS strings), where a surviving mutant points at a real gap.
// Incremental: reruns only mutants whose code or covering tests changed.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.ts" },
  coverageAnalysis: "perTest",
  mutate: [
    "src/shared/**/*.ts",
    "src/content/core/**/*.ts",
    "src/content/speed.ts",
    "src/content/keyboard.ts",
    "src/content/videos.ts",
    "src/content/channel.ts",
    "src/content/messaging.ts",
    "src/content/live/**/*.ts",
    "src/content/audio/**/*.ts",
    "src/background/**/*.ts",
    "!src/**/*.d.ts",
    "!src/content/audio/types.ts",
  ],
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  thresholds: { high: 80, low: 60, break: null },
};
