import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "apps/*/src/**/*.test.{ts,tsx}",
      "tools/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/e2e/**"],
    reporters: ["default"],
    passWithNoTests: false,
    // Generous default timeout — the cascaded-PID + MC tests run 5–10 s of
    // sim time per case at 250 Hz, and under CPU contention from sibling
    // test files the original 5 s default starts to flake.
    testTimeout: 30_000,
    // Cap the worker pool so heavy simulator-driven test files (PID, MC,
    // SimRunner long-advance specs) don't starve each other when run
    // alongside the 30+ other test files.
    maxWorkers: 2,
    minWorkers: 1,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Limit coverage scope to source files we actually want to gate on.
      // SLS-7 mandates ≥95% on packages/physics math.
      include: ["packages/physics/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
      thresholds: {
        lines: 95,
        functions: 95,
        statements: 95,
        branches: 90,
      },
    },
  },
});
