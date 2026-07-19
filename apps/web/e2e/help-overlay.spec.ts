import { expect, test } from "@playwright/test";

// SLS-55: in-app help overlay + first-run tutorial. Each test runs in a fresh
// browser context, so localStorage starts empty and the tutorial appears.

test("first-run tutorial shows, dismisses, and stays dismissed after reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

  // Fresh visitor → the onboarding card is up.
  const tutorial = page.locator('[data-testid="first-run-tutorial"]');
  await expect(tutorial).toBeVisible();

  // Dismiss it.
  await page.locator('[data-testid="first-run-dismiss"]').click();
  await expect(tutorial).toHaveCount(0);

  // Reload in the same context: the dismissal is remembered (localStorage).
  await page.reload();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });
  await expect(tutorial).toHaveCount(0);

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual(
    [],
  );
});

test("help overlay opens via ? key and button, closes via ?, Esc, and ✕", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

  const overlay = page.locator('[data-testid="help-overlay"]');

  // The "?" hotkey toggles the overlay open and closed.
  await page.locator("body").press("Shift+Slash");
  await expect(overlay).toBeVisible();
  await page.locator("body").press("Shift+Slash");
  await expect(overlay).toHaveCount(0);

  // The always-visible "?" button opens it; Esc closes it.
  await page.locator('[data-testid="help-button"]').click();
  await expect(overlay).toBeVisible();
  await page.locator("body").press("Escape");
  await expect(overlay).toHaveCount(0);

  // The ✕ button closes it.
  await page.locator('[data-testid="help-button"]').click();
  await expect(overlay).toBeVisible();
  await page.locator('[data-testid="help-close"]').click();
  await expect(overlay).toHaveCount(0);

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual(
    [],
  );
});
