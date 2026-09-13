import { expect, test } from "@playwright/test";
import { gotoStableScene } from "./visual-harness";

// TEMP SLS-121: capture the terminal frame under each GL-backend variant,
// and report the renderer string so the variant is self-identifying.
test("SLS121 gl backend matrix", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const name = testInfo.project.name;
  await gotoStableScene(page);
  await page.getByTestId("scenario-load-replay-input")
    .setInputFiles("public/replays/neural-catch-calm.json");
  await expect(page.getByTestId("replay-player")).toBeVisible({ timeout: 30_000 });
  const toggle = page.getByTestId("replay-play-toggle");
  if ((await toggle.textContent())?.match(/pause/i)) await toggle.click();
  await page.getByTestId("replay-scrub").evaluate((el: HTMLInputElement) => {
    const min = Number(el.min), max = Number(el.max), step = Number(el.step) || 1;
    const raw = min + (max - min) * 0.96;
    const target = min + Math.round((raw - min) / step) * step;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, String(target));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(3000);
  const renderer = await page.evaluate(() => {
    const c = document.querySelector("canvas") as HTMLCanvasElement;
    const g = c.getContext("webgl2") as WebGL2RenderingContext;
    const ext = g.getExtension("WEBGL_debug_renderer_info");
    return ext ? String(g.getParameter((ext as any).UNMASKED_RENDERER_WEBGL)) : "n/a";
  });
  await page.screenshot({ path: `test-results/sls121-${name}.png` });
  console.log(`SLS121_MATRIX ${name} :: ${renderer}`);
  expect("collect", "deliberate failure to collect artifacts").toBe("x");
});
