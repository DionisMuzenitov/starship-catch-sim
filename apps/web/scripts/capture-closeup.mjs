import { chromium } from "@playwright/test";

const URL = `http://localhost:4173${process.argv[3] ?? "/sandbox/models"}`;
const OUT = process.argv[2] ?? "closeup.png";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  const t = msg.type();
  const text = msg.text();
  // Filter out the noisy WebGL driver warnings from software rendering.
  if (text.includes("GL Driver Message") || text.includes("glBlitFramebuffer")) {
    return;
  }
  if (t === "error" || t === "warning") {
    errors.push(`${t}: ${text}`);
  }
});
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("canvas");

await page.evaluate(() => {
  const setNative = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  const inputs = Array.from(
    document.querySelectorAll('[data-testid="control-panel"] input[type="range"]'),
  );
  inputs.forEach((inp) => {
    const lbl = inp.parentElement && inp.parentElement.firstChild
      ? inp.parentElement.firstChild.textContent
      : "";
    if (lbl && lbl.trim() === "throttle") {
      setNative.call(inp, "1");
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
});
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT, fullPage: false });
await browser.close();
if (errors.length) console.log("ERRORS:\n" + errors.join("\n"));
console.log(`wrote ${OUT}`);
