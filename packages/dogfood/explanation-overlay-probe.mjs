import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 5204;
const url = `http://127.0.0.1:${port}/v05-04-explanation-overlay.html`;
const dir = '/private/tmp/sidproj-67-selected-explanation-overlay';
const files = ['chrome-flow.json', 'copied-explanation.json', 'changed.png', 'unknown.png'];
const checks = {};
const diagnostics = { warnings: [], errors: [], pageErrors: [] };
const failures = [];
let browser;
let server;
let browserVersion = '';
let bundleHash = '';
let copiedEvidence = '';
let changedScreenshot;
let unknownScreenshot;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => createHash('sha256').update(value).digest('hex');
function check(value, name) { checks[name] = Boolean(value); if (!value) failures.push(`failed check: ${name}`); }

async function ready() {
  for (let end = Date.now() + 60000; Date.now() < end; await wait(200)) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('Vite exited before readiness');
    try { if ((await fetch(url)).ok) return; } catch {}
  }
  throw new Error('Vite did not start on strict port 5204');
}

async function stopServer() {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  process.kill(-server.pid, 'SIGTERM');
  await Promise.race([once(server, 'exit'), wait(5000)]);
  if (server.exitCode === null && server.signalCode === null) {
    process.kill(-server.pid, 'SIGKILL');
    await once(server, 'exit');
  }
}

async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }

async function visibleOverlayText(page) {
  return page.locator('[data-canvas-scan]').evaluate(node => node.shadowRoot.querySelector('.dock')?.innerText ?? '');
}

function findingLabel(type) {
  return {
    'heavy-canvas-work': 'Heavy canvas work',
    'repeated-draw-work': 'Repeated draw commands',
    'resize-churn': 'Canvas resets during active work',
    'backing-store-mismatch': 'Large canvas backing store',
  }[type];
}

function commandSummary(command) {
  if (!command) return 'No command exists at this ordinal.';
  return `${command.operationKind} ${command.name} · ${command.argumentCount} arguments · ${command.arguments.map(argument => argument.kind).join(', ') || 'none'}`;
}

function shownChangedEvidence(artifact) {
  const difference = artifact.firstDifference;
  if (!difference) return null;
  const comparison = artifact.comparisons.find(item => item.difference?.referenceWindowIndex === difference.referenceWindowIndex && item.difference?.targetWindowIndex === difference.targetWindowIndex && item.difference?.ordinal === difference.ordinal && item.difference?.reason === difference.reason);
  if (!comparison) return null;
  const expected = [
    `Source finding: ${artifact.source.findingIndex + 1} · ${findingLabel(artifact.source.findingType)}`,
    `Stop reason: ${artifact.stopReason}`,
    `Command result: ${comparison.status}`,
    `Command ${difference.ordinal}:`,
    `Reference command: ${commandSummary(difference.reference)}`,
    `Target command: ${commandSummary(difference.target)}`,
    `Compared frame indices: ${comparison.referenceWindowIndex} and ${comparison.targetWindowIndex}`,
    ...Object.entries(artifact.collectionLimits).map(([name, value]) => `${name}=${value}`),
  ];
  const drops = Object.entries(artifact.droppedEntryCounts).filter(([, value]) => value > 0);
  if (drops.length) expected.push(`Drops: ${drops.map(([name, value]) => `${name}=${value}`).join(' · ')}`);
  if (artifact.firstGap) expected.push(`First gap: window ${artifact.firstGap.windowIndex}, command ${artifact.firstGap.commandOrdinal ?? 'none'} (${artifact.firstGap.reason})`);
  return { difference, expected };
}

async function makeSource(page) {
  await page.locator('#source').click();
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-canvas-scan]')?.shadowRoot;
    return root?.querySelector('[aria-label="Stop recording"]')?.disabled === false;
  });
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-canvas-scan]')?.shadowRoot;
    return root?.querySelector('[aria-label="Stop recording"]')?.disabled === true;
  }, { timeout: 5000 });
  const action = page.locator('.explanation-action').first();
  if (!await action.isVisible()) await page.locator('.finding-toggle').first().click();
  await action.waitFor();
  return action;
}

async function startExplanation(page, mode, automatic = false) {
  const action = await makeSource(page);
  if (mode === 'unknown') {
    await action.focus();
    await page.keyboard.press('Enter');
  } else if (mode === 'same') {
    await action.focus();
    await page.keyboard.press('Space');
  } else {
    await action.click();
  }
  const active = page.locator('.explanation-panel', { hasText: 'EXPLANATION ACTIVE' });
  await active.waitFor();
  if (mode === 'unknown') check(await active.isVisible(), 'explanationEnterActivated');
  if (mode === 'same') check(await active.isVisible(), 'explanationSpaceActivated');
  await page.locator(`#${mode}`).click();
  await page.waitForFunction(() => window.__V05_04__.replayComplete);
  if (automatic) await page.locator('.explanation-panel', { hasText: 'EXPLANATION COMPLETE' }).waitFor({ timeout: 13000 });
  else {
    const stop = page.locator('[aria-label="Stop recording"]');
    await stop.focus();
    await stop.click();
    await page.locator('.explanation-panel', { hasText: 'EXPLANATION COMPLETE' }).waitFor();
  }
  await settle(page);
}

