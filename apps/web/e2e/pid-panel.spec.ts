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

  // Switch to PID via the dropdown. Scene re-mounts (canvas re-creates)
  // via App key.
  await page
    .locator('[data-testid="controller-switcher-select"]')
    .selectOption("pid");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="pid-tuning-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="pid-chart"]')).toBeVisible();

  // Override mode toggle is only meaningful under an auto controller.
  await expect(
    page.locator('[data-testid="controller-override-temporary"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="controller-override-hard"]'),
  ).toBeVisible();

  // Patch a single gain — the input should accept the new value without
  // throwing a render error.
  const kp = page.locator('[data-testid="pid-altitude-kp"]');
  await kp.fill("0.12");
  await page.waitForTimeout(100);

  // Flip the override mode to "hard"; should toggle without errors.
  await page.locator('[data-testid="controller-override-hard"]').click();
  await page.waitForTimeout(50);

  // Switch back to Manual; panel + override toggle should disappear.
  await page
    .locator('[data-testid="controller-switcher-select"]')
    .selectOption("manual");
  await expect(page.locator('[data-testid="pid-tuning-panel"]')).toHaveCount(0);
  await expect(
    page.locator('[data-testid="controller-override-temporary"]'),
  ).toHaveCount(0);

  // MPC / RL options are present but disabled (placeholders for SLS-25+).
  const mpcOption = page.locator(
    '[data-testid="controller-switcher-select"] option[value="mpc"]',
  );
  await expect(mpcOption).toBeDisabled();
  const rlOption = page.locator(
    '[data-testid="controller-switcher-select"] option[value="rl"]',
  );
  await expect(rlOption).toBeDisabled();

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual([]);
});
