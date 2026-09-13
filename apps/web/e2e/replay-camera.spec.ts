/**
 * SLS-121 — the view must follow a replay that is loaded after the page has
 * settled.
 *
 * Regression: the live runner published a world on EVERY animation frame, not
 * only while advancing, so a force-paused runner kept overwriting
 * `simStore.world` with its stale t=0 world and clobbering ReplayDriver's
 * writes. The 3D view stayed frozen at the scenario start (65 km up) while the
 * HUD showed the replay's values — the two read the store at different points
 * in the frame. It looked like "the scene fails to render": at 65 km there is
 * correctly no ground, no tower and a black sky.
 *
 * Timing mattered, which is why it hid for so long: loading a replay within
 * ~100 ms of the canvas appearing beat the race and looked fine. Every
 * realistic flow — and every CI run, being slower — lost it.
 *
 * The assertion deliberately reads the CAMERA, via the perf overlay. HUD
 * altitude is world-derived and stayed correct throughout the bug, so it
 * cannot detect this; camera position is the only signal that can.
 */
import { expect, test } from "@playwright/test";

const REPLAY = "public/replays/neural-catch-calm.json";

/** Scenario start altitude; the camera must not still be up here. */
const START_ALT_M = 65_000;

test("view follows a replay loaded after the scene settles", async ({ page }) => {
  test.setTimeout(120_000);

  await page.addInitScript(() => {
    window.localStorage.setItem("sls:tutorial-dismissed", "1");
    // The perf overlay prints the live camera position — the only
    // camera-derived readout the app exposes to a test.
    window.localStorage.setItem("sls.perfHud", "true");
  });
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 20_000 });

  // Let the scene settle first — this is what triggered the bug.
  await page.waitForTimeout(2_000);

  await page.getByTestId("scenario-load-replay-input").setInputFiles(REPLAY);
  await expect(page.getByTestId("replay-player")).toBeVisible({ timeout: 30_000 });

  const toggle = page.getByTestId("replay-play-toggle");
  if ((await toggle.textContent())?.match(/pause/i)) await toggle.click();

  // Park near the end of the terminal window: booster in the chopsticks.
  await page.getByTestId("replay-scrub").evaluate((el: HTMLInputElement) => {
    const min = Number(el.min);
    const max = Number(el.max);
    const step = Number(el.step) || 1;
    const target = min + Math.round(((max - min) * 0.96) / step) * step;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, String(target));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(2_000);

  const overlay = await page.getByTestId("debug-overlay").innerText();
  const cam = /cam\s+(-?[\d.]+),\s*(-?[\d.]+),\s*(-?[\d.]+)/.exec(overlay);
  expect(cam, `could not parse camera from overlay: ${overlay}`).not.toBeNull();
  const camY = Number(cam![2]);

  // With the bug the camera sat at ~65,200 m. The terminal frame puts it a
  // couple of hundred metres up, so 1 km is a wide but decisive margin.
  expect(camY).toBeLessThan(1_000);
  expect(camY).toBeGreaterThan(0);
  expect(camY).toBeLessThan(START_ALT_M / 10);
});
