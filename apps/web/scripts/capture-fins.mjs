import { chromium } from "@playwright/test";

const URL = `http://localhost:4173/sandbox/models`;
const OUT = process.argv[2] ?? "fins.png";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas");

// Wheel-zoom and drag-orbit to a near top-down view of the booster fins.
const canvas = await page.locator("canvas").elementHandle();
if (canvas) {
  const box = await canvas.boundingBox();
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    // Pan-left so the booster is roughly centred (booster is at world x=-30).
    await page.mouse.down({ button: "right" });
    await page.mouse.move(cx + 250, cy, { steps: 20 });
    await page.mouse.up({ button: "right" });
    await page.waitForTimeout(150);
    // Drag-orbit upward to look more from above.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 280, { steps: 30 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    // Zoom in moderately.
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -50);
      await page.waitForTimeout(20);
    }
  }
}
await page.waitForTimeout(800);
await page.screenshot({ path: OUT, fullPage: false });
await browser.close();
console.log(`wrote ${OUT}`);
