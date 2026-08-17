import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { RITUAL_METHODS } from '../../scripts/pack-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultDirectory = '/private/tmp/sidproj-105-readiness-v05';
const port = 5211;
const origin = `http://127.0.0.1:${port}`;
export const ACTION_IDS = ['early-load', 'record-baseline', 'explain-baseline', 'copy-explanation', 'keep-baseline', 'apply-change', 'record-candidate', 'pair-findings', 'copy-comparison'];
const diagnosticKeys = ['warnings', 'errors', 'pageErrors', 'requestFailures'];
const demoTruth = {
  baseline: { activeWindowCount: 8, rasterOperationCount: 40, clearRects: 8, fillRects: 32, fillStyles: 8, repeatedWindowCount: 7, repeatedRasterOperationCount: 35, rasterOperationsPerRepeatedWindow: 5 },
  candidate: { activeWindowCount: 8, rasterOperationCount: 24, clearRects: 8, fillRects: 16, fillStyles: 8, repeatedWindowCount: 7, repeatedRasterOperationCount: 21, rasterOperationsPerRepeatedWindow: 3 },
};
const comparisonMeasureIds = [
  'active-window-count', 'raster-operation-count', 'canvas-api-self-time-ms', 'maximum-window-self-time-ms',
  'method:clearRect:operation-count', 'method:clearRect:self-time-ms',
  'method:fillRect:operation-count', 'method:fillRect:self-time-ms',
  'method:fillStyle:operation-count', 'method:fillStyle:self-time-ms',
  'unknown-command-window-count', 'repeated-window-count', 'repeated-raster-operation-count', 'comparison-gap-count',
];
const hash = value => createHash('sha256').update(value).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const text = value => typeof value === 'string' && value.length > 0;
const stable = value => `${JSON.stringify(value, null, 2)}\n`;

export function readinessStatus(failures, diagnostics, conditions = []) {
  return failures.length || diagnosticKeys.some(key => diagnostics[key].length) || conditions.some(condition => !condition) ? 'FAIL' : 'PASS';
}

function measure(id, unit, baseline, candidate) {
  const delta = baseline === null || candidate === null ? null : unit === 'ms' || unit === 'ratio' ? Math.round((candidate - baseline) * 1000) / 1000 : candidate - baseline;
  return { id, unit, baseline, candidate, delta, direction: delta === null ? 'unknown' : delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'unchanged', interpretation: unit === 'ms' ? 'observed-timing-pair' : 'structural' };
}

function selectedRepeated(session, findingIndex) {
  const finding = session?.findings?.[findingIndex];
  const canvases = session?.canvases?.filter(canvas => canvas.canvasId === finding?.canvasId) ?? [];
  if (finding?.type !== 'repeated-draw-work' || canvases.length !== 1) throw new Error('readiness selected repeated finding changed');
  return { finding, canvas: canvases[0] };
}

