import { expect, test } from "@playwright/test";

/**
 * SLS-46 — end-to-end coverage of the replay round-trip.
 *
 * 1. Drive the booster Standard scenario at ×8 with no pilot input until
 *    `evaluateCatchOutcome` fires and the post-attempt overlay renders.
 * 2. Click "Save replay" to download a JSON file; capture it via the
 *    `download` event.
 * 3. Reload the page so the live runner starts fresh.
 * 4. Click "Load replay" with the saved file; assert the bottom-bar
 *    `ReplayPlayer` appears, the scrub is wired, and Exit returns to live.
 */

test("record → save → load → playback round-trip", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

  // Unpause + ×8.
  await page.locator("body").press("Space");
  for (let i = 0; i < 3; i++) {
    await page.locator("body").press("]");
  }

  // Wait for the outcome overlay.
  const overlay = page.locator('[data-testid="catch-outcome-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 60_000 });

  // Save the replay → triggers a download.
  const downloadPromise = page.waitForEvent("download");
  await page.locator('[data-testid="catch-outcome-save-replay"]').click();
  const download = await downloadPromise;
  const savedPath = await download.path();
  expect(savedPath).not.toBeNull();

  // Reload to clear all in-memory state.
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });
  await expect(
    page.locator('[data-testid="replay-player"]'),
  ).toHaveCount(0);

  // Load the saved replay via the picker's file input.
  await page
    .locator('[data-testid="scenario-load-replay-input"]')
    .setInputFiles(savedPath!);

  // Player surfaces are present.
  const player = page.locator('[data-testid="replay-player"]');
  await expect(player).toBeVisible({ timeout: 5_000 });
  await expect(
    page.locator('[data-testid="replay-outcome"]'),
  ).toBeVisible();
  const scrub = page.locator('[data-testid="replay-scrub"]');
  await expect(scrub).toBeVisible();

  // The scenario picker `<select>` is disabled in replay mode.
  await expect(
    page.locator('[data-testid="scenario-picker"] select'),
  ).toBeDisabled();

  // Scrubbing the slider updates the readout. Use a programmatic value-
  // set + input event so Playwright's `fill` step-snap doesn't reject the
  // mid value when (max-min) doesn't divide evenly by the slider's step.
  await scrub.evaluate((el: HTMLInputElement) => {
    const mid = (Number(el.min) + Number(el.max)) / 2;
    el.value = String(mid);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator('[data-testid="replay-time"]')).toContainText(
    "/",
  );

  // Speed buttons render.
  await page.locator('[data-testid="replay-speed-4"]').click();

  // Exit returns to live; player disappears, picker is enabled again.
  await page.locator('[data-testid="replay-exit"]').click();
  await expect(player).toHaveCount(0);
  await expect(
    page.locator('[data-testid="scenario-picker"] select'),
  ).toBeEnabled();

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual(
    [],
  );
});
