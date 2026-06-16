import { expect, test } from "@playwright/test";

test("app loads, canvas appears, no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");

  // The R3F scene mounts a <canvas> element.
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual(
    [],
  );
});

test("scenario picker switches to ship-descent-standard and toggles P trace without errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

  const picker = page.locator('[data-testid="scenario-picker"] select');
  await picker.selectOption("ship-descent-standard");
  // Scene remounts via key={scenarioId}; canvas momentarily disappears.
  await page.waitForTimeout(1500);
  if (errors.length) {
    throw new Error(`console errors during remount:\n${errors.join("\n")}`);
  }
  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });

  await page.locator("body").press("p");
  await page.waitForTimeout(200);
  await page.locator("body").press("p");

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual(
    [],
  );
});

test("/sandbox/models loads canvas + control panel without errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/sandbox/models");

  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="control-panel"]')).toBeVisible();

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual(
    [],
  );
});

test("/sandbox/tower loads canvas + tower panel without errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/sandbox/tower");

  await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });
  await expect(
    page.locator('[data-testid="tower-control-panel"]'),
  ).toBeVisible();

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual(
    [],
  );
});