function validateDemoSession(session, findingIndex, mode) {
  const selected = selectedRepeated(session, findingIndex);
  const expected = demoTruth[mode];
  const methods = selected.canvas.methodEvidence;
  if (selected.canvas.activeWindowCount !== expected.activeWindowCount || selected.canvas.rasterOperationCount !== expected.rasterOperationCount || !Number.isFinite(selected.canvas.canvasApiSelfTimeMs) || selected.canvas.canvasApiSelfTimeMs < 0 || !Number.isFinite(selected.canvas.maxWindowSelfTimeMs) || selected.canvas.maxWindowSelfTimeMs < 0) throw new Error(`${mode} demo canvas truth changed`);
  if (!exact(methods, ['clearRect', 'fillRect', 'fillStyle']) || methods.clearRect.count !== expected.clearRects || methods.fillRect.count !== expected.fillRects || methods.fillStyle.count !== expected.fillStyles || !Number.isFinite(methods.clearRect.canvasApiSelfTimeMs) || !Number.isFinite(methods.fillRect.canvasApiSelfTimeMs) || methods.fillStyle.canvasApiSelfTimeMs !== null) throw new Error(`${mode} demo method truth changed`);
  if (selected.finding.repeatedWindowCount !== expected.repeatedWindowCount || selected.finding.rasterOperationCount !== expected.repeatedRasterOperationCount || !exact(selected.finding.unknownCoverage, ['unknownWindowCount', 'activeWindowCount']) || selected.finding.unknownCoverage.unknownWindowCount !== 1 || selected.finding.unknownCoverage.activeWindowCount !== expected.activeWindowCount) throw new Error(`${mode} repeated finding truth changed`);
  if (!Array.isArray(selected.finding.repeatedWindows) || selected.finding.repeatedWindows.length !== expected.repeatedWindowCount || selected.finding.repeatedWindows.some(window => window.rasterOperationCount !== expected.rasterOperationsPerRepeatedWindow || window.comparisonGap !== 1)) throw new Error(`${mode} repeated window truth changed`);
  return selected;
}

function validateDemoCommandWindow(window) {
  const expected = [
    ['call', 'clearRect', 4], ['set', 'fillStyle', 1],
    ['call', 'fillRect', 4], ['call', 'fillRect', 4], ['call', 'fillRect', 4], ['call', 'fillRect', 4],
  ];
  if (!window || window.complete !== true || window.unknownReason !== null || !Array.isArray(window.commands) || window.commands.length !== expected.length) return false;
  return window.commands.every((command, index) => command.ordinal === index && command.operationKind === expected[index][0] && command.name === expected[index][1] && command.argumentCount === expected[index][2] && Array.isArray(command.arguments) && command.arguments.length === expected[index][2] && command.unknownReason === null);
}

function validateComparisonMeasures(measures) {
  if (!Array.isArray(measures) || JSON.stringify(measures.map(item => item.id)) !== JSON.stringify(comparisonMeasureIds)) throw new Error('copied comparison measure IDs changed');
  const structural = new Map([
    ['active-window-count', [8, 8]], ['raster-operation-count', [40, 24]],
    ['method:clearRect:operation-count', [8, 8]], ['method:fillRect:operation-count', [32, 16]], ['method:fillStyle:operation-count', [8, 8]],
    ['unknown-command-window-count', [1, 1]], ['repeated-window-count', [7, 7]], ['repeated-raster-operation-count', [35, 21]], ['comparison-gap-count', [0, 0]],
  ]);
  for (const item of measures) {
    if (!exact(item, ['id', 'unit', 'baseline', 'candidate', 'delta', 'direction', 'interpretation'])) throw new Error('copied comparison measure shape changed');
    const expected = structural.get(item.id);
    if (expected) {
      if (JSON.stringify(item) !== JSON.stringify(measure(item.id, 'count', expected[0], expected[1]))) throw new Error(`copied comparison ${item.id} truth changed`);
      continue;
    }
    const setterTiming = item.id === 'method:fillStyle:self-time-ms';
    if (item.unit !== 'ms' || item.interpretation !== 'observed-timing-pair' || (setterTiming ? item.baseline !== null || item.candidate !== null : !Number.isFinite(item.baseline) || item.baseline < 0 || !Number.isFinite(item.candidate) || item.candidate < 0) || JSON.stringify(item) !== JSON.stringify(measure(item.id, 'ms', item.baseline, item.candidate))) throw new Error(`copied comparison ${item.id} timing changed`);
  }
}

