import { expect, test } from "@playwright/test";

// SLS-32: the app exposes a link to the docs site. In the preview (production)
// build the href is host-relative off the app base, ending in /docs/.
test("docs link is present and points at the nested /docs/ site", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

  const link = page.locator('[data-testid="docs-link"]');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", /\/docs\/$/);
});
