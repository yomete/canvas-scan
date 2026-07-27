// Headless dogfood collector: loads an instrumented app in headless Chrome
// (rAF fires there, unlike a hidden preview tab), aggregates every canvas-scan
// report window, runs a scripted interaction scenario, and prints a JSON
// summary of signatureStatus distribution / attribution / overhead per canvas.
//
// Usage: node collect.mjs <url> <scenario: workbench|excalidraw|idle> [durationMs]
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5174';
const scenario = process.argv[3] ?? 'workbench';
const idleMs = Number(process.argv[4] ?? 15000);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

const warnings = [];
const pageErrors = [];
page.on('console', (m) => {
  const text = m.text();
  if (text.includes('[canvas-scan]') && m.type() === 'warning') warnings.push(text);
});
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__CANVAS_SCAN__ != null, null, { timeout: 15000 });

await page.evaluate(() => {
  const agg = (window.__DOGFOOD__ = { pollFrames: 0, byCanvas: {} });
  const last = new Map();
  const loop = () => {
    agg.pollFrames++;
    const reports = window.__CANVAS_SCAN__.getReports();
    for (const [id, r] of Object.entries(reports)) {
      if (last.get(id) === r) continue; // same report object -> no new window
      last.set(id, r);
      const c = (agg.byCanvas[id] ??= {
        owner: r.nearestReactOwner,
        kind: r.attributionKind,
        windows: 0,
        same: 0,
        changed: 0,
        unknown: 0,
        rasterOps: 0,
        selfTimeMs: 0,
        maxGap: 0,
        unknownReasons: {},
      });
      c.owner = r.nearestReactOwner;
      c.kind = r.attributionKind;
      c.windows++;
      c[r.signatureStatus]++;
      if (r.signatureStatus === 'unknown' && r.unknownReason) {
        c.unknownReasons[r.unknownReason] = (c.unknownReasons[r.unknownReason] ?? 0) + 1;
      }
      c.rasterOps += r.rasterOperationCount;
      c.selfTimeMs += r.canvasApiSelfTimeMs;
      if (r.comparisonGap && r.comparisonGap > c.maxGap) c.maxGap = r.comparisonGap;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (scenario === 'workbench') {
  await sleep(3000); // mount + initial chart animation settle
  for (let i = 0; i < 5; i++) {
    await page.click('#rerender-same');
    await sleep(1400);
  }
  for (let i = 0; i < 2; i++) {
    await page.click('#randomize');
    await sleep(1400);
  }
  const stage = await page.locator('#konva-stage canvas').first().boundingBox();
  if (stage) {
    await page.mouse.move(stage.x + 40, stage.y + 40);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(stage.x + 40 + i * 15, stage.y + 40 + i * 8);
      await sleep(30);
    }
    await page.mouse.up();
  }
  await sleep(2000);
} else if (scenario === 'excalidraw') {
  await sleep(3000); // mount + welcome screen settle; watch for idle redraws
  const drag = async (x1, y1, x2, y2) => {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps);
      await sleep(30);
    }
    await page.mouse.up();
  };
  // Two rectangles: 'r' selects the rectangle tool (Excalidraw reverts to
  // selection after each shape, so press it again for the second).
  await page.keyboard.press('r');
  await drag(400, 300, 550, 400);
  await sleep(500);
  await page.keyboard.press('r');
  await drag(600, 350, 750, 480);
  await sleep(500);
  // Pan with the hand tool.
  await page.keyboard.press('h');
  await drag(500, 400, 320, 280);
  await sleep(5000); // trailing idle: false-`same` watch
} else {
  await sleep(idleMs);
}

const data = await page.evaluate(() => window.__DOGFOOD__);
const reactScanPresent = await page.evaluate(
  () => Boolean(window.__REACT_SCAN__ ?? window.ReactScan ?? window.reactScan),
);
await browser.close();

console.log(
  JSON.stringify({ url, scenario, reactScanPresent, warnings, pageErrors, ...data }, null, 2),
);