try {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'run', 'build'], { cwd: root, stdio: 'inherit' });
  const bundle = path.join(root, 'packages/core/dist/canvas-scan.iife.js');
  await cp(bundle, path.join(root, 'apps/workbench/public/canvas-scan.iife.js'));
  bundleHash = hash(await readFile(bundle));
  server = spawn('pnpm', ['--filter', 'workbench', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, detached: true, stdio: 'ignore' });
  await ready();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  browserVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'warning') diagnostics.warnings.push(message.text()); if (message.type() === 'error') diagnostics.errors.push(message.text()); });
  page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'load' });
  await settle(page);
  await page.locator('.counts').click();

  await startExplanation(page, 'changed');
  const changedPanel = page.locator('.explanation-panel');
  const changedText = await changedPanel.innerText();
  const changedVisible = await visibleOverlayText(page);
  check(changedText.includes('Command result: changed') && changedText.includes('First normalized command difference') && changedText.includes('Reference command:') && changedText.includes('Target command:'), 'changedPointerPanel');
  const copy = page.locator('.explanation-copy');
  await copy.focus();
  check(await copy.evaluate(node => node.getRootNode().activeElement === node), 'copyKeyboardFocus');
  changedScreenshot = await changedPanel.screenshot();
  await copy.click();
  await page.locator('.explanation-copy-status', { hasText: 'Explanation JSON copied' }).waitFor();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  copiedEvidence = copied;
  check(copied === await page.evaluate(() => JSON.stringify(window.__CANVAS_SCAN__.getLastExplanation())), 'copiedArtifact');
  const copiedArtifact = JSON.parse(copied);
  check(copiedArtifact.firstDifference?.ordinal === 1 && copiedArtifact.firstDifference?.reason === 'argument-token' && copiedArtifact.firstDifference?.reference?.name === 'fillRect' && copiedArtifact.firstDifference?.target?.name === 'fillRect', 'changedFixtureTruth');
  const changedTokens = copiedArtifact.windows.flatMap(window => window.commands).flatMap(command => command.arguments).map(argument => argument.token).filter(Boolean);
  const changedPrivateValues = ['#123456', '918273.645', '771928.125'];
  check(changedPrivateValues.every(value => !changedVisible.includes(value)) && changedTokens.every(token => !changedVisible.includes(token)), 'changedPrivateValuesHidden');
  const shownEvidence = shownChangedEvidence(copiedArtifact);
  check(Boolean(shownEvidence) && shownEvidence.expected.every(value => changedText.includes(value)) && await changedPanel.locator(`[title="${shownEvidence?.difference.reason}"]`).count() === 1, 'shownEvidenceInCopiedJson');

  await page.evaluate(() => navigator.clipboard.writeText('canvas-scan-keyboard-copy-sentinel'));
  await copy.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(expected => navigator.clipboard.readText().then(value => value === expected), copied);
  check(await copy.evaluate(node => node.getRootNode().activeElement === node), 'copyKeyboardActivated');

  await page.locator('[data-canvas-scan]').evaluate(node => node.remove());
  await page.waitForTimeout(1100);
  check(await page.locator('[data-canvas-scan]').count() === 1, 'hostReattached');
  await page.locator('.counts').click();
  const record = page.locator('[aria-label="Record investigation"]');
  await record.focus();
  await page.keyboard.press('Enter');
  const sharedStop = page.locator('[aria-label="Stop recording"]');
  await sharedStop.focus();
  await page.keyboard.press('Enter');
  check(await sharedStop.evaluate(node => node.getRootNode().activeElement === node), 'sharedStopKeyboard');

  await startExplanation(page, 'unknown', true);
  const unknown = await page.evaluate(() => window.__CANVAS_SCAN__.getLastExplanation());
  check(unknown.firstDifference === null && unknown.comparisons.some(comparison => comparison.status === 'unknown' && comparison.unknownReason === 'unsupported-value'), 'unknownArtifact');
  const unknownPanel = page.locator('.explanation-panel');
  const unknownText = await unknownPanel.innerText();
  const unknownVisible = await visibleOverlayText(page);
  checks.unknownPanelText = unknownText;
  check(unknownText.includes('Command result: unknown') && unknownText.includes('Command difference is unknown.') && unknownText.includes('unsupported-value') && unknownText.includes('First gap:'), 'unknownKeyboardPanel');
  const unknownPrivateValues = ['#123456', '918273.645', 'privateFixtureKey', 'private fixture object value', 'privateFixtureFunction', 'private fixture function source', 'secret.example.invalid', 'private-path', 'private-query', 'private-fragment', '987654.321'];
  const unknownTokens = unknown.windows.flatMap(window => window.commands).flatMap(command => command.arguments).map(argument => argument.token).filter(Boolean);
  check(unknownPrivateValues.every(value => !unknownVisible.includes(value)) && unknownTokens.every(token => !unknownVisible.includes(token)), 'unknownPrivateValuesHidden');
  unknownScreenshot = await unknownPanel.screenshot();

  await startExplanation(page, 'same');
  const same = await page.evaluate(() => window.__CANVAS_SCAN__.getLastExplanation());
  const sameText = await page.locator('.explanation-panel').innerText();
  const sameVisible = await visibleOverlayText(page);
  checks.samePanelText = sameText;
  const sameComparison = same.comparisons.at(-1);
  const sameReference = same.windows.find(window => window.windowIndex === sameComparison?.referenceWindowIndex);
  const sameTarget = same.windows.find(window => window.windowIndex === sameComparison?.targetWindowIndex);
  check(same.firstDifference === null && sameComparison?.status === 'same' && sameComparison.difference === null && sameComparison.unknownReason === null, 'sameArtifact');
  check(sameText.includes('Command result: same') && sameText.includes('No normalized command difference was observed.') && sameText.includes(`Compared windows: ${sameComparison.referenceWindowIndex} (${sameReference.commands.length} commands) and ${sameComparison.targetWindowIndex} (${sameTarget.commands.length} commands).`), 'samePanel');
  const sameTokens = same.windows.flatMap(window => window.commands).flatMap(command => command.arguments).map(argument => argument.token).filter(Boolean);
  const samePrivateValues = ['#123456', '918273.645'];
  check(samePrivateValues.every(value => !sameVisible.includes(value)) && sameTokens.every(token => !sameVisible.includes(token)), 'samePrivateValuesHidden');
  const action = await makeSource(page);
  await page.locator('.counts').click();
  await page.locator('#retire').click();
  await page.locator('.counts').click();
  await settle(page);
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-canvas-scan]')?.shadowRoot;
    const action = root?.querySelector('.explanation-action');
    return action?.hidden === true;
  });
  check(!await action.isVisible() && (await page.locator('.finding-card').first().innerText()).includes('Capture cannot start because the canvas is not on the page. Saved evidence remains available.'), 'retiredUnavailable');
  checks.privateValuesHidden = checks.changedPrivateValuesHidden && checks.unknownPrivateValuesHidden && checks.samePrivateValuesHidden;
  check(diagnostics.warnings.length === 0 && diagnostics.errors.length === 0 && diagnostics.pageErrors.length === 0, 'browserDiagnostics');
  await context.close();
} catch (error) {
  failures.push(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  try { await browser?.close(); } catch (error) { failures.push(String(error)); }
  try { await stopServer(); } catch (error) { failures.push(String(error)); }
}

if (!failures.length) {
  try {
    if (!copiedEvidence || !changedScreenshot || !unknownScreenshot) throw new Error('browser flow did not produce complete buffered evidence');
    await writeFile(path.join(dir, 'copied-explanation.json'), copiedEvidence);
    await writeFile(path.join(dir, 'changed.png'), changedScreenshot);
    await writeFile(path.join(dir, 'unknown.png'), unknownScreenshot);
    for (const file of files.filter(file => file !== 'chrome-flow.json')) {
      const bytes = await readFile(path.join(dir, file));
      check(bytes.length > 0, `file:${file}`);
      if (file.endsWith('.png')) check(bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', `png:${file}`);
      if (file.endsWith('.json')) JSON.parse(bytes.toString('utf8'));
    }
  } catch (error) {
    failures.push(String(error));
  }
}

function result() {
  return { status: failures.length ? 'FAIL' : 'PASS', chromeVersion: browserVersion, gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirty: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim(), bundleSha256: bundleHash, checks, diagnostics, failures };
}

async function writeFlow() {
  await writeFile(path.join(dir, 'chrome-flow.json'), JSON.stringify(result(), null, 2));
}

async function writeManifest() {
  const manifest = await Promise.all(files.map(async file => `${file} ${hash(await readFile(path.join(dir, file)))}`));
  await writeFile(path.join(dir, 'evidence-sha256.txt'), manifest.join('\n') + '\n');
}

async function manifestProblems() {
  const lines = (await readFile(path.join(dir, 'evidence-sha256.txt'), 'utf8')).trim().split('\n');
  const problems = [];
  for (const file of files) {
    const bytes = await readFile(path.join(dir, file));
    if (!lines.includes(`${file} ${hash(bytes)}`)) problems.push(`hash mismatch: ${file}`);
  }
  return problems;
}

try {
  await writeFlow();
} catch (error) {
  failures.push(String(error));
  try { await writeFlow(); } catch {}
}
if (!failures.length) {
  try {
    await writeManifest();
    failures.push(...await manifestProblems());
    if (failures.length) {
      await writeFlow();
      await writeManifest();
    }
  } catch (error) {
    failures.push(String(error));
    try { await writeFlow(); } catch {}
  }
}
if (failures.length) { console.error('SIDPROJ_67_SELECTED_EXPLANATION_OVERLAY: FAIL'); process.exitCode = 1; }
else console.log('SIDPROJ_67_SELECTED_EXPLANATION_OVERLAY: PASS');
