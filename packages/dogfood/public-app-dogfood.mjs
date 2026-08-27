// Dogfood canvas-scan against a public application it has never seen.
//
// The existing Excalidraw probes clone a repo, patch its entry, and assert a
// finding we already know is there — a regression harness. This asks the other
// question: point the tool at a deployed production build, drive it like a
// user, and report whatever it says without deciding the answer first.
//
// The tarball is loaded through addInitScript, which runs before any page
// script. That is the "first import" position the README requires, obtained
// without touching the application.
//
// Usage: node public-app-dogfood.mjs --url=https://excalidraw.com --out=/path/dir
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const iife = path.join(root, 'packages/core/dist/canvas-scan.iife.js');
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const index = arg.indexOf('=');
  return index === -1 ? [arg.slice(2), true] : [arg.slice(2, index), arg.slice(index + 1)];
}));
const target = args.url ?? 'https://excalidraw.com';
const outDir = args.out ?? path.join(root, `.dogfood-${Date.now()}`);

if (!existsSync(iife)) throw new Error(`build the bundle first: pnpm --filter canvas-scan run build (${iife})`);
mkdirSync(outDir, { recursive: true });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = (name, value) => {
  writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
  return value;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Before any application script: the position a real install would occupy.
await context.addInitScript({ path: iife });
const page = await context.newPage();

const consoleLines = [];
page.on('console', message => consoleLines.push({ type: message.type(), text: message.text() }));
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));

const report = { target, startedAt: new Date().toISOString() };

