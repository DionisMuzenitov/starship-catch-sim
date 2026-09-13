import { expect, test } from "@playwright/test";
import { gotoStableScene } from "./visual-harness";

// TEMP SLS-121: is the site geometry CULLED (never submitted) or DRAWN and
// invisible? renderer.info.render.calls/triangles answers that directly.
test("SLS121 scene diagnostic", async ({ page }) => {
  test.setTimeout(120_000);
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
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    const caps: any[] = (window as any).__captured || [];
    const gl = caps.find((o) => o?.isWebGLRenderer);
    if (gl) { gl.info.autoReset = false; gl.info.reset(); }
  });
  await page.waitForTimeout(1200);

  // Per-FRAME draw calls: brackets exactly one rendered frame, so the number
  // is independent of how fast the host renders. This is the discriminator —
  // same per-frame calls means the geometry is submitted and the problem is
  // rasterisation/shading, not culling.
  const perFrame = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const caps: any[] = (window as any).__captured || [];
        const gl = caps.find((o) => o?.isWebGLRenderer);
        if (!gl) return resolve(null);
        requestAnimationFrame(() => {
          gl.info.autoReset = false;
          gl.info.reset();
          requestAnimationFrame(() =>
            resolve({
              calls: gl.info.render.calls,
              tris: gl.info.render.triangles,
            }),
          );
        });
      }),
  );
  console.log("SLS121_FRAME " + JSON.stringify(perFrame));

  const diag = await page.evaluate(() => {
    const caps: any[] = (window as any).__captured || [];
    const scene = caps.find((o) => o?.isScene);
    const gl = caps.find((o) => o?.isWebGLRenderer);
    if (!scene || !gl) return { reachable: false, captured: caps.length };
    const camera: any = null;
    const cam = camera;
    const meshes: any[] = [];
    scene.traverse((o: any) => {
      if (!o.isMesh && !o.isPoints) return;
      o.geometry?.computeBoundingSphere?.();
      const bs = o.geometry?.boundingSphere;
      const wp = o.getWorldPosition(o.position.clone());
      meshes.push({
        t: o.isPoints ? "points" : "mesh",
        n: (o.name || o.parent?.name || "?").slice(0, 22),
        vis: o.visible,
        fc: o.frustumCulled,
        r: bs ? Math.round(bs.radius) : null,
        y: Math.round(wp.y),
      });
    });
    return {
      reachable: true,
      cam,
      render: { calls: gl.info.render.calls, tris: gl.info.render.triangles },
      memory: { geometries: gl.info.memory.geometries, textures: gl.info.memory.textures },
      programs: gl.info.programs ? gl.info.programs.length : null,
      meshCount: meshes.length,
      big: meshes.filter((m) => (m.r ?? 0) > 200).slice(0, 10),
      sample: meshes.slice(0, 14),
    };
  });
  console.log("SLS121_DIAG " + JSON.stringify(diag));
  expect("collect", "deliberate failure to collect artifacts").toBe("x");
});
