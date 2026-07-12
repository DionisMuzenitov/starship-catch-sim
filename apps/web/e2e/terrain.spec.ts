import { expect, test } from "@playwright/test";

// The baked terrain is gated off on software rasterisers (headless CI runs
// SwiftShader) so the interactive specs keep their frame budget — see
// Terrain.tsx. These specs force it on to verify the assets + decode path
// still load cleanly end-to-end. Load-only assertions by design: at software
// frame rates interaction timing would flake.
for (const variant of ["a", "b"] as const) {
  test(`baked terrain force-loads without errors (drape ${variant})`, async ({
    page,
  }) => {
    test.setTimeout(60_000); // 3 MB of drapes + decode on a software-GL page

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    // match on URL only — repeat visits are served as 304s
    const heightRes = page.waitForResponse(
      (r) => r.url().includes("/assets/terrain/near.height.png"),
      { timeout: 45_000 },
    );
    const drapeRes = page.waitForResponse(
      (r) => r.url().includes(`/assets/terrain/near.drape.${variant}.jpg`),
      { timeout: 45_000 },
    );

    await page.goto(`/?terrain=force&drape=${variant}`);
    await expect(page.locator("canvas")).toBeVisible({ timeout: 10_000 });
    await heightRes;
    await drapeRes;
    // give the decode + geometry build a beat to surface any runtime error
    await page.waitForTimeout(3_000);

    expect(
      errors,
      `unexpected console errors (variant ${variant}):\n${errors.join("\n")}`,
    ).toEqual([]);
  });
}
