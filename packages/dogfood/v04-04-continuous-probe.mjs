import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const port = 5192;
const baseUrl = `http://127.0.0.1:${port}`;
const sourceBundle = path.join(repoRoot, 'packages/core/dist/canvas-scan.iife.js');
const workbenchBundle = path.join(repoRoot, 'apps/workbench/public/canvas-scan.iife.js');
let server; let browser; let browserVersion = null; let bundleHash = null;
const failures = []; const pageErrors = []; const warnings = [];
const capturedModes = {};

const wait = timeout => new Promise(resolve => setTimeout(resolve, timeout));
const waitForServer = async () => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (server.exitCode != null || server.signalCode != null) throw new Error(`workbench server exited with ${server.exitCode ?? server.signalCode}`);
    try { if ((await fetch(baseUrl)).ok) return; } catch {}
    await wait(250);
  }
  throw new Error('workbench server did not start');
};
const stopServer = async () => {
  if (!server?.pid) return;
  const exited = () => server.exitCode != null || server.signalCode != null;
  try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (!exited()) await Promise.race([once(server, 'exit'), wait(5000)]);
  if (!exited()) {
    try { process.kill(-server.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await Promise.race([once(server, 'exit'), wait(5000)]);
  }
  if (!exited()) throw new Error('workbench server did not exit after cleanup signals');
};
const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);
const plain = value => value === null || ['string', 'number', 'boolean'].includes(typeof value) ||
  (Array.isArray(value) && value.every(plain)) ||
  (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(plain));
const shadow = (page, selector) => page.evaluate(selector => {
  const element = document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`missing overlay ${selector}`);
  element.click();
}, selector);
const imageHash = page => page.evaluate(() => {
  const bytes = document.querySelector('#seeded-canvas').getContext('2d').getImageData(0, 0, 240, 120).data;
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(16);
});
const repeatedMatchesReports = (session, finding) => {
  const reports = session.windows.filter(window => window.canvasId === finding.canvasId && window.windowIndex >= session.episodes.find(episode => episode.episodeId === finding.episodeId).firstWindowIndex && window.windowIndex <= session.episodes.find(episode => episode.episodeId === finding.episodeId).lastWindowIndex);
  const repeated = reports.filter(window => window.signatureStatus === 'same' && window.rasterOperationCount >= 3);
  return finding.repeatedWindows.every(entry => repeated.some(window => window.windowIndex === entry.windowIndex && window.comparisonGap === entry.comparisonGap)) &&
    finding.rasterOperationCount === sum(finding.repeatedWindows, 'rasterOperationCount') &&
    Math.abs(finding.canvasApiSelfTimeMs - sum(finding.repeatedWindows, 'canvasApiSelfTimeMs')) < 0.01 &&
    finding.unknownCoverage.unknownWindowCount === reports.filter(window => window.signatureStatus === 'unknown').length &&
    finding.unknownCoverage.activeWindowCount === reports.length;
};
const runMode = async mode => {
  const page = await browser.newPage();
  page.on('pageerror', error => pageErrors.push(`${mode}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'warning') warnings.push(`${mode}: ${message.text()}`); });
  try {
    await page.goto(`${baseUrl}/v04-04-continuous.html?mode=${mode}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__CANVAS_SCAN__ && window.__CONTINUOUS_PROBE__);
    await page.waitForFunction(() => window.__CONTINUOUS_PROBE__.frameCount >= 6);
    await shadow(page, '.record');
    const recordingStartFrame = await page.evaluate(() => window.__CONTINUOUS_PROBE__.frameCount);
    await page.click('#interact');
    await page.waitForFunction(startFrame => window.__CONTINUOUS_PROBE__.frameCount >= startFrame + 6, recordingStartFrame);
    await shadow(page, '.stop-recording');
    const session = await page.evaluate(() => window.__CANVAS_SCAN__.getLastSession());
    const visibleHash = await imageHash(page);
    const facts = await page.evaluate(() => window.__CONTINUOUS_PROBE__);
    capturedModes[mode] = { facts, session, visibleHash, cardText: '', cardCanvasId: '', popoverOwner: '' };
    await shadow(page, '.counts');
    if (mode === 'bad') {
      try { await page.waitForFunction(() => document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector('.repeated-finding')); }
      catch (error) { throw new Error(`repeated finding did not appear: ${error instanceof Error ? error.message : String(error)}`); }
    }
    const cardText = await page.evaluate(() => document.querySelector('[data-canvas-scan]').shadowRoot.querySelector('.repeated-finding')?.textContent ?? '');
    const cardCanvasId = await page.evaluate(() => document.querySelector('[data-canvas-scan]').shadowRoot.querySelector('.repeated-finding')?.getAttribute('data-canvas-id') ?? '');
    capturedModes[mode] = { ...capturedModes[mode], cardText, cardCanvasId };
    if (mode === 'bad' && cardCanvasId) {
      await page.evaluate(id => [...document.querySelector('[data-canvas-scan]').shadowRoot.querySelectorAll('[data-action="locate-current"]')].find(element => element.dataset.canvasId === id)?.click(), cardCanvasId);
      await page.waitForFunction(id => document.querySelector('[data-canvas-scan]').shadowRoot.querySelector(`.outline[data-canvas-id="${id}"]`)?.classList.contains('locate'), cardCanvasId);
      await page.screenshot({ path: '/private/tmp/sidproj-49-overlay-finding-card.png' });
      await page.evaluate(id => [...document.querySelector('[data-canvas-scan]').shadowRoot.querySelectorAll('[data-action="inspect-current"]')].find(element => element.dataset.canvasId === id)?.click(), cardCanvasId);
      try { await page.waitForFunction(() => document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector('.popover-owner')?.textContent); }
      catch (error) { throw new Error(`finding details did not appear: ${error instanceof Error ? error.message : String(error)}`); }
    }
    capturedModes[mode].popoverOwner = await page.evaluate(() => document.querySelector('[data-canvas-scan]').shadowRoot.querySelector('.popover-owner')?.textContent ?? '');
    return capturedModes[mode];
  } finally { await page.close(); }
};
let bad; let fixed;
try {
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'exec', 'esbuild', 'src/auto.ts', '--bundle', '--format=iife', '--outfile=dist/canvas-scan.iife.js', '--minify'], { cwd: repoRoot, stdio: 'inherit' });
  await copyFile(sourceBundle, workbenchBundle);
  bundleHash = createHash('sha256').update(await readFile(workbenchBundle)).digest('hex');
  server = spawn('pnpm', ['--filter', 'workbench', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: repoRoot, stdio: 'inherit', detached: true });
  await waitForServer();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  browserVersion = browser.version();
  bad = await runMode('bad');
  fixed = await runMode('fixed');
} catch (error) { failures.push(error instanceof Error ? error.message : String(error));
} finally {
  try { await browser?.close(); } catch (error) { failures.push(String(error)); }
  try { await stopServer(); } catch (error) { failures.push(String(error)); }
}
bad ??= capturedModes.bad;
fixed ??= capturedModes.fixed;
const badFinding = bad?.session?.findings?.find(finding => finding.type === 'repeated-draw-work' && finding.canvasId === bad?.cardCanvasId);
const cardEvidence = badFinding && [
  `${badFinding.repeatedWindowCount} repeated frames`,
  `Repeated raster operations: ${badFinding.rasterOperationCount}`,
  `Canvas2D API self-time: ${badFinding.canvasApiSelfTimeMs} ms`,
  `Comparison gaps: ${badFinding.repeatedWindows.map(window => window.comparisonGap ?? 'none').join(', ')}`,
  `Unknown coverage: ${badFinding.unknownCoverage.unknownWindowCount} of ${badFinding.unknownCoverage.activeWindowCount} active frames`,
  badFinding.claimBoundary.nonEstablishedFacts,
  badFinding.nextCheck,
];
const checks = {
  jsonOnly: Boolean(bad?.session && fixed?.session && plain(bad.session) && plain(fixed.session)),
  sameDataAndInteraction: bad?.facts?.checksum === fixed?.facts?.checksum && bad?.facts?.interactions === fixed?.facts?.interactions,
  sameVisibleScene: bad?.visibleHash === fixed?.visibleHash,
  badHasSeededFinding: Boolean(badFinding?.repeatedWindowCount),
  repeatedEntriesTrustAndTotals: Boolean(badFinding && repeatedMatchesReports(bad.session, badFinding)),
  changedAndUnknownExcluded: Boolean(badFinding && badFinding.repeatedWindows.every(entry => bad.session.windows.find(window => window.windowIndex === entry.windowIndex && window.canvasId === badFinding.canvasId)?.signatureStatus === 'same')),
  wakeUpHasNoFinding: !bad?.session?.findings?.some(finding => finding.type === 'repeated-draw-work' && finding.canvasId.startsWith('wake-up-canvas#')) && !fixed?.session?.findings?.some(finding => finding.type === 'repeated-draw-work' && finding.canvasId.startsWith('wake-up-canvas#')),
  fixedHasNoSeededFinding: !fixed?.session?.findings?.some(finding => finding.type === 'repeated-draw-work' && finding.canvasId.startsWith('seeded-canvas#')),
  cardShowsSafeEvidence: Boolean(cardEvidence?.every(text => bad?.cardText.includes(text)) && /Repeated draw commands.*Review candidate/.test(bad?.cardText ?? '') && !/wasted|pixel-identical|avoidable/i.test(bad?.cardText ?? '')),
  cardOpensSeededCanvas: bad?.popoverOwner === bad?.cardCanvasId,
  noWarningsOrPageErrors: warnings.length === 0 && pageErrors.length === 0,
  instrumentationStayedEnabled: !warnings.some(warning => /disabled|kill/i.test(warning)),
  browserVersionCaptured: Boolean(browserVersion),
};
if (!Object.values(checks).every(Boolean)) failures.push(`failed checks: ${Object.entries(checks).filter(([, value]) => !value).map(([key]) => key).join(', ')}`);
await writeFile('/private/tmp/sidproj-49-bad-session.json', `${JSON.stringify(bad?.session ?? null, null, 2)}\n`);
await writeFile('/private/tmp/sidproj-49-fixed-session.json', `${JSON.stringify(fixed?.session ?? null, null, 2)}\n`);
await writeFile('/private/tmp/sidproj-49-overlay-finding-card.txt', `${bad?.cardText ?? ''}\n`);
const result = { probeVersion: 1, status: failures.length ? 'FAIL' : 'PASS', browserVersion, gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(), bundleHash, checks, warnings, pageErrors, failures, bad, fixed };
await writeFile('/private/tmp/sidproj-49-continuous-comparison.json', `${JSON.stringify(result, null, 2)}\n`);
if (result.status === 'PASS') console.log('CANVAS_CONTINUOUS_V04_04: PASS');
else console.error(`CANVAS_CONTINUOUS_V04_04: FAIL ${failures.join('; ')}`);
process.exitCode = result.status === 'PASS' ? 0 : 1;
