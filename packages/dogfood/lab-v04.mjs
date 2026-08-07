import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { applyMutation, checkMatrixCoverage, checkNearestNegatives, checkScenarioResult, checkVariantInvariance, expectedMatrixRows } from './lab-v04-truth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baseUrl = 'http://127.0.0.1:5190';
const artifactPaths = ['/private/tmp/sidproj-55-canvas-lab-v0.4.json', '/private/tmp/sidproj-55-variant-matrix.json', '/private/tmp/sidproj-55-nearest-negatives.json', '/private/tmp/sidproj-55-console-summary.txt', '/private/tmp/sidproj-55-integrated-continuous.png', '/private/tmp/sidproj-55-integrated-burst.png', '/private/tmp/sidproj-55-mutation-output.txt', '/private/tmp/sidproj-55-sha256.txt'];
const normalPaths = artifactPaths.slice(0, 6);
const mutationPath = artifactPaths[6];
const hashPath = artifactPaths[7];
const wait = timeout => new Promise(resolve => setTimeout(resolve, timeout));

export function parseArgs(args) {
  if (args[0] === '--') args = args.slice(1);
  if (!args.length) return { mode: 'run' };
  if (args.length === 1 && args[0] === '--check-evidence') return { mode: 'check' };
  if (args.length === 1 && args[0] === '--mutation=heavy-burst-seed-off') return { mode: 'mutation', mutation: 'heavy-burst-seed-off' };
  throw new Error('unsupported lab arguments');
}
export const orderedRuns = () => expectedMatrixRows();
export const collectDiagnostics = (value = {}) => ({
  warnings: [...(value.warnings ?? [])], consoleErrors: [...(value.consoleErrors ?? [])], pageErrors: [...(value.pageErrors ?? [])],
  requestFailures: [...(value.requestFailures ?? [])], instrumentationKills: [...(value.instrumentationKills ?? [])], unsupportedEvidence: [...(value.unsupportedEvidence ?? [])],
});
export function evaluateCapture(manifest, capture = {}) {
  const diagnostics = collectDiagnostics(capture.diagnostics);
  const checked = checkScenarioResult(manifest, capture);
  const prohibited = Object.entries(diagnostics).filter(([name, values]) => name !== 'unsupportedEvidence' && values.length).map(([name]) => name);
  const unsupportedInvalid = diagnostics.unsupportedEvidence.some(item => manifest.scenario !== 'interaction-association' || !['event-timing', 'long-animation-frame'].includes(item.feature));
  const limits = capture.session?.droppedEntryCounts;
  const dropped = limits ? Object.entries(limits).filter(([, count]) => count !== 0).map(([name, count]) => `${name}:${count}`) : [];
  const failures = [...checked.failures, ...prohibited, ...dropped.map(item => `dropped evidence:${item}`)];
  if (manifest.scenario !== 'integrated-burst' && capture.acceptedRunCount !== 1) failures.push(`fixture accepted run count must equal 1 (received ${capture.acceptedRunCount ?? 0})`);
  if (unsupportedInvalid) failures.push('unapproved unsupported evidence');
  return { pass: failures.length === 0, failures, diagnostics, expectationResults: checked.expectationResults };
}
export function buildLabResult({ runId, startedAt, endedAt, scenarios = [], browser = {}, product = {}, gitSha = null, dirty = null, diagnostics = {} }) {
  const matrixCoverage = checkMatrixCoverage(scenarios.length ? scenarios : orderedRuns());
  const collected = collectDiagnostics(diagnostics);
  const prohibited = Object.entries(collected).some(([name, values]) => name !== 'unsupportedEvidence' && values.length);
  return { schemaVersion: 1, lab: 'canvas-performance-lab-v0.4', runId, startedAt, endedAt, gitSha, dirty, browser, product, scenarios, matrixCoverage, diagnostics: collected, pass: scenarios.length === 53 && scenarios.every(row => row.pass) && matrixCoverage.pass && !prohibited };
}
export const buildMatrixArtifact = (runId, rows) => ({ schemaVersion: 1, lab: 'canvas-performance-lab-v0.4', runId, rows: rows.map(row => ({ scenario: row.scenario, behavior: row.behavior, application: row.application, variant: row.variant, mode: row.mode, factors: row.factors, changedFactors: row.changedFactors, invariant: row.invariant, expectations: row.expectations, pass: row.pass })) });
export const buildNearestNegativeArtifact = (runId, rows) => ({ schemaVersion: 1, lab: 'canvas-performance-lab-v0.4', runId, rows: rows.filter(row => row.mode === 'negative').map(row => ({ scenario: row.scenario, boundary: row.boundary, observations: row.observations, supportingCanvas: row.supportingCanvas, findings: row.findings, associations: row.associations, pass: row.pass })) });
export function safeArtifactPath(value) { if (!artifactPaths.includes(value)) throw new Error('unexpected artifact path'); return value; }
export const hashEntries = async files => Promise.all([...files].sort().map(async file => `${createHash('sha256').update(await readFile(file)).digest('hex')}  ${file}`));

