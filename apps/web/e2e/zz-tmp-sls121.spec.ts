import { expect, test } from "@playwright/test";
import { gotoStableScene } from "./visual-harness";

/**
 * TEMP SLS-121 discriminator.
 *
 * The geometry is submitted (203 calls/frame, identical to a host that
 * renders it) but nothing reaches the framebuffer. Two mechanisms remain:
 *   A. fragments are REJECTED (depth test) — test by disabling depthTest
 *   B. fragments are DRAWN BLACK (lighting/standard-material shader on the
 *      Subzero JIT) — test by forcing emissive magenta, which needs no light
 * Whichever variant reveals the tower/ground identifies the mechanism.
 */
async function setup(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    (window as any).__THREE_DEVTOOLS__ = {
      dispatchEvent(e: any) {
        ((window as any).__captured ||= []).push(e.detail);
      },
    };
  });
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
  await page.waitForTimeout(2500);
}

for (const variant of ["depthoff", "emissive"] as const) {
  test(`SLS121 ${variant}`, async ({ page }) => {
    test.setTimeout(120_000);
    await setup(page);
    const touched = await page.evaluate((v) => {
      const caps: any[] = (window as any).__captured || [];
      const scene = caps.find((o) => o?.isScene);
      if (!scene) return -1;
      let n = 0;
      scene.traverse((o: any) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          if (v === "depthoff") {
            m.depthTest = false;
          } else {
            m.emissive?.setRGB(1, 0, 1);
            m.emissiveIntensity = 1;
            m.color?.setRGB(1, 0, 1);
          }
          m.needsUpdate = true;
          n++;
        }
      });
      return n;
    }, variant);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `test-results/sls121-${variant}.png` });
    console.log(`SLS121_MAT ${variant} touched=${touched}`);
    expect("collect", "deliberate failure to collect artifacts").toBe("x");
  });
}
