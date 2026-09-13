import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },

  // Golden-frame diffs (SLS-108). Snapshots are keyed by platform because a
  // WebGL frame is not portable: CI renders through SwiftShader on Ubuntu,
  // a dev machine through the real GPU. Only the `linux` goldens are
  // committed; `visual-golden.spec.ts` skips itself off-linux rather than
  // pretend a macOS frame can be compared against them.
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}-{platform}{ext}",

  projects: [
    // TEMP SLS-121 discriminator project.
    {
      name: "x-control",
      testMatch: /zz-tmp-sls121/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
    },
    {
      name: "chromium",
      testIgnore: /zz-tmp-sls121/,
      use: {
        ...devices["Desktop Chrome"],
        // Pin everything that scales the framebuffer. `devices` supplies a
        // dpr the golden must not drift from, and the quality tier picks its
        // render scale off devicePixelRatio.
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
    },
  ],

  webServer: {
    command: "pnpm preview --port " + PORT + " --strictPort",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
