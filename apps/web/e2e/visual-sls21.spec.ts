import { expect, test } from "@playwright/test";

test("ship-descent-standard visual smoke (HUD + phase + trace)", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });
  await page
    .locator('[data-testid="scenario-picker"] select')
    .selectOption("ship-descent-standard");
  await page.waitForTimeout(500);
  // Toggle the predicted-drag trajectory overlay on.
  await page.locator("body").press("p");
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="hud-status-banner"]')).toContainText(
    "phase:",
  );
  await page.screenshot({
    path: "test-results/sls21-ship-descent-standard.png",
    fullPage: true,
  });
});
