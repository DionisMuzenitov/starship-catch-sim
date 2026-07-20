import { expect, test } from "@playwright/test";

// SLS-58: per-mode camera controls. Switching every mode must not throw, and
// wheel-zoom + drag-orbit on the canvas must be accepted without console errors.
// Kept lean (mode switches are cheap; the expensive mouse interaction runs on
// one orbit-track + one orbit-free mode) so it stays under the timeout even when
// the suite runs several WebGL canvases in parallel.
test("camera modes switch and accept wheel + drag without console errors", async ({
  page,
}) => {
  // Heaviest e2e in the suite: boots a full WebGL scene (GLB tower + terrain),
  // switches through all six camera modes, then does real wheel/drag input. It
  // runs ~29 s on a fast dev box and tips over the 30 s default on CI's
  // throttled 2-core runner, so give it explicit headroom (a slow render loop
  // starves the input queue, not a logic bug).
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 10_000 });

  // Switch through every camera mode: C chase · T tower · G ground · O free ·
  // N onboard · M cinematic. Each seeds/hands off the camera; none should throw.
  for (const key of ["c", "t", "g", "o", "n", "m"]) {
    await page.locator("body").press(key);
  }

  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  async function wheelAndDrag() {
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -120);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 30);
    await page.mouse.up();
  }

  await page.locator("body").press("c"); // chase — orbit-track
  await wheelAndDrag();
  await page.locator("body").press("g"); // ground — orbit-free
  await wheelAndDrag();

  expect(errors, `unexpected console errors:\n${errors.join("\n")}`).toEqual(
    [],
  );
});
