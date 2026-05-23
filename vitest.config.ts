import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.{ts,tsx}",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/e2e/**"],
    reporters: ["default"],
    passWithNoTests: false,
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