async function atomicWrite(file, value) {
  safeArtifactPath(file);
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, value);
  await rename(temporary, file);
}
export async function validateRegularFile(file, allowedPaths = artifactPaths) {
  if (!allowedPaths.includes(file)) throw new Error('unexpected artifact path');
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`unsafe artifact type: ${file}`);
  return stat;
}
async function removeOwned(file) {
  safeArtifactPath(file);
  try { await validateRegularFile(file); await unlink(file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const isIso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const rowKey = row => `${row.scenario}:${row.variant}:${row.mode}`;
const json = async file => JSON.parse(await readFile(file, 'utf8'));
function assert(condition, message) { if (!condition) throw new Error(message); }
function validPng(bytes) { return bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.readUInt32BE(16) === 1440 && bytes.readUInt32BE(20) === 1000; }
function sameDeclaredRow(actual, expected) {
  if (rowKey(actual) !== rowKey(expected)) return false;
  for (const key of ['behavior', 'application', 'factors', 'changedFactors', 'invariant']) if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) return false;
  if (actual.expectations?.length !== expected.expectations.length) return false;
  return expected.expectations.every((item, index) => Object.entries(item).every(([key, value]) => JSON.stringify(actual.expectations[index]?.[key]) === JSON.stringify(value)));
}
function validNegativeRows(rows) {
  const expected = ['heavy-burst', 'repeated-continuous', 'resize-churn', 'backing-store-mismatch', 'lifecycle-reactivation', 'interaction-association', 'non-react-burst'];
  if (rows.length !== expected.length || rows.some((row, index) => row.scenario !== expected[index] || !row.pass || !row.boundary || !row.observations || !row.supportingCanvas)) return false;
  const byScenario = Object.fromEntries(rows.map(row => [row.scenario, row]));
  for (const scenario of ['heavy-burst', 'non-react-burst']) {
    const value = byScenario[scenario].observations.maximumCanvasApiSelfTimeMs;
    const minimum = scenario === 'heavy-burst' ? 7 : 0;
    if (!(value >= minimum && value < 8) || value !== byScenario[scenario].supportingCanvas.canvasApiSelfTimeMs) return false;
  }
  if (byScenario['non-react-burst'].supportingCanvas.nearestReactOwner !== null || byScenario['non-react-burst'].supportingCanvas.attributionKind !== 'unattributed') return false;
  const repeated = byScenario['repeated-continuous'].observations.sameWindowRasterOperationCounts;
  if (!Array.isArray(repeated) || repeated.length === 0 || Math.max(...repeated) !== 1) return false;
  const resize = byScenario['resize-churn'].observations;
  if (resize.activeResetCount !== 2 || resize.activeResetWindowCount !== 1 || resize.measuredWorkCount !== 1 || resize.retiredCount !== 1) return false;
  const backing = byScenario['backing-store-mismatch'].observations;
  if (backing.affectedWindowCount !== 1 || !backing.activeWindowAreaRatios.some(value => value < 2) || !backing.activeWindowAreaRatios.some(value => value >= 2)) return false;
  const lifecycle = byScenario['lifecycle-reactivation'].observations;
  if (lifecycle.inactiveBoundaries !== 119 || lifecycle.retiredCount !== 0) return false;
  const association = byScenario['interaction-association'].observations;
  return association.gapMs > 0 && association.associationCount === 0;
}

export function validateEvidencePayload({ primary, matrix, negatives, summary, continuousPng, burstPng, now = Date.now() }) {
  assert(primary.schemaVersion === 1 && primary.lab === 'canvas-performance-lab-v0.4' && primary.pass === true, 'invalid primary evidence');
  assert(isIso(primary.startedAt) && isIso(primary.endedAt) && Date.parse(primary.startedAt) <= Date.parse(primary.endedAt), 'invalid evidence timestamps');
  assert(now - Date.parse(primary.endedAt) < 24 * 60 * 60 * 1000 && Date.parse(primary.endedAt) <= now + 60_000, 'stale evidence');
  assert(primary.browser?.name === 'Chrome' && typeof primary.browser.version === 'string' && primary.browser.version.length > 0 && primary.browser.version !== 'unknown' && primary.browser.channel === 'chrome' && primary.browser.headless === true, 'missing Chrome version');
  assert(primary.product?.name === 'canvas-scan' && typeof primary.product.version === 'string' && primary.product.version.length > 0 && /^[0-9a-f]{64}$/.test(primary.product.bundleSha256), 'missing product version or bundle hash');
  assert(matrix.schemaVersion === 1 && matrix.lab === primary.lab && matrix.runId === primary.runId, 'invalid matrix schema or run ID');
  assert(negatives.schemaVersion === 1 && negatives.lab === primary.lab && negatives.runId === primary.runId, 'invalid negative schema or run ID');
  const expectedRows = orderedRuns(); const expectedKeys = expectedRows.map(rowKey);
  assert(primary.scenarios?.length === 53 && matrix.rows?.length === 53 && negatives.rows?.length === 7, 'invalid evidence row count');
  assert(JSON.stringify(primary.scenarios.map(rowKey)) === JSON.stringify(expectedKeys) && JSON.stringify(matrix.rows.map(rowKey)) === JSON.stringify(expectedKeys), 'invalid evidence row order');
  assert(primary.scenarios.every((row, index) => sameDeclaredRow(row, expectedRows[index])) && matrix.rows.every((row, index) => sameDeclaredRow(row, expectedRows[index])), 'invalid evidence row declaration');
  assert(primary.scenarios.every(row => row.pass === true && row.expectations?.every(item => item.pass === true)) && matrix.rows.every(row => row.pass === true) && negatives.rows.every(row => row.pass === true), 'failed scenario in evidence');
  assert(checkMatrixCoverage(matrix.rows).pass && checkNearestNegatives(matrix.rows).pass && checkVariantInvariance(matrix.rows).pass, 'invalid matrix evidence');
  assert(validNegativeRows(primary.scenarios.filter(row => row.mode === 'negative')) && validNegativeRows(negatives.rows), 'invalid nearest-negative observations');
  assert(validPng(continuousPng) && validPng(burstPng), 'invalid screenshot dimensions');
  assert(summary.includes(`runId=${primary.runId}`) && expectedKeys.every(key => summary.includes(`${key}: PASS`)) && normalPaths.every(file => summary.includes(file)), 'invalid console summary');
  return true;
}
export function validateManifestEntries(listed, actual) { assert(JSON.stringify(listed) === JSON.stringify(actual), 'artifact hash mismatch'); return true; }
export function validateMutationPayload(mutation, primary, now = Date.now()) {
  assert(JSON.stringify(Object.keys(mutation).sort()) === JSON.stringify(['endedAt', 'missing', 'mutationRunId', 'parentRunId', 'startedAt']), 'invalid mutation fields');
  assert(mutation.parentRunId === primary.runId && mutation.mutationRunId && mutation.mutationRunId !== primary.runId, 'mutation run link mismatch');
  assert(isIso(mutation.startedAt) && isIso(mutation.endedAt) && mutation.missing === 'heavy-canvas-work', 'invalid mutation evidence');
  const started = Date.parse(mutation.startedAt); const ended = Date.parse(mutation.endedAt);
  assert(started <= ended && started >= Date.parse(primary.endedAt), 'invalid mutation timestamp order');
  assert(now - ended < 24 * 60 * 60 * 1000 && ended <= now + 60_000, 'stale mutation evidence');
  return true;
}

export async function validateEvidence() {
  for (const file of [...normalPaths, hashPath]) await validateRegularFile(file);
  let mutationExists = false;
  try { await validateRegularFile(mutationPath); mutationExists = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const [primary, matrix, negatives, summary, continuousPng, burstPng] = await Promise.all([json(normalPaths[0]), json(normalPaths[1]), json(normalPaths[2]), readFile(normalPaths[3], 'utf8'), readFile(normalPaths[4]), readFile(normalPaths[5])]);
  validateEvidencePayload({ primary, matrix, negatives, summary, continuousPng, burstPng });
  const expectedFiles = mutationExists ? artifactPaths.slice(0, 7) : normalPaths;
  const listed = (await readFile(hashPath, 'utf8')).trim().split('\n');
  validateManifestEntries(listed, await hashEntries(expectedFiles));
  let mutation;
  if (mutationExists) {
    const text = await readFile(mutationPath, 'utf8');
    mutation = Object.fromEntries(text.trim().split('\n').map(line => line.split('=', 2)));
    validateMutationPayload(mutation, primary);
  }
  return { primary, matrix, negatives, mutationExists, mutation };
}

function listeners() {
  try {
    const text = execFileSync('/usr/sbin/lsof', ['-nP', '-iTCP@127.0.0.1:5190', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim();
    return text ? [...new Set(text.split('\n').map(Number))] : [];
  } catch (error) { if (error.status === 1) return []; throw error; }
}
function processGroup(pid) { return Number(execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim()); }
function exited(server) { return server.exitCode !== null || server.signalCode !== null; }
async function waitForExit(server, timeout) { if (exited(server)) return true; await Promise.race([once(server, 'exit'), wait(timeout)]); return exited(server); }
export async function stopOwnedServer(server, isOwned) {
  if (!server?.pid || !isOwned(server.pid)) return { stopped: false, forced: false };
  try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (await waitForExit(server, 5000)) return { stopped: true, forced: false };
  if (!isOwned(server.pid)) throw new Error('Vite ownership changed before forced cleanup');
  try { process.kill(-server.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (!(await waitForExit(server, 5000))) throw new Error('Vite did not exit after cleanup signals');
  return { stopped: true, forced: true };
}
function ownedServer(pid) { try { return processGroup(pid) === pid; } catch { return false; } }
function listenerOwnership(pid) { const found = listeners(); return found.length > 0 && found.every(listener => processGroup(listener) === pid); }
async function waitForVite(server) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exited(server)) throw new Error(`Vite exited before ready: ${server.exitCode ?? server.signalCode}`);
    if (listenerOwnership(server.pid)) {
      const response = await fetch(`${baseUrl}/v04-lab.html`).catch(() => null);
      if (response?.ok && listenerOwnership(server.pid)) return;
    }
    await wait(250);
  }
  throw new Error('Vite did not become ready');
}
function startVite() { return spawn('pnpm', ['--filter', 'workbench', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5190', '--strictPort'], { cwd: root, detached: true, stdio: 'inherit' }); }
async function triggerKnown(page, source) {
  await page.evaluate(eventSource => {
    setTimeout(() => {
      const trigger = document.querySelector('#lab-trigger');
      if (eventSource === 'keyboard') trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      else if (eventSource === 'wheel') trigger.dispatchEvent(new WheelEvent('wheel', { deltaY: 12, bubbles: true }));
      else trigger.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerType: 'mouse', bubbles: true }));
    }, 0);
  }, source);
}
async function checkPointerClick(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/v04-lab.html?scenario=heavy-burst&variant=variant-a&mode=bad`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__CANVAS_LAB_FIXTURE__?.ready, undefined, { timeout: 10_000 });
    await page.locator('#lab-trigger').click();
    await page.waitForFunction(() => window.__CANVAS_LAB_FIXTURE__?.snapshot().interactionComplete === true, undefined, { timeout: 30_000 });
    const fixture = await page.evaluate(() => window.__CANVAS_LAB_FIXTURE__.snapshot());
    assert(fixture.acceptedRunCount === 1, `pointer click accepted run count must equal 1 (received ${fixture.acceptedRunCount})`);
  } finally { await context.close(); }
}
function supportingCanvas(session, manifest) {
  const findingTypes = new Set(manifest.expectations.filter(item => item.kind === 'finding').map(item => item.findingType));
  const finding = session.findings.find(item => findingTypes.has(item.type));
  if (finding) return session.canvases.find(canvas => canvas.canvasId === finding.canvasId) ?? null;
  if (manifest.scenario === 'lifecycle-reactivation') {
    const event = session.lifecycleEvents.find(item => item.type === 'retired');
    return session.canvases.find(canvas => canvas.canvasId === event?.canvasId) ?? session.canvases[0] ?? null;
  }
  if (manifest.scenario === 'interaction-association') {
    const association = session.episodeAssociations.find(item => item.entryKind === 'long-animation-frame') ?? session.episodeAssociations[0];
    const episode = session.episodes.find(item => item.episodeId === association?.episodeId);
    const canvasId = episode?.canvases.slice().sort((left, right) => right.canvasApiSelfTimeMs - left.canvasApiSelfTimeMs)[0]?.canvasId;
    return session.canvases.find(canvas => canvas.canvasId === canvasId) ?? session.canvases[0] ?? null;
  }
  return session.canvases[0] ?? null;
}
function negativeEvidence(session, manifest, fixture) {
  if (manifest.mode !== 'negative') return {};
  if (manifest.scenario === 'heavy-burst' || manifest.scenario === 'non-react-burst') return {
    boundary: { metric: 'canvasApiSelfTimeMs', threshold: 8, comparison: 'below' },
    observations: { maximumCanvasApiSelfTimeMs: Math.max(...session.canvases.map(canvas => canvas.canvasApiSelfTimeMs)) },
  };
  if (manifest.scenario === 'repeated-continuous') return {
    boundary: { metric: 'sameWindowRasterOperationCount', threshold: 2, comparison: 'one-below' },
    observations: { sameWindowRasterOperationCounts: session.windows.filter(window => window.signatureStatus === 'same').map(window => window.rasterOperationCount).sort((left, right) => left - right) },
  };
  if (manifest.scenario === 'resize-churn') return {
    boundary: { metric: 'activeResetWindowCount', threshold: 2, comparison: 'one-below' },
    observations: (() => {
      const active = session.resetEvents.filter(event => event.activeRasterOverlap);
      const canvasId = active[0]?.canvasId;
      return { activeResetCount: active.length, activeResetWindowCount: new Set(active.map(event => event.windowIndex)).size, observedResetCount: session.resetEvents.length, measuredWorkCount: session.windows.filter(window => window.canvasId === canvasId && window.rasterOperationCount > 0).length, retiredCount: session.lifecycleEvents.filter(event => event.canvasId === canvasId && event.type === 'retired').length };
    })(),
  };
  if (manifest.scenario === 'backing-store-mismatch') {
    const ratios = session.windows.filter(window => window.rasterOperationCount > 0).map(window => window.geometry.actualToExpectedAreaRatio).filter(value => typeof value === 'number').sort((left, right) => right - left);
    return { boundary: { metric: 'affectedWindowCount', windowThreshold: 2, areaRatioThreshold: 2, comparison: 'one-below' }, observations: { activeWindowAreaRatios: ratios, affectedWindowCount: ratios.filter(value => value >= 2).length } };
  }
  if (manifest.scenario === 'lifecycle-reactivation') return {
    boundary: { metric: 'inactiveBoundaries', threshold: 120, comparison: 'one-below' },
    observations: { inactiveBoundaries: fixture.boundaryCount, retiredCount: session.lifecycleEvents.filter(event => event.type === 'retired' && event.canvasId === session.canvases[0]?.canvasId).length },
  };
  const eventType = manifest.factors.eventSource === 'keyboard' ? 'keydown' : manifest.factors.eventSource === 'wheel' ? 'wheel' : 'pointerdown';
  const event = session.browserEntries.find(entry => entry.kind === 'document-event' && entry.eventType === eventType);
  const episode = session.episodes.slice().sort((left, right) => left.startedAtTimestampMs - right.startedAtTimestampMs)[0];
  return {
    boundary: { metric: 'monotonicRangeOverlap', comparison: 'event-before-episode' },
    observations: { eventEndedAtTimestampMs: event?.endedAtTimestampMs ?? null, episodeStartedAtTimestampMs: episode?.startedAtTimestampMs ?? null, gapMs: event && episode ? episode.startedAtTimestampMs - event.endedAtTimestampMs : null, associationCount: session.episodeAssociations.filter(item => item.entryId === event?.entryId).length },
  };
}
async function showFindings(page) {
  await page.evaluate(() => {
    const root = document.querySelector('[data-canvas-scan]')?.shadowRoot;
    const counts = root?.querySelector('.counts');
    if (counts instanceof HTMLButtonElement && counts.getAttribute('aria-expanded') !== 'true') counts.click();
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function captureRow(browser, browserVersion, manifest, screenshot) {
  const diagnostics = collectDiagnostics();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: manifest.factors.devicePixelRatio });
  const page = await context.newPage();
  page.on('console', message => {
    const text = message.text();
    if (message.type() === 'warning') diagnostics.warnings.push(text);
    if (message.type() === 'error') diagnostics.consoleErrors.push(text);
    if (/instrumentation.*(?:disabled|kill)|(?:disabled|kill).*instrumentation/i.test(text)) diagnostics.instrumentationKills.push(text);
  });
  page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', request => diagnostics.requestFailures.push(`${request.method()} ${request.url()}`));
  try {
    const query = new URLSearchParams({ scenario: manifest.scenario, variant: manifest.variant, mode: manifest.mode });
    if (manifest.mutation) query.set('mutation', manifest.mutation);
    await page.goto(`${baseUrl}/v04-lab.html?${query}`, { waitUntil: 'load' });
    try { await page.waitForFunction(() => window.__CANVAS_SCAN__ && window.__CANVAS_LAB_FIXTURE__?.ready, undefined, { timeout: 10_000 }); }
    catch (error) { throw new Error(`fixture readiness failed: ${error.message}; diagnostics=${JSON.stringify(diagnostics)}`); }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => window.__CANVAS_SCAN__.startRecording());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const idle = await page.evaluate(() => window.__CANVAS_LAB_FIXTURE__.snapshot());
    if (manifest.scenario === 'integrated-burst') {
      for (const [index, action] of ['Load', 'Zoom', 'Pan', 'Hover', 'Search', 'Filter', 'Resize'].entries()) {
        await page.evaluate(label => { setTimeout(() => document.querySelector(`[data-burst-action="${label}"]`).click(), 0); }, action);
        await page.waitForFunction(count => window.__CANVAS_LAB_FIXTURE__.snapshot().actions.length === count, index + 1);
      }
    } else {
      await triggerKnown(page, manifest.factors.eventSource);
      await page.waitForFunction(() => window.__CANVAS_LAB_FIXTURE__.snapshot().interactionStartedAt !== null, undefined, { timeout: 2000 });
    }
    const session = await page.evaluate(async () => {
      await Promise.race([
        window.__CANVAS_LAB_FIXTURE__.completed,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`fixture timeout phase=${window.__CANVAS_LAB_FIXTURE__.snapshot().phase}`)), 30_000)),
      ]);
      return window.__CANVAS_SCAN__.stopRecording();
    });
    const fixture = await page.evaluate(() => window.__CANVAS_LAB_FIXTURE__.snapshot(true));
    if (manifest.scenario === 'interaction-association' && manifest.mode === 'bad' && session.browserFeatures.longAnimationFrames === false) diagnostics.unsupportedEvidence.push({ feature: 'long-animation-frame', browserVersion, reason: 'Chrome did not expose Long Animation Frame entries', expectation: manifest.expectations[0].id });
    const evaluated = evaluateCapture(manifest, { session, idleDrawCount: idle.drawCount, interactionStartedAt: fixture.interactionStartedAt, fixtureBoundaryCount: fixture.boundaryCount, acceptedRunCount: fixture.acceptedRunCount, diagnostics });
    if (screenshot) { await showFindings(page); await page.screenshot({ path: screenshot }); }
    const negative = negativeEvidence(session, manifest, fixture);
    return {
      ...manifest, expectations: evaluated.expectationResults, findings: session.findings,
      supportingCanvas: supportingCanvas(session, manifest), limits: { collectionLimits: session.collectionLimits, droppedEntryCounts: session.droppedEntryCounts },
      diagnostics: evaluated.diagnostics, pass: evaluated.pass, failures: evaluated.failures, associations: session.episodeAssociations,
      visibleChecksum: fixture.visibleChecksum, visibleImageHash: fixture.visibleImageHash, actions: fixture.actions, drawCount: fixture.drawCount,
      ...negative,
    };
  } finally { await context.close(); }
}
function applyPairChecks(rows) {
  for (const bad of rows.filter(row => row.mode === 'bad' && row.variant !== 'integrated' || row.mode === 'bad' && row.variant === 'integrated')) {
    const fixed = rows.find(row => row.scenario === bad.scenario && row.variant === bad.variant && row.mode === 'fixed');
    if (!fixed) continue;
    const same = bad.visibleChecksum === fixed.visibleChecksum && bad.visibleImageHash === fixed.visibleImageHash && JSON.stringify(bad.actions) === JSON.stringify(fixed.actions);
    if (!same) for (const row of [bad, fixed]) { row.pass = false; row.failures.push('bad/fixed visible result or interaction mismatch'); }
  }
}
function aggregateDiagnostics(rows) {
  const result = collectDiagnostics();
  for (const row of rows) for (const key of Object.keys(result)) for (const item of row.diagnostics[key]) result[key].push({ row: rowKey(row), value: item });
  return result;
}
function summaryText(runId, startedAt, endedAt, rows, diagnostics) {
  const lines = [`runId=${runId}`, `startedAt=${startedAt}`, `endedAt=${endedAt}`];
  for (const row of rows) lines.push(`${rowKey(row)}: ${row.pass ? 'PASS' : `FAIL ${row.failures.join('; ')}`}`);
  for (const [name, values] of Object.entries(diagnostics)) lines.push(`${name}=${JSON.stringify(values)}`);
  lines.push(...normalPaths);
  return `${lines.join('\n')}\n`;
}
async function launchLab(operation) {
  if (listeners().length) throw new Error('port 5190 already has a listener');
  const server = startVite();
  let browser; let browserDisconnected = false; let closingBrowser = false; let operationError; let value; let cleanupError;
  try {
    await waitForVite(server);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    browser.on('disconnected', () => { if (!closingBrowser) browserDisconnected = true; });
    value = await operation(browser, browser.version());
  } catch (error) { operationError = error; }
  try { closingBrowser = true; await browser?.close(); } catch (error) { cleanupError = error; }
  try {
    const stopped = await stopOwnedServer(server, ownedServer);
    if (stopped.forced) cleanupError = cleanupError ?? new Error('Vite required forced cleanup');
  } catch (error) { cleanupError = cleanupError ?? error; }
  if (listeners().length) cleanupError = cleanupError ?? new Error('Vite cleanup left a listener');
  if (browserDisconnected && !operationError) operationError = new Error('browser disconnected before capture completed');
  if (operationError) { if (cleanupError) operationError.message += `; cleanup: ${cleanupError.message}`; throw operationError; }
  if (cleanupError) throw cleanupError;
  return value;
}

async function run() {
  for (const file of artifactPaths) await removeOwned(file);
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'run', 'build'], { cwd: root, stdio: 'inherit' });
  const bundleSource = path.join(root, 'packages/core/dist/canvas-scan.iife.js');
  const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');
  await copyFile(bundleSource, bundleTarget);
  const runId = randomUUID(); const startedAt = new Date().toISOString();
  const captured = await launchLab(async (browser, browserVersion) => {
    await checkPointerClick(browser);
    const rows = [];
    for (const manifest of orderedRuns()) {
      const screenshot = manifest.scenario === 'integrated-continuous' && manifest.mode === 'bad' ? normalPaths[4] : manifest.scenario === 'integrated-burst' && manifest.mode === 'bad' ? normalPaths[5] : undefined;
      try { rows.push(await captureRow(browser, browserVersion, manifest, screenshot)); }
      catch (error) { throw new Error(`${rowKey(manifest)}: ${error.message}`); }
    }
    return { rows, browserVersion };
  });
  applyPairChecks(captured.rows);
  const endedAt = new Date().toISOString();
  const diagnostics = aggregateDiagnostics(captured.rows);
  const productPackage = JSON.parse(await readFile(path.join(root, 'packages/core/package.json'), 'utf8'));
  const result = buildLabResult({
    runId, startedAt, endedAt, scenarios: captured.rows,
    browser: { name: 'Chrome', version: captured.browserVersion, channel: 'chrome', headless: true },
    product: { name: productPackage.name, version: productPackage.version, bundleSha256: createHash('sha256').update(await readFile(bundleTarget)).digest('hex') },
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()), diagnostics,
  });
  await atomicWrite(normalPaths[0], `${JSON.stringify(result, null, 2)}\n`);
  await atomicWrite(normalPaths[1], `${JSON.stringify(buildMatrixArtifact(runId, captured.rows), null, 2)}\n`);
  await atomicWrite(normalPaths[2], `${JSON.stringify(buildNearestNegativeArtifact(runId, captured.rows), null, 2)}\n`);
  const summary = summaryText(runId, startedAt, endedAt, captured.rows, diagnostics);
  await atomicWrite(normalPaths[3], summary);
  await atomicWrite(hashPath, `${(await hashEntries(normalPaths)).join('\n')}\n`);
  process.stdout.write(summary);
  if (!result.pass) throw new Error(captured.rows.filter(row => !row.pass).map(row => `${rowKey(row)}: ${row.failures.join('; ')}`).join(' | '));
  console.log('CANVAS_LAB_V04: PASS');
}
async function mutation() {
  const { primary } = await validateEvidence();
  const manifest = applyMutation(orderedRuns(), 'heavy-burst-seed-off').find(row => row.mutation);
  const startedAt = new Date().toISOString(); const mutationRunId = randomUUID();
  const captured = await launchLab((browser, browserVersion) => captureRow(browser, browserVersion, manifest));
  const missing = captured.failures.filter(failure => failure.includes('missing finding'));
  if (captured.pass || captured.failures.length !== 1 || missing.length !== 1 || !missing[0].includes('heavy-canvas-work')) throw new Error(`mutation failed outside its contract: ${captured.failures.join('; ')}`);
  const endedAt = new Date().toISOString();
  await removeOwned(mutationPath); await removeOwned(hashPath);
  await atomicWrite(mutationPath, `mutationRunId=${mutationRunId}\nparentRunId=${primary.runId}\nstartedAt=${startedAt}\nendedAt=${endedAt}\nmissing=heavy-canvas-work\n`);
  await atomicWrite(hashPath, `${(await hashEntries(artifactPaths.slice(0, 7))).join('\n')}\n`);
  console.log('CANVAS_LAB_V04_MUTATION: EXPECTED FAIL missing heavy-canvas-work');
  process.exitCode = 1;
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'check') {
    await validateEvidence();
    console.log('CANVAS_LAB_V04_NEAREST_NEGATIVES: PASS');
    console.log('CANVAS_LAB_V04_VARIANTS: PASS');
    console.log('CANVAS_LAB_V04_MANIFEST: PASS');
  } else if (args.mode === 'mutation') await mutation();
  else await run();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`CANVAS_LAB_V04: FAIL ${error.message}`); process.exitCode = 1; });