try {
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Did it get in early enough to matter?
  report.load = await page.evaluate(() => ({
    installed: !!window.__CANVAS_SCAN__,
    version: window.__CANVAS_SCAN__?.version ?? null,
    getContextWrapped: !/native code/.test(HTMLCanvasElement.prototype.getContext.toString()),
    fillRectWrapped: !/native code/.test(CanvasRenderingContext2D.prototype.fillRect.toString()),
  }));

  await page.waitForSelector('canvas', { timeout: 45_000 });
  await sleep(3000);

  report.canvases = await page.evaluate(() => [...document.querySelectorAll('canvas')].map(c => ({
    id: c.id || null,
    className: typeof c.className === 'string' ? c.className : null,
    backing: [c.width, c.height],
    css: [Math.round(c.getBoundingClientRect().width), Math.round(c.getBoundingClientRect().height)],
  })));

  // What the tool sees before anyone asks it anything.
  report.passiveReports = await page.evaluate(() => Object.entries(window.__CANVAS_SCAN__.getReports())
    .map(([id, r]) => ({ id, owner: r.nearestReactOwner, kind: r.attributionKind, status: r.signatureStatus, raster: r.rasterOperationCount })));

  await page.evaluate(() => window.__CANVAS_SCAN__.startRecording());
  await page.evaluate(() => window.__CANVAS_SCAN__.mark('interaction start'));

  // A plain drawing session: pick the rectangle tool, drag out a few shapes,
  // then pan. Nothing exotic, and nothing that depends on internals.
  const box = await page.locator('canvas').first().boundingBox();
  const originX = box ? box.x + 200 : 400;
  const originY = box ? box.y + 200 : 300;
  const drag = async (x1, y1, x2, y2) => {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(x1 + ((x2 - x1) * step) / 12, y1 + ((y2 - y1) * step) / 12);
      await sleep(25);
    }
    await page.mouse.up();
    await sleep(250);
  };

  // Build a scene worth redrawing. A handful of shapes leaves the app idle,
  // and a tool that reports nothing on an idle app is right to.
  await page.evaluate(() => window.__CANVAS_SCAN__.mark('draw scene'));
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 5; column++) {
      await page.keyboard.press(row % 2 === 0 ? 'r' : 'o');
      const x = originX + column * 130;
      const y = originY + row * 90;
      await drag(x, y, x + 100, y + 65);
    }
  }

  // Select everything and drag it about. Every pointermove repaints the whole
  // scene, which is where a canvas application actually spends its time.
  await page.evaluate(() => window.__CANVAS_SCAN__.mark('drag whole selection'));
  await page.keyboard.press('Escape');
  await page.keyboard.down('Meta');
  await page.keyboard.press('a');
  await page.keyboard.up('Meta');
  await sleep(300);
  for (let pass = 0; pass < 3; pass++) {
    await drag(originX + 240, originY + 120, originX + 240 + (pass % 2 ? -140 : 140), originY + 120 + (pass % 2 ? -90 : 90));
  }

  // Zooming rescales and repaints everything.
  await page.evaluate(() => window.__CANVAS_SCAN__.mark('zoom'));
  for (let step = 0; step < 6; step++) {
    await page.keyboard.down('Meta');
    await page.mouse.wheel(0, step % 2 === 0 ? -240 : 240);
    await page.keyboard.up('Meta');
    await sleep(180);
  }

  // Pointer movement with no drawing: the case that should stay quiet.
  await page.evaluate(() => window.__CANVAS_SCAN__.mark('idle pointer movement'));
  for (let step = 0; step < 25; step++) {
    await page.mouse.move(originX + step * 12, originY + 60 + (step % 5) * 8);
    await sleep(30);
  }

  const session = save('session.json', await page.evaluate(() => window.__CANVAS_SCAN__.stopRecording()));

  report.session = {
    sessionId: session.sessionId,
    durationMs: session.durationMs,
    captureEvery: session.captureEvery,
    canvasScanVersion: session.canvasScanVersion,
    windows: session.windows.length,
    episodes: session.episodes.length,
    droppedEntryCounts: session.droppedEntryCounts,
    browserFeatures: session.browserFeatures,
    canvases: session.canvases.map(c => ({
      canvasId: c.canvasId,
      owner: c.nearestReactOwner,
      kind: c.attributionKind,
      activeWindows: c.activeWindowCount,
      raster: c.rasterOperationCount,
      selfTimeMs: c.canvasApiSelfTimeMs,
      worstFrameMs: c.maxWindowSelfTimeMs,
      commandStatuses: c.commandStatuses,
      topMethods: Object.entries(c.methodEvidence)
        .sort((a, b) => (b[1].canvasApiSelfTimeMs ?? 0) - (a[1].canvasApiSelfTimeMs ?? 0))
        .slice(0, 6)
        .map(([method, value]) => `${method} ×${value.count} (${value.canvasApiSelfTimeMs ?? '—'} ms)`),
    })),
    findings: session.findings.map((f, index) => ({
      rank: index + 1,
      type: f.type,
      canvasId: f.canvasId,
      owner: session.canvases.find(c => c.canvasId === f.canvasId)?.nearestReactOwner ?? null,
      selfTimeMs: f.canvasApiSelfTimeMs,
      raster: f.rasterOperationCount,
      evidenceLevel: f.evidenceLevel,
      detail: f.type === 'heavy-canvas-work'
        ? { slowestFrameMs: f.maximumWindow.canvasApiSelfTimeMs, slowestFrameRaster: f.maximumWindow.rasterOperationCount, topMethods: f.topMethods.slice(0, 4).map(m => `${m.method} ×${m.count} (${m.canvasApiSelfTimeMs ?? '—'} ms)`) }
        : f.type === 'repeated-draw-work'
          ? { repeatedWindows: f.repeatedWindowCount, adjacentIdenticalPairs: f.adjacentIdenticalWindowPairs, unknownCoverage: f.unknownCoverage }
          : f.type === 'resize-churn'
            ? { observed: f.observedResetCount, active: f.activeResetCount, dimensionChanges: f.dimensionChanges }
            : { affectedWindows: f.affectedWindowCount },
      nextCheck: f.nextCheck,
    })),
    marks: session.browserEntries.filter(e => e.kind === 'user-mark').map(e => e.label),
    associations: session.episodeAssociations.length,
  };

  // Nothing the tool writes should reach a host application's console.
  report.consoleFromCanvasScan = consoleLines.filter(l => l.text.includes('[canvas-scan]'));
  report.pageErrors = pageErrors;
  report.consoleErrorCount = consoleLines.filter(l => l.type === 'error').length;
} catch (error) {
  report.error = String(error);
} finally {
  save('report.json', report);
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
console.log(`\nevidence: ${outDir}`);
if (report.error) process.exit(1);
