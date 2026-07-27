// Records a short headless-Chrome video of the demo overlay catching forced
// same-signature redraws. Convert to GIF with ffmpeg (see README of this package
// or the command printed at the end).
//
// Usage: node overlay-gif.mjs <output-dir>
import { chromium } from 'playwright-core';

const outDir = process.argv[2] ?? '.';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 880, height: 420 },
  recordVideo: { dir: outDir, size: { width: 880, height: 420 } },
});
const page = await context.newPage();

await page.goto('http://localhost:5173', { waitUntil: 'load' });
await page.waitForFunction(() => window.__CANVAS_SCAN__ != null, null, { timeout: 15000 });
await page.waitForTimeout(1500);
await page.click('text=force same-signature redraw');
await page.waitForTimeout(1800);
await page.click('text=force same-signature redraw');
await page.waitForTimeout(1800);

const video = page.video();
await context.close();
console.log(await video.path());
await browser.close();
