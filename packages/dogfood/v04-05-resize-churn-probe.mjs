import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const port = 5193;
const baseUrl = `http://127.0.0.1:${port}`;
const sourceBundle = path.join(repoRoot, 'packages/core/dist/canvas-scan.iife.js');
const workbenchBundle = path.join(repoRoot, 'apps/workbench/public/canvas-scan.iife.js');
let server;
let browser;
let browserVersion = null;
let bundleHash = null;
const failures = [];
const pageErrors = [];
const warnings = [];

const wait = timeout => new Promise(resolve => setTimeout(resolve, timeout));
const waitForServer = async () => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (server.exitCode != null || server.signalCode != null) {
      throw new Error(`workbench server exited with ${server.exitCode ?? server.signalCode}`);
    }
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
const countValues = values => values.reduce((counts, value) => {
  if (value !== null) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}, {});
const findingMatchesSession = (session, finding) => {
  const observed = session.resetEvents.filter(event => event.canvasId === finding.canvasId);
  const active = observed.filter(event => event.activeRasterOverlap);
  const reportedWindows = new Map(session.windows.filter(window => window.canvasId === finding.canvasId).map(window => [window.windowIndex, window]));
  const windows = [...new Map(active.map(event => [event.windowIndex, reportedWindows.get(event.windowIndex) ?? {
    rasterOperationCount: event.rasterOperationCount,
    canvasApiSelfTimeMs: 0,
    signatureStatus: event.commandStatus,
    unknownReason: event.unknownReason,
  }])).values()];
  const episodeIds = session.episodes.filter(episode => active.some(event => event.windowIndex >= episode.firstWindowIndex && event.windowIndex <= episode.lastWindowIndex)).map(episode => episode.episodeId);
  return finding.observedResetCount === observed.length &&
    finding.activeResetCount === active.length &&
    finding.resetEvents.length === active.length &&
    finding.rasterOperationCount === windows.reduce((total, window) => total + window.rasterOperationCount, 0) &&
    Math.abs(finding.canvasApiSelfTimeMs - windows.reduce((total, window) => total + window.canvasApiSelfTimeMs, 0)) < 0.01 &&
    JSON.stringify(finding.affectedEpisodeIds) === JSON.stringify(episodeIds) &&
    JSON.stringify(finding.commandStatuses) === JSON.stringify({
      same: windows.filter(window => window.signatureStatus === 'same').length,
      changed: windows.filter(window => window.signatureStatus === 'changed').length,
      unknown: windows.filter(window => window.signatureStatus === 'unknown').length,
    }) &&
    JSON.stringify(finding.unknownReasons) === JSON.stringify(countValues(windows.map(window => window.unknownReason)));
};
const runScenario = async (name, mode, action) => {
  const page = await browser.newPage();
  page.on('pageerror', error => pageErrors.push(`${name}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'warning') warnings.push(`${name}: ${message.text()}`); });
  try {
    await page.goto(`${baseUrl}/v04-05-resize-churn.html?mode=${mode}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__CANVAS_SCAN__ && window.__RESIZE_CHURN_PROBE__?.frameCount >= 4);
    const startFrame = await page.evaluate(() => window.__RESIZE_CHURN_PROBE__.frameCount);
    await shadow(page, '.record');
    await page.click(`#${action}`);
    if (action === 'interact') await page.waitForFunction(() => window.__RESIZE_CHURN_PROBE__.resizeCount >= 3);
    if (action === 'setup') await page.waitForFunction(frame => window.__RESIZE_CHURN_PROBE__.setupRuns === 1 && window.__RESIZE_CHURN_PROBE__.frameCount >= frame + 2, startFrame);
    if (action === 'outside') await page.waitForFunction(frame => window.__RESIZE_CHURN_PROBE__.outsideStage === 3 && window.__RESIZE_CHURN_PROBE__.frameCount >= frame + 4, startFrame);
    await shadow(page, '.stop-recording');
    const session = await page.evaluate(() => window.__CANVAS_SCAN__.getLastSession());
    const facts = await page.evaluate(() => window.__RESIZE_CHURN_PROBE__);
    const visibleHash = await imageHash(page);
    await shadow(page, '.counts');
    const finding = session.findings.find(item => item.type === 'resize-churn' && item.canvasId.startsWith('seeded-canvas#'));
    let cardText = '';
    let cardCanvasId = '';
    let popoverOwner = '';
    let located = false;
    if (finding) {
      await page.waitForFunction(canvasId => [...document.querySelector('[data-canvas-scan]').shadowRoot.querySelectorAll('.repeated-finding')].some(card => card.getAttribute('data-canvas-id') === canvasId && card.textContent.includes('Reset churn')), finding.canvasId);
      ({ cardText, cardCanvasId } = await page.evaluate(canvasId => {
        const card = [...document.querySelector('[data-canvas-scan]').shadowRoot.querySelectorAll('.repeated-finding')].find(item => item.getAttribute('data-canvas-id') === canvasId && item.textContent.includes('Reset churn'));
        return { cardText: card?.textContent ?? '', cardCanvasId: card?.getAttribute('data-canvas-id') ?? '' };
      }, finding.canvasId));
      await page.evaluate(canvasId => {
        const card = [...document.querySelector('[data-canvas-scan]').shadowRoot.querySelectorAll('.repeated-finding')].find(item => item.getAttribute('data-canvas-id') === canvasId && item.textContent.includes('Reset churn'));
        card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      }, finding.canvasId);
      await page.waitForFunction(canvasId => document.querySelector('[data-canvas-scan]').shadowRoot.querySelector(`.outline[data-canvas-id="${canvasId}"]`)?.classList.contains('locate'), finding.canvasId);
      located = true;
      if (name === 'bad') await page.screenshot({ path: '/private/tmp/sidproj-48-bad-card.png' });
      await page.evaluate(canvasId => {
        const card = [...document.querySelector('[data-canvas-scan]').shadowRoot.querySelectorAll('.repeated-finding')].find(item => item.getAttribute('data-canvas-id') === canvasId && item.textContent.includes('Reset churn'));
        card.click();
      }, finding.canvasId);
      await page.waitForFunction(() => document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector('.popover-owner')?.textContent);
      popoverOwner = await page.evaluate(() => document.querySelector('[data-canvas-scan]').shadowRoot.querySelector('.popover-owner')?.textContent ?? '');
    }
    return { session, facts, visibleHash, finding, cardText, cardCanvasId, located, popoverOwner };
  } finally {
    await page.close();
  }
};

