import { chromium } from "@playwright/test";

const PORT = process.env.PORT ?? "4173";
const URL_PATH = process.argv[3] ?? "/";
const URL = `http://localhost:${PORT}${URL_PATH}`;
const OUT = process.argv[2] ?? "scene-capture.png";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas");
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT, fullPage: false });
await browser.close();
console.log(`wrote ${OUT}`);
