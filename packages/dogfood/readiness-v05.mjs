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
const hash = value => createHash('sha256').update(value).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const text = value => typeof value === 'string' && value.length > 0;
const stable = value => `${JSON.stringify(value, null, 2)}\n`;

export function checkReadinessEvidence(value) {
  const rootKeys = ['schemaVersion', 'issue', 'status', 'gitSha', 'branch', 'packageVersion', 'tarballSha256', 'installedIifeSha256', 'browserVersion', 'earlyLoad', 'worktreeUnchanged', 'publicMethods', 'actionIds', 'baseline', 'explanation', 'candidate', 'comparison', 'diagnostics', 'failures'];
  if (!exact(value, rootKeys) || value.schemaVersion !== 1 || value.issue !== 'SIDPROJ-105' || value.status !== 'PASS') throw new Error('readiness evidence root changed');
  if (!/^[0-9a-f]{40}$/.test(value.gitSha) || !text(value.branch) || value.packageVersion !== '0.5.0' || !/^[0-9a-f]{64}$/.test(value.tarballSha256) || !/^[0-9a-f]{64}$/.test(value.installedIifeSha256) || !text(value.browserVersion)) throw new Error('readiness candidate identity changed');
  if (value.earlyLoad !== true || value.worktreeUnchanged !== true || JSON.stringify(value.publicMethods) !== JSON.stringify(RITUAL_METHODS) || JSON.stringify(value.actionIds) !== JSON.stringify(ACTION_IDS)) throw new Error('readiness ritual identity changed');

  const findingKeys = ['sessionId', 'findingIndex', 'findingType'];
  if (!exact(value.baseline, findingKeys) || !exact(value.candidate, findingKeys) || !text(value.baseline.sessionId) || !text(value.candidate.sessionId) || value.baseline.sessionId === value.candidate.sessionId || !Number.isInteger(value.baseline.findingIndex) || !Number.isInteger(value.candidate.findingIndex) || value.baseline.findingType !== 'repeated-draw-work' || value.candidate.findingType !== value.baseline.findingType) throw new Error('readiness selected findings changed');

  const explanationKeys = ['sourceSessionId', 'sourceFindingIndex', 'followUpSessionId', 'stopReason', 'clipboardMatched'];
  if (!exact(value.explanation, explanationKeys) || value.explanation.sourceSessionId !== value.baseline.sessionId || value.explanation.sourceFindingIndex !== value.baseline.findingIndex || !text(value.explanation.followUpSessionId) || value.explanation.stopReason !== 'manual' || value.explanation.clipboardMatched !== true) throw new Error('readiness explanation changed');

  const comparisonKeys = ['pairingMethod', 'status', 'improvementEstablished', 'baselineSessionId', 'baselineFindingIndex', 'candidateSessionId', 'candidateFindingIndex', 'clipboardMatched'];
  if (!exact(value.comparison, comparisonKeys) || value.comparison.pairingMethod !== 'user-selected' || value.comparison.status !== 'comparable' || value.comparison.improvementEstablished !== false || value.comparison.baselineSessionId !== value.baseline.sessionId || value.comparison.baselineFindingIndex !== value.baseline.findingIndex || value.comparison.candidateSessionId !== value.candidate.sessionId || value.comparison.candidateFindingIndex !== value.candidate.findingIndex || value.comparison.clipboardMatched !== true) throw new Error('readiness explicit comparison changed');
  if (!exact(value.diagnostics, diagnosticKeys) || diagnosticKeys.some(key => !Array.isArray(value.diagnostics[key]) || value.diagnostics[key].length > 0) || !Array.isArray(value.failures) || value.failures.length > 0) throw new Error('readiness diagnostics changed');
  return true;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
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
    await page.waitForFunction(() => Boolean(window.__CANVAS_SCAN__.getLastExplanation()));
    await settle(page);
    const explanation = await page.evaluate(() => window.__CANVAS_SCAN__.getLastExplanation());
    actionIds.push('explain-baseline');
    await page.locator('.explanation-copy').click();
    await page.waitForFunction(() => document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector('.explanation-copy-status')?.textContent === 'Explanation JSON copied');
    const copiedExplanation = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
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
    const expectedComparison = await page.evaluate(({ baseline, candidate, pairing }) => window.__CANVAS_SCAN__.compareSessions(baseline, candidate, pairing), {
      baseline: baselineSession,
      candidate: candidateSession,
      pairing: { baselineFindingIndex, candidateFindingIndex },
    });
    const comparison = await page.evaluate(() => {
      const text = document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector('.comparison-panel')?.textContent ?? '';
      return { text };
    });
    await context.close();
    return {
      browserVersion,
      earlyLoad,
      publicMethods,
      actionIds,
      baseline: { sessionId: baselineSession.sessionId, findingIndex: baselineFindingIndex, findingType: baselineSession.findings[baselineFindingIndex].type },
      explanation: { sourceSessionId: explanation.source.sessionId, sourceFindingIndex: explanation.source.findingIndex, followUpSessionId: explanation.followUp.sessionId, stopReason: explanation.stopReason, clipboardMatched: JSON.stringify(copiedExplanation) === JSON.stringify(explanation) },
      candidate: { sessionId: candidateSession.sessionId, findingIndex: candidateFindingIndex, findingType: candidateSession.findings[candidateFindingIndex].type },
      comparison: { pairingMethod: copiedComparison.pairingMethod, status: copiedComparison.status, improvementEstablished: copiedComparison.improvementEstablished, baselineSessionId: copiedComparison.baseline.sessionId, baselineFindingIndex: copiedComparison.baseline.findingIndex, candidateSessionId: copiedComparison.candidate.sessionId, candidateFindingIndex: copiedComparison.candidate.findingIndex, clipboardMatched: comparison.text.includes('Pairing: user-selected') && JSON.stringify(copiedComparison) === JSON.stringify(expectedComparison) },
    };
  } finally {
    try { await browser?.close(); } catch {}
    await stopServer(server);
  }
}

