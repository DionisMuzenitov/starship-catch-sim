import { chromium } from "@playwright/test";

const URL = `http://localhost:4173${process.argv[2] ?? "/"}`;
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("console", (msg) => console.log(`[${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await browser.close();