let bad;
let fixed;
let setup;
let outside;
try {
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  await copyFile(sourceBundle, workbenchBundle);
  bundleHash = createHash('sha256').update(await readFile(workbenchBundle)).digest('hex');
  server = spawn('pnpm', ['--filter', 'workbench', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: repoRoot, detached: true, stdio: 'inherit' });
  await waitForServer();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  browserVersion = browser.version();
  bad = await runScenario('bad', 'bad', 'interact');
  fixed = await runScenario('fixed', 'fixed', 'interact');
  setup = await runScenario('setup', 'bad', 'setup');
  outside = await runScenario('outside', 'bad', 'outside');
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  try { await browser?.close(); } catch (error) { failures.push(String(error)); }
  try { await stopServer(); } catch (error) { failures.push(String(error)); }
}

const sources = new Set(bad?.session?.resetEvents.filter(event => event.canvasId === bad?.finding?.canvasId).map(event => event.source));
const setupEvents = setup?.session?.resetEvents.filter(event => event.canvasId.startsWith('seeded-canvas#')) ?? [];
const outsideEvents = outside?.session?.resetEvents.filter(event => event.canvasId.startsWith('outside-canvas#')) ?? [];
const cardEvidence = bad?.finding && [
  `${bad.finding.activeResetCount} active resets of ${bad.finding.observedResetCount} observed resets`,
  `Affected episodes: ${bad.finding.affectedEpisodeIds.join(', ')}`,
  `Command statuses: same ${bad.finding.commandStatuses.same}, changed ${bad.finding.commandStatuses.changed}, unknown ${bad.finding.commandStatuses.unknown}`,
  `Unknown reasons: ${Object.entries(bad.finding.unknownReasons).map(([reason, count]) => `${reason} ${count}`).join(', ')}`,
  bad.finding.claimBoundary.nonEstablishedFacts,
  bad.finding.nextCheck,
];
const checks = {
  jsonOnly: Boolean(bad && fixed && setup && outside && [bad, fixed, setup, outside].every(result => plain(result.session))),
  sameSceneAndInteraction: bad?.facts?.checksum === fixed?.facts?.checksum && bad?.facts?.interactions === fixed?.facts?.interactions,
  sameVisibleScene: bad?.visibleHash === fixed?.visibleHash,
  badHasOneSeededFinding: bad?.session?.findings.filter(item => item.type === 'resize-churn').length === 1 && Boolean(bad?.finding),
  exactSourcesAndDimensions: ['width-setter', 'height-setter', 'width-attribute', 'context-reset'].every(source => sources.has(source)) && bad?.session?.resetEvents.filter(event => event.canvasId === bad?.finding?.canvasId).every(event => event.width === 240 && event.height === 120),
  activeFlagsAndFindingTotals: Boolean(bad?.finding && bad.session.resetEvents.filter(event => event.canvasId === bad.finding.canvasId).every(event => event.activeRasterOverlap) && findingMatchesSession(bad.session, bad.finding)),
  fixedGuardsRemoveFinding: !fixed?.session?.findings.some(item => item.type === 'resize-churn') && fixed?.session?.resetEvents.filter(event => event.canvasId.startsWith('seeded-canvas#')).length === 0,
  oneSetupResetDoesNotFind: setupEvents.length === 1 && setupEvents[0].source === 'width-setter' && setupEvents[0].activeRasterOverlap && !setup?.session?.findings.some(item => item.type === 'resize-churn'),
  outsideResetsStayIdleEvidence: outsideEvents.length === 2 && outsideEvents.map(event => event.source).join(',') === 'width-setter,height-setter' && outsideEvents.every(event => !event.activeRasterOverlap && event.rasterOperationCount === 0) && !outside?.session?.findings.some(item => item.type === 'resize-churn'),
  cardShowsSafeEvidence: Boolean(cardEvidence?.every(text => bad?.cardText.includes(text)) && /Reset churn.*review candidate/.test(bad?.cardText ?? '') && !/caused|wasted|avoidable|render time|GPU time|pixel/i.test(bad?.cardText ?? '')),
  locateAndInspect: bad?.located && bad?.cardCanvasId === bad?.finding?.canvasId && bad?.popoverOwner === bad?.finding?.canvasId,
  noWarningsOrPageErrors: warnings.length === 0 && pageErrors.length === 0,
  browserVersionCaptured: Boolean(browserVersion),
  bundleHashCaptured: Boolean(bundleHash),
};
if (!Object.values(checks).every(Boolean)) {
  failures.push(`failed checks: ${Object.entries(checks).filter(([, value]) => !value).map(([key]) => key).join(', ')}`);
}
await writeFile('/private/tmp/sidproj-48-bad-session.json', `${JSON.stringify(bad?.session ?? null, null, 2)}\n`);
await writeFile('/private/tmp/sidproj-48-fixed-session.json', `${JSON.stringify(fixed?.session ?? null, null, 2)}\n`);
await writeFile('/private/tmp/sidproj-48-finding-card.txt', `${bad?.cardText ?? ''}\n`);
const result = {
  probeVersion: 2,
  status: failures.length ? 'FAIL' : 'PASS',
  browserVersion,
  gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
  bundleHash,
  checks,
  warnings,
  pageErrors,
  failures,
  bad,
  fixed,
  setup,
  outside,
};
await writeFile('/private/tmp/sidproj-48-comparison.json', `${JSON.stringify(result, null, 2)}\n`);
if (result.status === 'PASS') console.log('CANVAS_RESIZE_CHURN_V04_05: PASS');
else console.error(`CANVAS_RESIZE_CHURN_V04_05: FAIL ${failures.join('; ')}`);
process.exitCode = result.status === 'PASS' ? 0 : 1;
