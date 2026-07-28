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
await page.waitForTimeout(1200);
await page.click('text=redraw the same thing');
await page.waitForTimeout(1400);
await page.click('text=redraw the same thing');
await page.waitForTimeout(1200);

// v2 tour: flyout -> inspect mode -> pinned popover with resolved source
const inShadow = (body) =>
  page.evaluate(
    ([code]) => new Function('root', code)(
      document.querySelector('[data-canvas-scan]').shadowRoot),
    [body],
  );
await inShadow(`root.querySelector('.control.counts').dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}))`);
await page.waitForTimeout(1600);
await inShadow(`root.querySelector('.control.inspect').dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}))`);
await page.waitForTimeout(1200);
await inShadow(`
  const outlines = [...root.querySelectorAll('.outline')];
  outlines[outlines.length - 1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
`);
await page.waitForFunction(() => {
  const root = document.querySelector('[data-canvas-scan]')?.shadowRoot;
  const text = root?.querySelector('.popover')?.textContent ?? '';
  return /source: .+:\d+/.test(text);
}, null, { timeout: 8000 });
await page.waitForTimeout(2200);

const video = page.video();
await context.close();
console.log(await video.path());
await browser.close();