export function validateCopiedExplanation(artifact, selection) {
  const keys = ['schemaVersion', 'explanationId', 'startedAt', 'endedAt', 'durationMs', 'stopReason', 'canvasScanVersion', 'source', 'followUp', 'windows', 'comparisons', 'firstDifference', 'stacks', 'collectionLimits', 'droppedEntryCounts', 'limitResults', 'callsiteCoverage', 'firstGap'];
  if (!exact(artifact, keys) || artifact.schemaVersion !== 1 || artifact.canvasScanVersion !== '0.5.0' || !text(artifact.explanationId) || artifact.stopReason !== 'manual') throw new Error('copied explanation root changed');
  if (!exact(artifact.source, ['sessionId', 'findingIndex', 'findingType', 'canvasId']) || artifact.source.sessionId !== selection.sessionId || artifact.source.findingIndex !== selection.findingIndex || artifact.source.findingType !== selection.findingType || !text(artifact.source.canvasId)) throw new Error('copied explanation selection changed');
  if (!exact(artifact.followUp, ['sessionId', 'canvasId']) || !text(artifact.followUp.sessionId) || artifact.followUp.sessionId === artifact.source.sessionId || artifact.followUp.canvasId !== artifact.source.canvasId) throw new Error('copied explanation follow-up changed');
  const windows = new Map(Array.isArray(artifact.windows) ? artifact.windows.map(window => [window.windowIndex, window]) : []);
  const same = Array.isArray(artifact.comparisons) ? artifact.comparisons.find(comparison => exact(comparison, ['referenceWindowIndex', 'targetWindowIndex', 'status', 'difference', 'unknownReason']) && comparison.status === 'same' && comparison.difference === null && comparison.unknownReason === null) : undefined;
  if (!same || !validateDemoCommandWindow(windows.get(same.referenceWindowIndex)) || !validateDemoCommandWindow(windows.get(same.targetWindowIndex)) || artifact.firstDifference !== null) throw new Error('copied explanation command truth changed');
  if (JSON.stringify(artifact).includes('#2563eb')) throw new Error('copied explanation contains a raw demo argument');
  return true;
}

export function validateCopiedComparison(artifact, baselineSession, candidateSession, pairing) {
  const keys = ['schemaVersion', 'comparisonId', 'createdAt', 'canvasScanVersion', 'pairingMethod', 'baseline', 'candidate', 'status', 'incomparableReasons', 'measures', 'improvementEstablished'];
  if (!exact(artifact, keys) || artifact.schemaVersion !== 1 || artifact.canvasScanVersion !== '0.5.0' || !text(artifact.comparisonId) || !text(artifact.createdAt) || artifact.pairingMethod !== 'user-selected' || artifact.status !== 'comparable' || artifact.improvementEstablished !== false || artifact.incomparableReasons.length !== 0) throw new Error('copied comparison root changed');
  const left = validateDemoSession(baselineSession, pairing.baselineFindingIndex, 'baseline');
  const right = validateDemoSession(candidateSession, pairing.candidateFindingIndex, 'candidate');
  const refKeys = ['sessionId', 'findingIndex', 'findingType', 'canvasId'];
  if (!exact(artifact.baseline, refKeys) || artifact.baseline.sessionId !== baselineSession.sessionId || artifact.baseline.findingIndex !== pairing.baselineFindingIndex || artifact.baseline.findingType !== left.finding.type || artifact.baseline.canvasId !== left.finding.canvasId) throw new Error('copied comparison baseline changed');
  if (!exact(artifact.candidate, refKeys) || artifact.candidate.sessionId !== candidateSession.sessionId || artifact.candidate.findingIndex !== pairing.candidateFindingIndex || artifact.candidate.findingType !== right.finding.type || artifact.candidate.canvasId !== right.finding.canvasId) throw new Error('copied comparison candidate changed');
  validateComparisonMeasures(artifact.measures);
  return true;
}

