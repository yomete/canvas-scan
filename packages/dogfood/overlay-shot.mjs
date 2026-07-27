import { chromium } from 'playwright-core';

const shotPath = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://localhost:5173', { waitUntil: 'load' });
await page.waitForFunction(() => window.__CANVAS_SCAN__ != null, null, { timeout: 15000 });
await page.waitForTimeout(1200);

await page.click('text=force identical redraw');
await page.waitForTimeout(80);
await page.click('text=force identical redraw');
await page.waitForTimeout(250);

const hudText = await page.evaluate(() => {
  const hostEl = document.querySelector('[data-canvas-scan]');
  return hostEl?.shadowRoot?.querySelector('.hud')?.textContent ?? 'NO HUD';
});
await page.screenshot({ path: shotPath });
await browser.close();
console.log('HUD:', hudText);
