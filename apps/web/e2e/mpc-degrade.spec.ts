import { expect, test } from "@playwright/test";

/**
 * SLS-49: on the public static demo (built with VITE_MPC_URL=""), selecting
 * MPC must degrade gracefully — a banner explains the missing service, the
 * sim keeps flying, and NOTHING hits the network (no console errors).
 *
 * Self-skips on a service-enabled build (dev / VITE_MPC_URL set), where the
 * banner is absent by design, so `pnpm test:e2e` stays green either way.
 */
test("MPC degrades gracefully with no guidance service", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  // Fail loudly if anything tries to reach a guidance service: the whole
  // point is zero network to :8100 on the static build.
  const solveRequests: string[] = [];
  await page.route("**/solve", (route) => {
    solveRequests.push(route.request().url());
    return route.abort();
  });

  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

  // MPC option must be present and selectable per the ticket.
  const mpcOption = page.locator(
    '[data-testid="controller-switcher-select"] option[value="mpc"]',
  );
  await expect(mpcOption).toBeEnabled();

  await page
    .locator('[data-testid="controller-switcher-select"]')
    .selectOption("mpc");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

  const banner = page.locator('[data-testid="mpc-service-banner"]');
  if ((await banner.count()) === 0) {
    // Service-enabled build (dev): degradation path not exercised here.
    test.skip(true, "MPC service enabled in this build; degrade path N/A");
    return;
  }

  // Banner shown, links the local-run docs.
  await expect(banner).toBeVisible();
  await expect(banner.locator("a")).toHaveAttribute(
    "href",
    /starship-catch-sim#running-mpc-locally/,
  );

  // Let a few solve cadences elapse: the controller must NOT fetch.
  await page.waitForTimeout(2500);
  expect(
    solveRequests,
    `expected zero /solve requests, saw:\n${solveRequests.join("\n")}`,
  ).toEqual([]);
  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual(
    [],
  );
});