async function checkDirectory(directory) {
  const names = (await readdir(directory)).sort();
  if (JSON.stringify(names) !== JSON.stringify(['evidence-sha256.txt', 'evidence.json'])) throw new Error('readiness evidence files changed');
  const bytes = await readFile(path.join(directory, 'evidence.json'));
  const manifest = (await readFile(path.join(directory, 'evidence-sha256.txt'), 'utf8')).trim();
  if (manifest !== `${hash(bytes)}  evidence.json`) throw new Error('readiness evidence hash changed');
  return checkReadinessEvidence(JSON.parse(bytes));
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
  const initialStatus = run('git', ['status', '--short', '--untracked-files=all'], root);
  const gitSha = run('git', ['rev-parse', 'HEAD'], root).trim();
  const branch = run('git', ['branch', '--show-current'], root).trim();
  const packageVersion = JSON.parse(await readFile(path.join(root, 'packages/core/package.json'), 'utf8')).version;
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'canvas-scan-readiness-v05-'));
  const diagnostics = Object.fromEntries(diagnosticKeys.map(key => [key, []]));
  const failures = [];
  let browserResult;
  let tarballSha256 = '';
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

  const evidence = {
    schemaVersion: 1,
    issue: 'SIDPROJ-105',
    status: failures.length ? 'FAIL' : 'PASS',
    gitSha,
    branch,
    packageVersion,
    tarballSha256,
    installedIifeSha256,
    browserVersion: browserResult?.browserVersion ?? '',
    earlyLoad: browserResult?.earlyLoad ?? false,
    worktreeUnchanged: run('git', ['status', '--short', '--untracked-files=all'], root) === initialStatus,
    publicMethods: browserResult?.publicMethods ?? [],
    actionIds: browserResult?.actionIds ?? [],
    baseline: browserResult?.baseline ?? null,
    explanation: browserResult?.explanation ?? null,
    candidate: browserResult?.candidate ?? null,
    comparison: browserResult?.comparison ?? null,
    diagnostics,
    failures,
  };
  await mkdir(directory, { recursive: true });
  const bytes = Buffer.from(stable(evidence));
  await writeFile(path.join(directory, 'evidence.json'), bytes);
  await writeFile(path.join(directory, 'evidence-sha256.txt'), `${hash(bytes)}  evidence.json\n`);
  if (!failures.length) await checkDirectory(directory);
  console.log(`SIDPROJ_105_READINESS_EVIDENCE: ${directory}`);
  console.log(`SIDPROJ_105_READINESS: ${failures.length ? 'FAIL' : 'PASS'}`);
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
