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

  // MPC is live (SLS-26); RL is live too (SLS-30 — neural policy).
  const mpcOption = page.locator(
    '[data-testid="controller-switcher-select"] option[value="mpc"]',
  );
  await expect(mpcOption).toBeEnabled();
  const rlOption = page.locator(
    '[data-testid="controller-switcher-select"] option[value="rl"]',
  );
  await expect(rlOption).toBeEnabled();

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual([]);
});

test("MPC mode mounts and flies (PID fallback when service is absent)", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

  await page
    .locator('[data-testid="controller-switcher-select"]')
    .selectOption("mpc");
  // Scene re-mounts; the sim keeps running on the PID fallback even with
  // no MPC service listening (the transport rejection is swallowed).
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });
  await expect(
    page.locator('[data-testid="controller-override-temporary"]'),
  ).toBeVisible();
  await page.waitForTimeout(1500); // at least one failed solve round-trip

  // Note: console "Failed to load resource" network noise is expected
  // here (no service on :8100) — only page *errors* fail the test.
  expect(errors, `unexpected page errors:\n${errors.join("\n")}`).toEqual([]);
});