export function checkReadinessEvidence(value, expectedCandidate) {
  const rootKeys = ['schemaVersion', 'issue', 'status', 'gitSha', 'branch', 'packageVersion', 'tarballSha256', 'packedIifeSha256', 'installedIifeSha256', 'browserVersion', 'earlyLoad', 'cleanBefore', 'cleanAfter', 'publicMethods', 'actionIds', 'baseline', 'explanation', 'candidate', 'comparison', 'artifacts', 'diagnostics', 'failures'];
  if (!exact(value, rootKeys) || value.schemaVersion !== 1 || value.issue !== 'SIDPROJ-105' || value.status !== 'PASS') throw new Error('readiness evidence root changed');
  if (!expectedCandidate || value.gitSha !== expectedCandidate.gitSha || value.branch !== expectedCandidate.branch || value.packageVersion !== expectedCandidate.packageVersion || !/^[0-9a-f]{64}$/.test(value.tarballSha256) || !/^[0-9a-f]{64}$/.test(value.packedIifeSha256) || value.installedIifeSha256 !== value.packedIifeSha256 || !text(value.browserVersion)) throw new Error('readiness candidate identity changed');
  if (value.earlyLoad !== true || value.cleanBefore !== true || value.cleanAfter !== true || JSON.stringify(value.publicMethods) !== JSON.stringify(RITUAL_METHODS) || JSON.stringify(value.actionIds) !== JSON.stringify(ACTION_IDS)) throw new Error('readiness ritual identity changed');

  const findingKeys = ['sessionId', 'findingIndex', 'findingType'];
  if (!exact(value.baseline, findingKeys) || !exact(value.candidate, findingKeys) || !text(value.baseline.sessionId) || !text(value.candidate.sessionId) || value.baseline.sessionId === value.candidate.sessionId || !Number.isInteger(value.baseline.findingIndex) || !Number.isInteger(value.candidate.findingIndex) || value.baseline.findingType !== 'repeated-draw-work' || value.candidate.findingType !== value.baseline.findingType) throw new Error('readiness selected findings changed');

  const explanationKeys = ['sourceSessionId', 'sourceFindingIndex', 'followUpSessionId', 'stopReason'];
  if (!exact(value.explanation, explanationKeys) || value.explanation.sourceSessionId !== value.baseline.sessionId || value.explanation.sourceFindingIndex !== value.baseline.findingIndex || !text(value.explanation.followUpSessionId) || value.explanation.stopReason !== 'manual') throw new Error('readiness explanation changed');

  const comparisonKeys = ['pairingMethod', 'status', 'improvementEstablished', 'baselineSessionId', 'baselineFindingIndex', 'candidateSessionId', 'candidateFindingIndex'];
  if (!exact(value.comparison, comparisonKeys) || value.comparison.pairingMethod !== 'user-selected' || value.comparison.status !== 'comparable' || value.comparison.improvementEstablished !== false || value.comparison.baselineSessionId !== value.baseline.sessionId || value.comparison.baselineFindingIndex !== value.baseline.findingIndex || value.comparison.candidateSessionId !== value.candidate.sessionId || value.comparison.candidateFindingIndex !== value.candidate.findingIndex) throw new Error('readiness explicit comparison changed');
  if (!exact(value.artifacts, ['baselineSession', 'candidateSession', 'copiedExplanation', 'copiedComparison']) || value.artifacts.baselineSession.sessionId !== value.baseline.sessionId || value.artifacts.candidateSession.sessionId !== value.candidate.sessionId) throw new Error('readiness raw artifacts changed');
  validateCopiedExplanation(value.artifacts.copiedExplanation, value.baseline);
  validateCopiedComparison(value.artifacts.copiedComparison, value.artifacts.baselineSession, value.artifacts.candidateSession, { baselineFindingIndex: value.baseline.findingIndex, candidateFindingIndex: value.candidate.findingIndex });
  if (!exact(value.diagnostics, diagnosticKeys) || diagnosticKeys.some(key => !Array.isArray(value.diagnostics[key]) || value.diagnostics[key].length > 0) || !Array.isArray(value.failures) || value.failures.length > 0) throw new Error('readiness diagnostics changed');
  return true;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function runBytes(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr}`);
  return result.stdout;
}

async function currentCandidate() {
  const status = run('git', ['status', '--short', '--untracked-files=all'], root);
  if (status) throw new Error(`readiness requires a clean worktree\n${status}`);
  return {
    gitSha: run('git', ['rev-parse', 'HEAD'], root).trim(),
    branch: run('git', ['branch', '--show-current'], root).trim(),
    packageVersion: JSON.parse(await readFile(path.join(root, 'packages/core/package.json'), 'utf8')).version,
  };
}

async function waitForServer(server) {
  for (let end = Date.now() + 60_000; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 200))) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('clean consumer server exited before readiness');
    try { if ((await fetch(origin)).ok) return; } catch {}
  }
  throw new Error('clean consumer server did not become ready');
}

async function stopServer(server) {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]);
  if (server.exitCode === null && server.signalCode === null) throw new Error('clean consumer server did not stop');
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function replay(page) {
  const action = page.locator('[data-demo-action="replay-interaction"]');
  await action.click();
  await page.waitForFunction(() => !document.querySelector('[data-demo-action="replay-interaction"]')?.disabled);
  await settle(page);
}

async function expandFinding(page, findingIndex) {
  const card = page.locator('.finding-card').nth(findingIndex);
  const toggle = card.locator('.finding-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await settle(page);
}

async function record(page) {
  await page.locator('[aria-label="Record investigation"]').click();
  await replay(page);
  await page.locator('[aria-label="Stop recording"]').click();
  await page.waitForFunction(() => window.__CANVAS_SCAN__.getLastSession()?.stopReason === 'manual');
  await settle(page);
  return page.evaluate(() => window.__CANVAS_SCAN__.getLastSession());
}

async function runBrowser(consumer, diagnostics) {
  let server;
  let browser;
  const actionIds = [];
  try {
    server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: consumer, detached: true, stdio: 'ignore' });
    await waitForServer(server);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const browserVersion = browser.version();
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.on('console', message => { if (message.type() === 'warning') diagnostics.warnings.push(message.text()); if (message.type() === 'error') diagnostics.errors.push(message.text()); });
    page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
    page.on('requestfailed', request => diagnostics.requestFailures.push(`${request.method()} ${new URL(request.url()).pathname}`));
    await page.goto(origin, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__CANVAS_SCAN__ && document.querySelector('[data-demo-action="replay-interaction"]'));
    await settle(page);

    const earlyLoad = await page.evaluate(() => Boolean(window.__CANVAS_SCAN__));
    actionIds.push('early-load');
    const publicMethods = await page.evaluate(methods => methods.filter(method => typeof window.__CANVAS_SCAN__?.[method] === 'function'), RITUAL_METHODS);
    const baselineSession = await record(page);
    actionIds.push('record-baseline');
    const baselineFindingIndex = baselineSession.findings.findIndex(finding => finding.type === 'repeated-draw-work');
    if (baselineFindingIndex < 0) throw new Error('clean demo baseline has no repeated-draw-work finding');
    await expandFinding(page, baselineFindingIndex);
    await page.locator(`.explanation-action[data-finding-index="${baselineFindingIndex}"]`).click();
    await replay(page);
    await page.locator('[aria-label="Stop recording"]').click();
    await page.waitForFunction(() => document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector('.explanation-panel')?.textContent?.includes('EXPLANATION COMPLETE'));
    await settle(page);
    actionIds.push('explain-baseline');
    await page.locator('.explanation-copy').click();
    await page.waitForFunction(() => document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector('.explanation-copy-status')?.textContent === 'Explanation JSON copied');
    const copiedExplanation = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    validateCopiedExplanation(copiedExplanation, { sessionId: baselineSession.sessionId, findingIndex: baselineFindingIndex, findingType: baselineSession.findings[baselineFindingIndex].type });
    actionIds.push('copy-explanation');
    await page.locator(`.baseline-action[data-finding-index="${baselineFindingIndex}"]`).click();
    actionIds.push('keep-baseline');
    await page.locator('[data-demo-action="apply-candidate-change"]').click();
    await page.waitForFunction(() => document.querySelector('[data-demo-action="apply-candidate-change"]')?.textContent?.includes('Candidate change applied'));
    actionIds.push('apply-change');
    const candidateSession = await record(page);
    actionIds.push('record-candidate');
    const candidateFindingIndex = candidateSession.findings.findIndex(finding => finding.type === baselineSession.findings[baselineFindingIndex].type);
    if (candidateFindingIndex < 0) throw new Error('clean demo candidate has no same-type finding');
    await expandFinding(page, candidateFindingIndex);
    const comparisonAction = page.locator(`.comparison-action[data-finding-index="${candidateFindingIndex}"]`);
    await comparisonAction.waitFor({ state: 'visible' });
    await comparisonAction.click();
    actionIds.push('pair-findings');
    await page.locator('.comparison-copy').click();
    await page.waitForFunction(() => document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector('.comparison-copy-status')?.textContent === 'Comparison JSON copied');
    const copiedComparison = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
    actionIds.push('copy-comparison');
    validateCopiedComparison(copiedComparison, baselineSession, candidateSession, { baselineFindingIndex, candidateFindingIndex });
    await context.close();
    return {
      browserVersion,
      earlyLoad,
      publicMethods,
      actionIds,
      baseline: { sessionId: baselineSession.sessionId, findingIndex: baselineFindingIndex, findingType: baselineSession.findings[baselineFindingIndex].type },
      explanation: { sourceSessionId: copiedExplanation.source.sessionId, sourceFindingIndex: copiedExplanation.source.findingIndex, followUpSessionId: copiedExplanation.followUp.sessionId, stopReason: copiedExplanation.stopReason },
      candidate: { sessionId: candidateSession.sessionId, findingIndex: candidateFindingIndex, findingType: candidateSession.findings[candidateFindingIndex].type },
      comparison: { pairingMethod: copiedComparison.pairingMethod, status: copiedComparison.status, improvementEstablished: copiedComparison.improvementEstablished, baselineSessionId: copiedComparison.baseline.sessionId, baselineFindingIndex: copiedComparison.baseline.findingIndex, candidateSessionId: copiedComparison.candidate.sessionId, candidateFindingIndex: copiedComparison.candidate.findingIndex },
      artifacts: { baselineSession, candidateSession, copiedExplanation, copiedComparison },
    };
  } finally {
    try { await browser?.close(); } catch {}
    await stopServer(server);
  }
}

async function checkDirectory(directory, expectedCandidate) {
  const expected = expectedCandidate ?? await currentCandidate();
  const names = (await readdir(directory)).sort();
  if (JSON.stringify(names) !== JSON.stringify(['evidence-sha256.txt', 'evidence.json'])) throw new Error('readiness evidence files changed');
  const bytes = await readFile(path.join(directory, 'evidence.json'));
  const manifest = (await readFile(path.join(directory, 'evidence-sha256.txt'), 'utf8')).trim();
  if (manifest !== `${hash(bytes)}  evidence.json`) throw new Error('readiness evidence hash changed');
  return checkReadinessEvidence(JSON.parse(bytes), expected);
}

async function main() {
  const checkIndex = process.argv.indexOf('--check-evidence');
  if (checkIndex >= 0) {
    await checkDirectory(process.argv[checkIndex + 1] || defaultDirectory);
    console.log('SIDPROJ_105_READINESS_CHECK: PASS');
    return;
  }

  const directoryIndex = process.argv.indexOf('--output');
  const directory = directoryIndex >= 0 ? process.argv[directoryIndex + 1] : defaultDirectory;
  const candidate = await currentCandidate();
  const { gitSha, branch, packageVersion } = candidate;
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'canvas-scan-readiness-v05-'));
  const diagnostics = Object.fromEntries(diagnosticKeys.map(key => [key, []]));
  const failures = [];
  let browserResult;
  let tarballSha256 = '';
  let packedIifeSha256 = '';
  let installedIifeSha256 = '';
  try {
    const packDirectory = path.join(temporaryRoot, 'pack');
    const consumer = path.join(temporaryRoot, 'consumer');
    await mkdir(packDirectory);
    await mkdir(path.join(consumer, 'src'), { recursive: true });
    run('pnpm', ['--filter', 'canvas-scan', 'pack', '--pack-destination', packDirectory], root);
    const tarballs = (await readdir(packDirectory)).filter(name => name.endsWith('.tgz'));
    if (tarballs.length !== 1) throw new Error(`expected one readiness tarball, found ${tarballs.length}`);
    const tarball = path.join(packDirectory, tarballs[0]);
    tarballSha256 = hash(await readFile(tarball));
    packedIifeSha256 = hash(runBytes('tar', ['-xzOf', tarball, 'package/dist/canvas-scan.iife.js'], root));
    await writeFile(path.join(consumer, 'package.json'), stable({ private: true, type: 'module' }));
    await copyFile(path.join(root, 'apps/demo/index.html'), path.join(consumer, 'index.html'));
    await copyFile(path.join(root, 'apps/demo/vite.config.ts'), path.join(consumer, 'vite.config.ts'));
    await copyFile(path.join(root, 'apps/demo/src/App.tsx'), path.join(consumer, 'src/App.tsx'));
    await copyFile(path.join(root, 'apps/demo/src/main.tsx'), path.join(consumer, 'src/main.tsx'));
    run('npm', ['install', '--no-audit', '--no-fund', '--cache', path.join(temporaryRoot, 'npm-cache'), tarball, 'react@^19', 'react-dom@^19', '@vitejs/plugin-react@^4', 'typescript@^5.7', 'vite@^6'], consumer);
    installedIifeSha256 = hash(await readFile(path.join(consumer, 'node_modules/canvas-scan/dist/canvas-scan.iife.js')));
    run('npx', ['vite', 'build'], consumer);
    browserResult = await runBrowser(consumer, diagnostics);
  } catch (error) {
    failures.push(error instanceof Error ? error.stack ?? error.message : String(error));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  const cleanAfter = run('git', ['status', '--short', '--untracked-files=all'], root) === '';
  const evidence = {
    schemaVersion: 1,
    issue: 'SIDPROJ-105',
    status: readinessStatus(failures, diagnostics, [Boolean(browserResult), cleanAfter, packedIifeSha256 === installedIifeSha256]),
    gitSha,
    branch,
    packageVersion,
    tarballSha256,
    packedIifeSha256,
    installedIifeSha256,
    browserVersion: browserResult?.browserVersion ?? '',
    earlyLoad: browserResult?.earlyLoad ?? false,
    cleanBefore: true,
    cleanAfter,
    publicMethods: browserResult?.publicMethods ?? [],
    actionIds: browserResult?.actionIds ?? [],
    baseline: browserResult?.baseline ?? null,
    explanation: browserResult?.explanation ?? null,
    candidate: browserResult?.candidate ?? null,
    comparison: browserResult?.comparison ?? null,
    artifacts: browserResult?.artifacts ?? null,
    diagnostics,
    failures,
  };
  await mkdir(directory, { recursive: true });
  const bytes = Buffer.from(stable(evidence));
  await writeFile(path.join(directory, 'evidence.json'), bytes);
  await writeFile(path.join(directory, 'evidence-sha256.txt'), `${hash(bytes)}  evidence.json\n`);
  if (evidence.status === 'PASS') await checkDirectory(directory, candidate);
  console.log(`SIDPROJ_105_READINESS_EVIDENCE: ${directory}`);
  console.log(`SIDPROJ_105_READINESS: ${evidence.status}`);
  if (evidence.status === 'FAIL') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
