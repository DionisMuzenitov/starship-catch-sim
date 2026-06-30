import { expect, test } from "@playwright/test";

test("controller switcher toggles PID, tuning panel appears, charts mount", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

  // Panel hidden under Manual.
  await expect(page.locator('[data-testid="pid-tuning-panel"]')).toHaveCount(0);

  // Switch to PID. Scene re-mounts (canvas re-creates) via App key.
  await page.locator('[data-testid="controller-switcher-pid"]').click();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="pid-tuning-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="pid-chart"]')).toBeVisible();

  // Patch a single gain — the input should accept the new value without
  // throwing a render error.
  const kp = page.locator('[data-testid="pid-altitude-kp"]');
  await kp.fill("0.12");
  await page.waitForTimeout(100);

  // Switch back to Manual; panel should disappear.
  await page.locator('[data-testid="controller-switcher-manual"]').click();
  await expect(page.locator('[data-testid="pid-tuning-panel"]')).toHaveCount(0);

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual([]);
});
