import { expect, test } from "@playwright/test";
import { seedDeterministicState } from "./visual-harness";

test("TEMP ci gl diagnostic", async ({ page }) => {
  test.setTimeout(120_000);
  const errs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message.slice(0, 300)));
  await seedDeterministicState(page);
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const c = document.querySelector("canvas") as HTMLCanvasElement;
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGL2RenderingContext | null;
    if (!gl) return { gl: "none" };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: ext ? String(gl.getParameter((ext as any).UNMASKED_RENDERER_WEBGL)) : "n/a",
      version: String(gl.getParameter(gl.VERSION)),
      maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      lost: gl.isContextLost(),
      depthTex: !!gl.getExtension("WEBGL_depth_texture"),
      floatLinear: !!gl.getExtension("OES_texture_float_linear"),
      colorBufferFloat: !!gl.getExtension("EXT_color_buffer_float"),
    };
  });
  console.log("CIDIAG_INFO " + JSON.stringify(info));
  console.log("CIDIAG_ERRS " + JSON.stringify(errs.slice(0, 12)));
});
