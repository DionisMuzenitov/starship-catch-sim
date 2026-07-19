import { expect, test } from "@playwright/test";

// SLS-32: the app exposes a link to the docs site, derived from the app base URL
// so it nests correctly under the project Pages sub-path.
test("docs link is present and points at the nested /docs/ site", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

  const link = page.locator('[data-testid="docs-link"]');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", /\/docs\/$/);

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual(
    [],
  );
});
