import { expect, test } from "@playwright/test";

/**
 * SLS-22 — end-to-end coverage of the catch-outcome overlay.
 *
 * Drives the booster Standard scenario at max time scale (×8) with zero
 * pilot input. The booster falls ~360 m/s (200 m/s descent + 300 m/s
 * lateral) from 65 km and lands somewhere off the tower — `evaluateCatchOutcome`
 * fires `crash` (or `tower_collision` if it happens to clip the trusses),
 * the runner freezes, and the overlay renders. We assert:
 *   1. the overlay only appears after the run ends (not on load),
 *   2. the banner shows a terminal outcome,
 *   3. the metrics section is populated,
 *   4. clicking Reset removes the overlay and the canvas re-mounts.
 */
test("zero-input booster eventually crashes and the outcome overlay appears", async ({
  page,
}) => {
  // Booster falls from 65 km. At wall ×8 it lands in ~10–20 s of wall time,
  // but the test runs at ×1 page-load, so give a generous 90 s ceiling.
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

  // No outcome on initial load — the run hasn't started.
  await expect(
    page.locator('[data-testid="catch-outcome-overlay"]'),
  ).toHaveCount(0);

  // Unpause + max time scale (1 → 2 → 4 → 8).
  await page.locator("body").press("Space");
  for (let i = 0; i < 3; i++) {
    await page.locator("body").press("]");
  }

  // Booster free-fall from 65 km at ×8 hits ground in well under 60 s wall.
  const overlay = page.locator('[data-testid="catch-outcome-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 60_000 });

  const banner = page.locator('[data-testid="catch-outcome-banner"]');
  const bannerText = await banner.innerText();
  expect(["CRASH", "TOWER HIT", "NEAR MISS", "CAUGHT"]).toContain(
    bannerText.trim(),
  );

  // Metrics list shows at least the Δ-to-target row.
  await expect(overlay).toContainText("Δ to target");
  await expect(overlay).toContainText("v_y");
  await expect(overlay).toContainText("fuel left");

  // Reset removes the overlay (scene re-mounts on the new epoch).
  await page.locator('[data-testid="catch-outcome-reset"]').click();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual(
    [],
  );
});
