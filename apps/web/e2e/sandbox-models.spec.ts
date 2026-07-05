import { expect, test } from "@playwright/test";

/**
 * SLS-44: the model sandbox drives both sourced GLB vehicles (booster +
 * ship) with the articulation sliders. Assert it loads and renders the
 * Draco GLB with no console errors — this exercises the whole GLB path
 * (self-hosted Draco decoder, subtree extraction, articulation binding).
 */
test("model sandbox loads the GLB vehicles cleanly", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/sandbox/models");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="control-panel"]')).toBeVisible();

  // Give the Draco decoder + GLB time to load and the scene to render.
  await page.waitForTimeout(3000);

  // Deflect a grid fin — articulation must not throw.
  const ranges = page.locator('[data-testid="control-panel"] input[type=range]');
  if (await ranges.count()) {
    await ranges.first().fill("1");
    await page.waitForTimeout(500);
  }

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual(
    [],
  );
});
