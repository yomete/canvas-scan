import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 5199;
const url = `http://127.0.0.1:${port}`;
const artifactPaths = [
  '/private/tmp/sidproj-54-overlay-recording.png',
  '/private/tmp/sidproj-54-overlay-empty.png',
  '/private/tmp/sidproj-54-overlay-findings.png',
  '/private/tmp/sidproj-54-overlay-limit.png',
  '/private/tmp/sidproj-54-overlay-unsupported.png',
  '/private/tmp/sidproj-54-findings-session.json',
  '/private/tmp/sidproj-54-copied-session.json',
  '/private/tmp/sidproj-54-plain-language-copy.txt',
  '/private/tmp/sidproj-54-chrome-probe.json',
];
const manifestPath = '/private/tmp/sidproj-54-evidence-sha256.txt';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const failures = [];
const checks = {};
const diagnostics = {};
let server;
let browser;
let browserVersion;
let bundleHash;
let gitSha;

function check(value, name) {
  checks[name] = Boolean(value);
  if (!value) failures.push(`failed check: ${name}`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function ready() {
  for (let end = Date.now() + 60000; Date.now() < end; await wait(250)) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Vite exited before readiness with code ${server.exitCode ?? server.signalCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
  }
  throw new Error('Vite did not start on strict port 5199');
}

async function stopServer() {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  process.kill(-server.pid, 'SIGTERM');
  await Promise.race([once(server, 'exit'), wait(5000)]);
  if (server.exitCode === null && server.signalCode === null) throw new Error('Vite did not stop after SIGTERM');
}

function watch(page, name) {
  const state = { warnings: [], errors: [], pageErrors: [] };
  diagnostics[name] = state;
  page.on('console', message => {
    if (message.type() === 'warning') state.warnings.push(message.text());
    if (message.type() === 'error') state.errors.push(message.text());
  });
  page.on('pageerror', error => state.pageErrors.push(error.message));
  return state;
}

async function openCase(name) {
  const context = await browser.newContext({ viewport: { width: 960, height: 720 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  watch(page, name);
  await page.goto(`${url}/v04-09-findings.html?case=${name}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__V04_09__ && !window.__V04_09_ERROR__);
  return { context, page };
}

async function settleOverlay(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function closeCase(context, name) {
  const state = diagnostics[name];
  check(state.warnings.length === 0 && state.errors.length === 0 && state.pageErrors.length === 0, `${name}Diagnostics`);
  await context.close();
}

async function captureSimpleCase(name, requiredTexts) {
  const { context, page } = await openCase(name);
  if (name === 'recording') {
    await page.locator('.counts').click();
    await page.locator('.recording-session').waitFor();
    check(await page.locator('[aria-label="Stop recording"]').isEnabled(), 'recordingStopEnabled');
  } else {
    await page.locator('.session-heading', { hasText: 'Recording complete' }).waitFor();
  }
  const flyoutText = await page.locator('.flyout').innerText();
  check(requiredTexts.every(text => flyoutText.includes(text)), `${name}RequiredCopy`);
  await page.screenshot({ path: `/private/tmp/sidproj-54-overlay-${name}.png` });
  await closeCase(context, name);
}

function findingOrder(session) {
  return session.findings.map(finding => `${finding.type}:${finding.canvasId}`);
}

function expectedFindingOrder(session) {
  return session.findings.map((finding, index) => ({ finding, index })).sort((left, right) =>
    right.finding.canvasApiSelfTimeMs - left.finding.canvasApiSelfTimeMs ||
    right.finding.rasterOperationCount - left.finding.rasterOperationCount ||
    left.finding.type.localeCompare(right.finding.type) ||
    left.finding.canvasId.localeCompare(right.finding.canvasId) ||
    left.index - right.index).map(({ finding }) => `${finding.type}:${finding.canvasId}`);
}

async function runFindingsCase() {
  const { context, page } = await openCase('findings');
  const record = page.locator('[aria-label="Record investigation"]');
  await record.focus();
  await page.keyboard.press('Enter');
  check(await page.locator('[aria-label="Stop recording"]').isEnabled(), 'keyboardStartedRecording');

  await page.locator('#pointer').click();
  await page.locator('#keyboard').focus();
  await page.keyboard.press('Enter');
  await page.evaluate(() => window.__V04_09__.settleFindings());
  await page.evaluate(() => window.__V04_09__.retireSavedCanvas());

  const stop = page.locator('[aria-label="Stop recording"]');
  await stop.focus();
  await page.keyboard.press('Enter');
  await page.locator('.session-heading', { hasText: 'Recording complete' }).waitFor();
  check(await stop.evaluate(node => node.getRootNode().activeElement === node), 'stopFocusPreserved');

  const session = await page.evaluate(() => window.__CANVAS_SCAN__.getLastSession());
  const shownBytes = JSON.stringify(session);
  await writeFile('/private/tmp/sidproj-54-findings-session.json', shownBytes);
  check(Boolean(session), 'completedSession');
  check(new Set(session.findings.map(finding => finding.type)).size === 4 && ['heavy-canvas-work', 'repeated-draw-work', 'resize-churn', 'backing-store-mismatch'].every(type => session.findings.some(finding => finding.type === type)), 'allFindingTypes');
  check(JSON.stringify(findingOrder(session)) === JSON.stringify(expectedFindingOrder(session)), 'canonicalFindingOrder');
  check(JSON.stringify(session.canvases.map(canvas => canvas.canvasId)) === JSON.stringify(session.canvases.map((canvas, index) => ({ canvas, index })).sort((left, right) => right.canvas.canvasApiSelfTimeMs - left.canvas.canvasApiSelfTimeMs || right.canvas.maxWindowSelfTimeMs - left.canvas.maxWindowSelfTimeMs || right.canvas.rasterOperationCount - left.canvas.rasterOperationCount || left.canvas.canvasId.localeCompare(right.canvas.canvasId) || left.index - right.index).map(({ canvas }) => canvas.canvasId)), 'canonicalCanvasOrder');
  check(JSON.stringify(await page.locator('.canvas-summary').evaluateAll(nodes => nodes.map(node => node.dataset.sessionCanvasId))) === JSON.stringify(session.canvases.map(canvas => canvas.canvasId)), 'renderedCanvasOrder');
  check((await page.locator('.candidate-count').textContent()).includes(`${session.findings.length} review`), 'completedCandidateCount');

  const renderedTypes = await page.locator('.finding-card .raw-evidence').evaluateAll(nodes => nodes.map(node => node.textContent.match(/type=([^ ]+)/)?.[1]));
  check(JSON.stringify(renderedTypes) === JSON.stringify(session.findings.map(finding => finding.type)), 'renderedFindingOrder');
  check(await page.locator('.finding-card').count() === session.findings.length, 'findingCardCount');
  check(await page.locator('.findings-list').textContent().then(text => ['Observed:', 'Explanation:', 'Does not establish:', 'Unknown coverage:', 'Next check:', 'Review candidate'].every(label => text.includes(label))), 'findingEvidenceOrder');
  check(await page.locator('.finding-card').evaluateAll(cards => cards.every(card => /type=.+evidenceLevel=candidate canvasId=.+episodeIds=/.test(card.querySelector('.raw-evidence')?.textContent ?? ''))), 'rawFindingCodes');
  check(await page.locator('.finding-card').evaluateAll(cards => cards.every(card => {
    const text = card.textContent ?? '';
    return !/caused|wasted|pixel-identical/i.test(text) && (!/avoidable/i.test(text) || /does not establish[^.]*avoidable/i.test(text));
  })), 'safeFindingClaims');
  check(await page.locator('.finding-card').evaluateAll(cards => {
    const lines = cards.flatMap(card => [...card.querySelectorAll('.finding-line')].map(line => line.textContent ?? '')).filter(line => /associated with|overlapped/.test(line));
    return lines.length > 0 && lines.every(line => /associated with|overlapped/.test(line));
  }), 'associationLanguage');
  check(await page.locator('.completed-session > .finding-line').count() === 0, 'noGlobalAssociations');

  const controls = page.locator('.finding-toggle');
  if (await controls.first().getAttribute('aria-expanded') === 'true') {
    await controls.first().click();
    await settleOverlay(page);
  }
  await controls.first().focus();
  const firstKey = await controls.first().getAttribute('data-finding-id');
  await page.keyboard.press('ArrowDown');
  const downKey = await page.evaluate(() => document.querySelector('[data-canvas-scan]').shadowRoot.activeElement?.dataset.findingId);
  await page.keyboard.press('ArrowUp');
  const upKey = await page.evaluate(() => document.querySelector('[data-canvas-scan]').shadowRoot.activeElement?.dataset.findingId);
  await page.keyboard.press('End');
  const endKey = await page.evaluate(() => document.querySelector('[data-canvas-scan]').shadowRoot.activeElement?.dataset.findingId);
  await page.keyboard.press('Home');
  const homeKey = await page.evaluate(() => document.querySelector('[data-canvas-scan]').shadowRoot.activeElement?.dataset.findingId);
  await page.keyboard.press('Enter');
  await settleOverlay(page);
  const enterExpanded = await controls.first().getAttribute('aria-expanded');
  await page.keyboard.press('Enter');
  await settleOverlay(page);
  const enterCollapsed = await controls.first().getAttribute('aria-expanded');
  await page.keyboard.press(' ');
  await settleOverlay(page);
  check(downKey && downKey !== firstKey && upKey === firstKey && endKey === await controls.last().getAttribute('data-finding-id') && homeKey === firstKey && enterExpanded === 'true' && enterCollapsed === 'false' && await controls.first().getAttribute('aria-expanded') === 'true', 'findingKeyboardNavigation');

  const stableControl = controls.first();
  const stable = await stableControl.evaluate(node => { window.__SIDPROJ_54_CONTROL__ = node; return true; });
  await page.locator('#pointer').click();
  await page.evaluate(() => window.__V04_09__.settleFindings());
  check(stable && await stableControl.evaluate(node => node === window.__SIDPROJ_54_CONTROL__ && node.isConnected), 'stableFindingControl');

  const detachedId = session.findings.find(finding => finding.canvasId.includes('detached-saved'))?.canvasId;
  const retiredId = session.findings.find(finding => finding.canvasId.includes('retired-saved'))?.canvasId;
  const connectedId = session.findings.find(finding => finding.type === 'heavy-canvas-work' && finding.canvasId.includes('heavy'))?.canvasId;
  const card = id => page.locator(`.finding-card[data-canvas-id="${id}"]`).first();
  if (retiredId && await card(retiredId).locator('.finding-evidence').isHidden()) {
    await card(retiredId).locator('.finding-toggle').click();
    await settleOverlay(page);
  }
  const detachedEvents = session.lifecycleEvents.filter(event => event.canvasId === detachedId);
  check(detachedEvents.some(event => event.type === 'detached') && detachedEvents.at(-1)?.type === 'detached', 'distinctSavedDetachEvent');
  check(Boolean(detachedId) && await card(detachedId).locator('.finding-actions').evaluate(node => node.hidden), 'detachedHasNoActions');
  check(Boolean(retiredId) && await card(retiredId).innerText().then(text => text.includes('The recorded canvas retired. Saved evidence remains available.')) && await card(retiredId).locator('.finding-actions').evaluate(node => node.hidden), 'retiredSavedEvidence');
  check(Boolean(connectedId) && !(await card(connectedId).locator('.finding-actions').evaluate(node => node.hidden)), 'connectedHasActions');

  await page.evaluate(() => window.__V04_09__.reactivateAfterStop());
  await page.waitForTimeout(300);
  check(!(await card(retiredId).locator('.finding-actions').evaluate(node => node.hidden)) && await card(retiredId).innerText().then(text => text.includes('The recorded canvas retired. Saved evidence remains available.')), 'reactivatedKeepsSavedLifecycle');

  const connectedCard = card(connectedId);
  if (await connectedCard.locator('.finding-evidence').isHidden()) {
    await connectedCard.locator('.finding-toggle').click();
    await settleOverlay(page);
  }
  await page.locator('#heavy').evaluate(node => { node.style.visibility = 'hidden'; });
  await connectedCard.locator('[data-action="locate-current"]').click();
  check(await connectedCard.locator('.finding-status').textContent() === 'The canvas is connected but is not visible.' && await connectedCard.locator('.finding-status').count() === 1, 'hiddenLocateStatus');
  await connectedCard.locator('[data-action="locate-current"]').click();
  check(await connectedCard.locator('.finding-status').count() === 1, 'hiddenLocateStableNode');
  await page.locator('#heavy').evaluate(node => { node.style.visibility = 'visible'; });
  await connectedCard.locator('[data-action="locate-current"]').click();
  await settleOverlay(page);
  check(await page.locator(`.outline[data-canvas-id="${connectedId}"]`).count() === 1 && await page.locator(`.outline[data-canvas-id="${connectedId}"]`).evaluate(node => node.classList.contains('locate')), 'pointerLocateOnce');
  await connectedCard.locator('[data-action="inspect-current"]').click();
  await settleOverlay(page);
  check(await page.locator('.popover').isVisible(), 'pointerInspectOnce');
  await page.keyboard.press('Escape');
  await settleOverlay(page);
  check(await page.locator('.flyout').isVisible() && await connectedCard.locator('[data-action="inspect-current"]').evaluate(node => node.getRootNode().activeElement === node), 'escapeReturnsToInvoker');

  await page.locator('[aria-label="Inspect canvases"]').click();
  await settleOverlay(page);
  const outline = page.locator(`.outline[data-canvas-id="${connectedId}"]`);
  await outline.click();
  await settleOverlay(page);
  check(await page.locator('.flyout').isVisible() && await connectedCard.locator('.finding-toggle').getAttribute('aria-expanded') === 'true' && await connectedCard.locator('.finding-toggle').evaluate(node => node.getRootNode().activeElement === node), 'redOutlineFocusesSavedFinding');
  check(JSON.stringify(session.findings) === JSON.stringify((await page.evaluate(() => window.__CANVAS_SCAN__.getLastSession())).findings), 'redOutlineDoesNotReplaceFindings');

  const toolbar = await page.locator('.toolbar').boundingBox();
  const beforeTransform = await page.locator('.dock').evaluate(node => node.style.transform);
  await page.mouse.move(toolbar.x + 2, toolbar.y + 2);
  await page.mouse.down();
  await page.mouse.move(toolbar.x - 18, toolbar.y - 18);
  await page.mouse.up();
  const afterTransform = await page.locator('.dock').evaluate(node => node.style.transform);
  check(beforeTransform !== afterTransform, 'toolbarBackgroundDrag');
  await page.locator('#pass-through').click();
  check(await page.locator('#pass-through span').textContent() === '1', 'applicationPointerPassThrough');

  await page.locator('.session-copy').focus();
  await page.keyboard.press('Enter');
  await page.locator('.session-copy-status', { hasText: 'Session JSON copied' }).waitFor();
  const copiedBytes = await page.evaluate(() => navigator.clipboard.readText());
  check(copiedBytes === shownBytes, 'immutableSessionExport');
  const mutatedCopy = JSON.parse(copiedBytes);
  mutatedCopy.findings.length = 0;
  await page.locator('.session-copy').click();
  await page.waitForTimeout(50);
  const copiedAgain = await page.evaluate(() => navigator.clipboard.readText());
  await writeFile('/private/tmp/sidproj-54-copied-session.json', copiedAgain);
  check(copiedAgain === shownBytes && mutatedCopy.findings.length === 0, 'copiedPayloadMutationIsolated');
  check(JSON.stringify(await page.evaluate(() => window.__CANVAS_SCAN__.getLastSession())) === shownBytes, 'publicSessionStillMatches');

  const plainCopy = await page.locator('.completed-session').evaluate(rootNode => {
    const copy = rootNode.cloneNode(true);
    copy.querySelectorAll('.raw-evidence').forEach(node => node.remove());
    return copy.textContent;
  });
  await writeFile('/private/tmp/sidproj-54-plain-language-copy.txt', plainCopy);
  check(!/caused|wasted|pixel-identical/i.test(plainCopy) && (!/avoidable/i.test(plainCopy) || /does not establish[^.]*avoidable/i.test(plainCopy)), 'plainLanguageSafe');
  check(plainCopy.includes('Canvas2D API self-time') && plainCopy.includes('review candidate'), 'plainLanguageApprovedTerms');

  await page.screenshot({ path: '/private/tmp/sidproj-54-overlay-findings.png' });
  await closeCase(context, 'findings');
}

async function validateArtifacts() {
  for (const artifactPath of artifactPaths.slice(0, -1)) {
    try {
      check((await stat(artifactPath)).size > 0, `artifact:${path.basename(artifactPath)}`);
    } catch {
      check(false, `artifact:${path.basename(artifactPath)}`);
    }
  }
  const shown = await readFile('/private/tmp/sidproj-54-findings-session.json');
  const copied = await readFile('/private/tmp/sidproj-54-copied-session.json');
  JSON.parse(shown);
  JSON.parse(copied);
  check(shown.equals(copied), 'sessionArtifactsByteEqual');
}

async function writeResultAndManifest() {
  const result = () => ({ status: failures.length ? 'FAIL' : 'PASS', browserVersion, gitSha, bundleHash, checks, diagnostics, failures });
  await writeFile('/private/tmp/sidproj-54-chrome-probe.json', `${JSON.stringify(result(), null, 2)}\n`);
  let entries = [];
  for (const artifactPath of artifactPaths) {
    const bytes = await readFile(artifactPath);
    entries.push(`${artifactPath} ${sha256(bytes)}`);
  }
  await writeFile(manifestPath, `${entries.join('\n')}\n`);
  check(entries.length === artifactPaths.length && entries.every((entry, index) => entry.startsWith(`${artifactPaths[index]} `)), 'hashManifest');
  if (failures.length) {
    await writeFile('/private/tmp/sidproj-54-chrome-probe.json', `${JSON.stringify(result(), null, 2)}\n`);
    entries = [];
    for (const artifactPath of artifactPaths) entries.push(`${artifactPath} ${sha256(await readFile(artifactPath))}`);
    await writeFile(manifestPath, `${entries.join('\n')}\n`);
  }
}

try {
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'run', 'build'], { cwd: root, stdio: 'inherit' });
  gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const bundle = path.join(root, 'packages/core/dist/canvas-scan.iife.js');
  const bundleBytes = await readFile(bundle);
  bundleHash = sha256(bundleBytes);
  await copyFile(bundle, path.join(root, 'apps/workbench/public/canvas-scan.iife.js'));
  server = spawn('pnpm', ['--filter', 'workbench', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, detached: true, stdio: 'ignore' });
  await ready();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  browserVersion = browser.version();
  await captureSimpleCase('recording', ['Recording…']);
  await captureSimpleCase('empty', ['Recording complete', 'No Canvas2D activity occurred during this recording.', 'Record again and reproduce the canvas interaction before you stop.', 'FINDINGS']);
  await runFindingsCase();
  await captureSimpleCase('limit', ['Recording complete', 'were dropped', 'droppedEntryCounts.userMarks=', 'CANVAS WORK', 'FINDINGS']);
  await captureSimpleCase('unsupported', ['Recording complete', 'This browser did not provide Event Timing.', 'browserFeatures.eventTiming=false', 'This browser did not provide Long Animation Frame entries.', 'browserFeatures.longAnimationFrames=false', 'CANVAS WORK', 'FINDINGS']);
} catch (error) {
  failures.push(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  try { await browser?.close(); } catch (error) { failures.push(`Chrome cleanup failed: ${error}`); }
  try { await stopServer(); } catch (error) { failures.push(`Vite cleanup failed: ${error}`); }
}

try {
  await validateArtifacts();
  await writeResultAndManifest();
} catch (error) {
  failures.push(error instanceof Error ? error.stack ?? error.message : String(error));
  await writeFile('/private/tmp/sidproj-54-chrome-probe.json', `${JSON.stringify({ status: 'FAIL', browserVersion, gitSha, bundleHash, checks, diagnostics, failures }, null, 2)}\n`);
}

if (failures.length) {
  console.error(`CANVAS_FINDINGS_V04_09: FAIL ${failures.join('; ')}`);
  process.exitCode = 1;
} else {
  console.log('CANVAS_FINDINGS_V04_09: PASS');
}
