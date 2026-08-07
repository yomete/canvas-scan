import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://127.0.0.1:4385';
const outputPath = process.argv[3] ?? '/private/tmp/sidproj-59-excalidraw-v04.json';
const screenshotPath = process.argv[4] ?? '/private/tmp/sidproj-59-excalidraw-v04.png';
const excalidrawRevision = process.argv[5];

const allowedPath = (file, extension) => path.isAbsolute(file)
  && path.resolve(file) === file
  && new RegExp(`^/private/tmp/sidproj-59-[A-Za-z0-9_.-]+\\.${extension}$`).test(file);

if (!allowedPath(outputPath, 'json')) throw new Error(`unexpected output path: ${outputPath}`);
if (!allowedPath(screenshotPath, 'png')) throw new Error(`unexpected screenshot path: ${screenshotPath}`);
if (!/^[0-9a-f]{40}$/.test(excalidrawRevision ?? '')) throw new Error('expected an exact Excalidraw Git revision');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));

function summarize(session) {
  const commandStatuses = { same: 0, changed: 0, unknown: 0 };
  const unknownReasons = {};
  let rasterOperationCount = 0;
  let canvasApiSelfTimeMs = 0;

  for (const window of session.windows) {
    commandStatuses[window.signatureStatus] += 1;
    rasterOperationCount += window.rasterOperationCount;
    canvasApiSelfTimeMs += window.canvasApiSelfTimeMs;
    if (window.signatureStatus === 'unknown' && window.unknownReason) {
      unknownReasons[window.unknownReason] = (unknownReasons[window.unknownReason] ?? 0) + 1;
    }
  }

  return {
    measured: {
      canvasCount: session.canvases.length,
      activeWindowCount: session.windows.length,
      episodeCount: session.episodes.length,
      rasterOperationCount,
      canvasApiSelfTimeMs: Number(canvasApiSelfTimeMs.toFixed(3)),
      commandStatuses,
      unknownReasons,
    },
    associated: {
      browserEntryCount: session.browserEntries.length,
      episodeAssociationCount: session.episodeAssociations.length,
      browserFeatures: session.browserFeatures,
    },
    candidates: session.findings.map(finding => ({
      type: finding.type,
      canvasId: finding.canvasId,
      evidenceLevel: finding.evidenceLevel,
      observation: finding.claimBoundary.observation,
      explanation: finding.claimBoundary.explanation,
      nonEstablishedFacts: finding.claimBoundary.nonEstablishedFacts,
      nextCheck: finding.nextCheck,
    })),
    limits: {
      collectionLimits: session.collectionLimits,
      droppedEntryCounts: session.droppedEntryCounts,
      claimBoundaries: session.findings.map(finding => ({ type: finding.type, ...finding.claimBoundary })),
    },
  };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const diagnostics = { canvasScanWarnings: [], consoleErrors: [], pageErrors: [] };

page.on('console', message => {
  const text = message.text();
  if (message.type() === 'warning' && text.includes('[canvas-scan]')) diagnostics.canvasScanWarnings.push(text);
  if (message.type() === 'error') diagnostics.consoleErrors.push(text);
});
page.on('pageerror', error => diagnostics.pageErrors.push(String(error)));

let artifact;
try {
  await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction(() => window.__CANVAS_SCAN__ != null, null, { timeout: 30_000 });
  await page.locator('canvas').first().waitFor({ timeout: 30_000 });
  const staticCanvas = page.locator('canvas.excalidraw__canvas.static');
  await staticCanvas.waitFor({ timeout: 30_000 });
  await sleep(3_000);

  const identity = await page.evaluate(() => ({
    earlyLoad: window.__SIDPROJ_59_EARLY__,
    version: window.__CANVAS_SCAN__.version,
    publicApi: ['startRecording', 'stopRecording', 'getLastSession', 'mark']
      .every(key => typeof window.__CANVAS_SCAN__[key] === 'function'),
    canvasCountBefore: document.querySelectorAll('canvas').length,
  }));

  await page.evaluate(() => window.__CANVAS_SCAN__.startRecording());
  const initialSceneSha256 = sha256(await staticCanvas.screenshot());

  const drag = async (x1, y1, x2, y2) => {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(x1 + ((x2 - x1) * step) / 10, y1 + ((y2 - y1) * step) / 10);
      await sleep(30);
    }
    await page.mouse.up();
  };

  await page.evaluate(() => window.__CANVAS_SCAN__.mark('rectangle-1'));
  await page.keyboard.press('r');
  const rectangle1ToolActive = await page.getByTestId('toolbar-rectangle').getAttribute('aria-pressed') === 'true';
  await drag(400, 300, 550, 400);
  await sleep(500);
  const rectangle1SceneSha256 = sha256(await staticCanvas.screenshot());

  await page.evaluate(() => window.__CANVAS_SCAN__.mark('rectangle-2'));
  await page.keyboard.press('r');
  const rectangle2ToolActive = await page.getByTestId('toolbar-rectangle').getAttribute('aria-pressed') === 'true';
  await drag(600, 350, 750, 480);
  await sleep(500);
  const rectangle2SceneSha256 = sha256(await staticCanvas.screenshot());

  await page.evaluate(() => window.__CANVAS_SCAN__.mark('pan'));
  await page.keyboard.press('h');
  const handToolActive = await page.getByTestId('toolbar-hand').getAttribute('aria-pressed') === 'true';
  await drag(500, 400, 320, 280);
  await sleep(750);
  const pannedSceneSha256 = sha256(await staticCanvas.screenshot());

  const interactionEvidence = {
    rectangle1: { toolActive: rectangle1ToolActive, beforeSceneSha256: initialSceneSha256, afterSceneSha256: rectangle1SceneSha256 },
    rectangle2: { toolActive: rectangle2ToolActive, beforeSceneSha256: rectangle1SceneSha256, afterSceneSha256: rectangle2SceneSha256 },
    pan: { toolActive: handToolActive, beforeSceneSha256: rectangle2SceneSha256, afterSceneSha256: pannedSceneSha256 },
  };

  const session = plain(await page.evaluate(() => window.__CANVAS_SCAN__.stopRecording()));
  const lastSession = plain(await page.evaluate(() => window.__CANVAS_SCAN__.getLastSession()));
  await page.screenshot({ path: screenshotPath });

  const sessionText = JSON.stringify(session);
  const checks = {
    publicPackageVersion: identity.version === '0.4.0',
    loadedBeforeReact: identity.earlyLoad?.scanLoaded === true
      && identity.earlyLoad?.version === '0.4.0'
      && identity.earlyLoad?.reactHookInstalled === true,
    publicApi: identity.publicApi,
    canvasObserved: identity.canvasCountBefore > 0 && session.canvases.length > 0,
    rectanglesChangedScene: rectangle1ToolActive
      && rectangle2ToolActive
      && initialSceneSha256 !== rectangle1SceneSha256
      && rectangle1SceneSha256 !== rectangle2SceneSha256,
    panChangedScene: handToolActive && rectangle2SceneSha256 !== pannedSceneSha256,
    boundedRecording: session.schemaVersion === 1 && session.stopReason === 'manual' && session.windows.length > 0,
    stableSavedSession: JSON.stringify(session) === JSON.stringify(lastSession),
    plainJson: JSON.stringify(plain(session)) === sessionText,
    noDiagnostics: diagnostics.canvasScanWarnings.length === 0
      && diagnostics.consoleErrors.length === 0
      && diagnostics.pageErrors.length === 0,
  };

  artifact = {
    schemaVersion: 1,
    issue: 'SIDPROJ-59',
    status: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
    capturedAt: new Date().toISOString(),
    app: {
      name: 'Excalidraw',
      repository: 'https://github.com/excalidraw/excalidraw',
      revision: excalidrawRevision,
      scenario: ['draw rectangle', 'draw rectangle', 'pan canvas'],
    },
    package: {
      name: 'canvas-scan',
      version: '0.4.0',
      registryTarball: 'https://registry.npmjs.org/canvas-scan/-/canvas-scan-0.4.0.tgz',
      registryTarballSha256: '80ec1ccb685dccd93db19ff93832bb664ffe58a9411a1d6995b286fd9893cc0e',
      loadedIifeSha256: '8e1773f85717275799d22abee05f7d03874615a5d350a79fe0f8e28a93dfe15c',
    },
    browser: { name: 'Google Chrome', version: browser.version() },
    url,
    commands: [
      'git clone --depth 1 https://github.com/excalidraw/excalidraw.git /private/tmp/sidproj-59-excalidraw.4YCqNA/repo',
      'yarn install --frozen-lockfile --ignore-scripts --network-timeout 600000',
      'yarn --cwd excalidraw-app vite --host 127.0.0.1 --port 4385',
      `node packages/dogfood/excalidraw-v04.mjs ${url} ${outputPath} ${screenshotPath} ${excalidrawRevision}`,
    ],
    disposableChanges: [
      'Removed examples/* from the Yarn workspace list before install.',
      'Copied the public canvas-scan IIFE to public/canvas-scan.iife.js.',
      'Loaded the IIFE and the early-load marker before Excalidraw index.tsx.',
    ],
    identity,
    interactionEvidence,
    checks,
    diagnostics,
    evidence: summarize(session),
    sessionSha256: sha256(sessionText),
    screenshotPath,
    session,
  };
} catch (error) {
  artifact = {
    schemaVersion: 1,
    issue: 'SIDPROJ-59',
    status: 'FAIL',
    capturedAt: new Date().toISOString(),
    error: error instanceof Error ? error.stack : String(error),
    diagnostics,
  };
} finally {
  await browser.close();
}

await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ status: artifact.status, outputPath, screenshotPath }, null, 2));
if (artifact.status !== 'PASS') process.exitCode = 1;
