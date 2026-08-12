import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { checkOverlayComparisonEvidence } from './overlay-comparison-truth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = '/private/tmp/sidproj-66-overlay-comparison-evidence';
const port = 5206;
const url = `http://127.0.0.1:${port}/v05-07-overlay-comparison.html`;
const hash = value => createHash('sha256').update(value).digest('hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const status = () => execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' });
const command = 'pnpm --filter dogfood run probe:overlay-comparison';
const diagnostics = { warnings: [], errors: [], pageErrors: [] };
const checks = {};
const activations = [];
const actions = {};
const failures = [];
let browser; let server; let chromeVersion = ''; let bundleHash = '';
let baselineFindingIndex = -1; let comparableCandidateIndex = -1; let incomparableCandidateIndex = -1;
const evidence = {};

function check(value, name) { checks[name] = Boolean(value); if (!value) throw new Error(`failed check: ${name}`); }
async function ready() {
  for (let end = Date.now() + 60000; Date.now() < end; await wait(200)) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('Vite exited before readiness');
    try { if ((await fetch(url)).ok) return; } catch {}
  }
  throw new Error('Vite did not start on strict port 5206');
}
async function stopServer() {
  if (!server?.pid) return;
  try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (server.exitCode === null && server.signalCode === null) await Promise.race([once(server, 'exit'), wait(5000)]);
  for (let end = Date.now() + 5000; Date.now() < end; await wait(100)) {
    try { await fetch(url); } catch { return; }
  }
  try { process.kill(-server.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (server.exitCode === null && server.signalCode === null) await Promise.race([once(server, 'exit'), wait(5000)]);
  for (let end = Date.now() + 5000; Date.now() < end; await wait(100)) {
    try { await fetch(url); } catch { return; }
  }
  throw new Error('Vite still accepts requests after shutdown');
}
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function overlay(page) { return page.locator('[data-canvas-scan]').evaluate(node => node.shadowRoot.querySelector('.dock').innerText); }
async function candidateAction(page) {
  const action = page.locator('.comparison-action:not([hidden])').first();
  if (!await action.isVisible()) {
    const card = action.locator('xpath=ancestor::section[contains(@class,"finding-card")]');
    await card.locator('.finding-toggle').click();
    await settle(page);
  }
  await action.waitFor({ state: 'visible', timeout: 5000 });
  return action;
}
async function activate(page, selector, key, expectedFocus = selector, actionName = selector) {
  const item = page.locator(selector).first(); await item.waitFor({ state: 'visible', timeout: 5000 });
  const focusBefore = await item.evaluate(node => { node.focus(); return node.getRootNode().activeElement === node; });
  check(focusBefore, `${actionName}:focus-before`);
  if (key) await page.keyboard.press(key); else await item.click();
  await settle(page);
  const focused = page.locator(expectedFocus).first();
  const focusAfter = await focused.evaluate(node => node.getRootNode().activeElement === node);
  check(focusAfter, `${actionName}:focus-after`);
  activations.push({ action: actionName, inputMethod: key ? 'keyboard' : 'pointer', key: key ?? null, focusBefore, focusAfter });
}
function session(page) { return page.evaluate(() => window.__CANVAS_SCAN__.getLastSession()); }

if (process.argv[2] === '--check-evidence') {
  checkOverlayComparisonEvidence(process.argv[3] ?? directory);
  console.log('SIDPROJ_66_OVERLAY_COMPARISON: PASS');
  process.exit(0);
}

const initialStatus = status();
try {
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'run', 'build'], { cwd: root, stdio: 'inherit' });
  const bundle = path.join(root, 'packages/core/dist/canvas-scan.iife.js');
  await cp(bundle, path.join(root, 'apps/workbench/public/canvas-scan.iife.js'));
  bundleHash = hash(await readFile(bundle));
  server = spawn('pnpm', ['--filter', 'workbench', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, detached: true, stdio: 'ignore' });
  await ready();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  chromeVersion = `Chrome ${browser.version()}`;
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'warning') diagnostics.warnings.push(message.text()); if (message.type() === 'error') diagnostics.errors.push(message.text()); });
  page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'load' }); await settle(page);

  await page.locator('#baseline').click();
  await page.waitForFunction(() => window.__V05_07__.baselineComplete, undefined, { timeout: 5000 });
  await page.locator('.baseline-action').first().waitFor({ timeout: 5000 });
  const initialBaselineAction = page.locator('.baseline-action').first();
  baselineFindingIndex = Number(await initialBaselineAction.getAttribute('data-finding-index'));
  const baselineLabelBefore = await initialBaselineAction.innerText();
  await initialBaselineAction.click(); await settle(page);
  check((await overlay(page)).includes('BASELINE KEPT'), 'pointerBaseline');
  evidence.baseline = await session(page);
  const baselineAction = page.locator('.baseline-action').first();
  const baselineLabelAfter = await baselineAction.innerText();
  const baselineAriaPressedAfter = await baselineAction.getAttribute('aria-pressed');
  check(baselineAriaPressedAfter === 'true', 'baselineSelected');
  actions.baseline = { inputMethod: 'pointer', sessionId: evidence.baseline.sessionId, findingIndex: baselineFindingIndex, labelBefore: baselineLabelBefore, labelAfter: baselineLabelAfter, ariaPressedAfter: baselineAriaPressedAfter };

  await page.locator('[data-canvas-scan]').evaluate(node => node.remove());
  await page.waitForTimeout(1100);
  const reattachedHostCount = await page.locator('[data-canvas-scan]').count();
  const baselineActionCount = await page.locator('.baseline-action').count();
  check(reattachedHostCount === 1, 'hostReattached');
  check(baselineActionCount > 0, 'baselineAfterReattach');
  actions.hydration = { hostRemoved: true, reattachedHostCount, baselineActionCount };
  const explanationBeforeBaseline = page.locator('.explanation-action').first();
  await explanationBeforeBaseline.focus(); await page.keyboard.press('Tab'); await settle(page);
  const tabFocusAfter = await page.locator('.baseline-action').first().evaluate(node => node.getRootNode().activeElement === node);
  check(tabFocusAfter, 'tabOrderAfterReattach');
  actions.tabOrder = { inputMethod: 'keyboard', key: 'Tab', from: 'Explain next interaction', to: 'Baseline kept', focusAfter: tabFocusAfter };

  await page.locator('#candidate').click();
  await activate(page, '[aria-label="Record investigation"]', 'Enter', '[aria-label="Stop recording"]', 'record-comparable');
  await page.evaluate(() => window.__V05_07__.drawForOverlayRecording());
  await activate(page, '[aria-label="Stop recording"]', 'Space', '[aria-label="Stop recording"]', 'stop-comparable');
  const comparableAction = await candidateAction(page);
  const allActions = page.locator('.comparison-action');
  const candidateActions = await page.locator('.comparison-action:not([hidden])').count();
  check(candidateActions > 0 && candidateActions < await allActions.count(), 'sameTypeFilter');
  evidence.comparable = await session(page);
  comparableCandidateIndex = Number(await comparableAction.getAttribute('data-finding-index'));
  const visibleCandidateIndexes = await page.locator('.comparison-action:not([hidden])').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-finding-index'))));
  const hiddenCandidateIndexes = await page.locator('.comparison-action[hidden]').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('data-finding-index'))));
  actions.sameTypeFilter = { findingCount: await page.locator('.finding-card').count(), visibleCandidateIndexes, hiddenCandidateIndexes };
  await comparableAction.click(); await settle(page);
  const comparableText = await page.locator('.comparison-panel').innerText();
  check(comparableText.includes('Comparison status: comparable'), 'pointerComparable');
  await activate(page, '.comparison-copy', 'Enter', '.comparison-copy', 'copy-comparable');
  const copiedComparable = await page.evaluate(() => navigator.clipboard.readText());
  evidence.copiedComparable = JSON.parse(copiedComparable);
  check(copiedComparable === JSON.stringify(evidence.copiedComparable), 'keyboardComparableCopy');
  actions.comparable = { inputMethod: 'pointer', status: evidence.copiedComparable.status, baselineFindingIndex, candidateFindingIndex: comparableCandidateIndex };
  actions.comparableCopy = { inputMethod: 'keyboard', key: 'Enter', clipboardMatched: copiedComparable === JSON.stringify(evidence.copiedComparable) };
  evidence.comparablePng = await page.locator('.comparison-panel').screenshot();

  await page.locator('#incomplete').click();
  await activate(page, '[aria-label="Record investigation"]', 'Space', '[aria-label="Stop recording"]', 'record-incomparable');
  await page.evaluate(() => window.__V05_07__.drawForOverlayRecording());
  await activate(page, '[aria-label="Stop recording"]', 'Enter', '[aria-label="Stop recording"]', 'stop-incomparable');
  evidence.incomparable = await session(page);
  check(evidence.incomparable.droppedEntryCounts.canvasLifetimes > 0, 'incompleteDrop');
  const incomparableAction = await candidateAction(page);
  incomparableCandidateIndex = Number(await incomparableAction.getAttribute('data-finding-index'));
  await activate(page, '.comparison-action:not([hidden])', 'Enter', '.comparison-action:not([hidden])', 'compare-incomparable');
  const incomparableText = await page.locator('.comparison-panel').innerText();
  check(incomparableText.includes('incomplete-evidence') && !/delta|higher in this pair|lower in this pair/.test(incomparableText), 'keyboardIncomparable');
  await activate(page, '.comparison-copy', 'Space', '.comparison-copy', 'copy-incomparable');
  const copiedIncomparable = await page.evaluate(() => navigator.clipboard.readText());
  evidence.copiedIncomparable = JSON.parse(copiedIncomparable);
  actions.incomparable = { inputMethod: 'keyboard', key: 'Enter', status: evidence.copiedIncomparable.status, reason: evidence.copiedIncomparable.incomparableReasons[0] ?? null, baselineFindingIndex, candidateFindingIndex: incomparableCandidateIndex };
  actions.incomparableCopy = { inputMethod: 'keyboard', key: 'Space', clipboardMatched: copiedIncomparable === JSON.stringify(evidence.copiedIncomparable) };
  evidence.incomparablePng = await page.locator('.comparison-panel').screenshot();
  const beforeReplacement = await page.locator('.comparison-panel').innerText();
  const replacementSelector = `.baseline-action[data-finding-index="${incomparableCandidateIndex}"]`;
  const replacementAction = page.locator(replacementSelector).first();
  if (!await replacementAction.isVisible()) { await replacementAction.locator('xpath=ancestor::section[contains(@class,"finding-card")]').locator('.finding-toggle').click(); await settle(page); }
  await activate(page, replacementSelector, 'Enter', replacementSelector, 'replace-baseline');
  const afterReplacement = await page.locator('.comparison-panel').innerText();
  check(beforeReplacement.includes('COMPARISON COMPLETE') && afterReplacement.includes('BASELINE KEPT') && !afterReplacement.includes('COMPARISON COMPLETE'), 'keyboardReplacement');
  actions.replacement = { inputMethod: 'keyboard', key: 'Enter', sessionIdBefore: evidence.baseline.sessionId, sessionIdAfter: evidence.incomparable.sessionId, findingIndexAfter: incomparableCandidateIndex, comparisonCleared: !afterReplacement.includes('COMPARISON COMPLETE') };
  check(!/\b(fixed|faster|improved|regressed)\b/i.test(comparableText + incomparableText), 'claimWords');
  check(diagnostics.warnings.length === 0 && diagnostics.errors.length === 0 && diagnostics.pageErrors.length === 0, 'browserDiagnostics');
  evidence.flow = { chromeVersion, gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), initialStatus, finalStatus: status(), bundleSha256: bundleHash, command, selectedIndexes: { comparable: { baselineFindingIndex, candidateFindingIndex: comparableCandidateIndex }, incomparable: { baselineFindingIndex, candidateFindingIndex: incomparableCandidateIndex } }, panelText: { comparable: comparableText, incomparable: incomparableText, beforeReplacement, afterReplacement }, actions, activations, screenshots: { comparableSha256: hash(evidence.comparablePng), incomparableSha256: hash(evidence.incomparablePng) }, checks, diagnostics, failures };
  await context.close();
} catch (error) { failures.push(error instanceof Error ? error.stack ?? error.message : String(error)); }
finally { try { await browser?.close(); } catch {} try { await stopServer(); } catch (error) { failures.push(String(error)); } }

