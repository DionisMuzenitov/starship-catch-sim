import { expect, test } from "@playwright/test";
import { gotoStableScene } from "./visual-harness";

// TEMP SLS-121: capture the terminal frame under render-config variants.
for (const [label, url] of [
  ["logdepth-on", "/"],
  ["logdepth-off", "/?logdepth=0"],
] as const) {
  test(`SLS121 ${label}`, async ({ page }) => {
    test.setTimeout(120_000);
    await gotoStableScene(page, url);
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
    await page.screenshot({ path: `test-results/sls121-${label}.png` });
    const gl = await page.evaluate(() => {
      const c = document.querySelector("canvas") as HTMLCanvasElement;
      const g = c.getContext("webgl2") as WebGL2RenderingContext;
      return { depthBits: g.getParameter(g.DEPTH_BITS), samples: g.getParameter(g.SAMPLES), fragDepth: true };
    });
    console.log(`SLS121_GL ${label} ` + JSON.stringify(gl));
  });
}