if (!failures.length && status() === initialStatus) {
  try {
    const data = { 'chrome-flow.json': evidence.flow, 'raw-baseline-session.json': evidence.baseline, 'raw-comparable-candidate-session.json': evidence.comparable, 'raw-incomparable-candidate-session.json': evidence.incomparable, 'copied-comparable-comparison.json': evidence.copiedComparable, 'copied-incomparable-comparison.json': evidence.copiedIncomparable };
    await rm(directory, { recursive: true, force: true }); await mkdir(directory, { recursive: true });
    for (const [name, value] of Object.entries(data)) await writeFile(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
    await writeFile(path.join(directory, 'comparable.png'), evidence.comparablePng); await writeFile(path.join(directory, 'incomparable.png'), evidence.incomparablePng);
    const names = (await readdir(directory)).sort();
    await writeFile(path.join(directory, 'evidence-sha256.txt'), `${(await Promise.all(names.map(async name => `${hash(await readFile(path.join(directory, name)))}  ${name}`))).join('\n')}\n`);
    checkOverlayComparisonEvidence(directory);
  } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
} else if (!failures.length) failures.push('worktree changed during probe');
console.log(`SIDPROJ_66_OVERLAY_COMPARISON: ${failures.length ? 'FAIL' : 'PASS'}`);
if (failures.length) { for (const failure of failures) console.error(failure); process.exitCode = 1; }
