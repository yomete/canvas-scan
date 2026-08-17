import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { runDiskMutations } from './lab-v05-mutations.mjs';
import { expectedMatrix, sessionFor } from './session-comparison-fixture.mjs';
import { checkEvidence, deriveRows } from './lab-v05-truth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultDirectory = '/private/tmp/sidproj-69-v05-lab-evidence';
const checkIndex = process.argv.indexOf('--check-evidence');
const directory = checkIndex >= 0 ? (process.argv[checkIndex + 1] || defaultDirectory) : defaultDirectory;
const fixturePath = path.join(root, 'apps/workbench/public/v05-lab.html');
const bundlePath = path.join(root, 'packages/core/dist/canvas-scan.iife.js');
const packagePath = path.join(root, 'packages/core/package.json');
const port = 5209;
const origin = `http://127.0.0.1:${port}`;
const pageUrl = `${origin}/v05-lab.html`;
const aggregateRunId = randomUUID();
const commandRuns = [];
const browserCollectorCommand = 'internal real-Chrome comparison and integrated flow';
const stable = value => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const status = () => command(['git', 'status', '--short', '--untracked-files=all']).stdout;
const write = (name, value) => writeFile(path.join(directory, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : stable(value));
const readJson = async name => JSON.parse(await readFile(path.join(directory, name), 'utf8'));
const serverFailures = [];
const releaseMode = process.env.SIDPROJ_70_RELEASE === '1';

function command(parts, options = {}) {
  const startedAt = new Date().toISOString();
  const attempts = options.attempts ?? 1;
  delete options.attempts;
  const history = [];
  let result;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    result = spawnSync(parts[0], parts.slice(1), { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...options });
    history.push({ attempt, exitCode: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' });
    if (result.status === 0) break;
  }
  const endedAt = new Date().toISOString();
  const redact = value => String(value ?? '')
    .replace(/sourcesContent/gi, '[redacted source-content field]')
    .replace(/private-(?:query|fragment|path)/gi, '[redacted URL part]')
    .replace(/secret\.example\.invalid/gi, '[redacted host]');
  const previous = history.slice(0, -1).map(item => `ATTEMPT ${item.attempt} EXIT: ${item.exitCode}\nSTDOUT:\n${redact(item.stdout)}\nSTDERR:\n${redact(item.stderr)}`).join('\n');
  const output = `COMMAND: ${parts.join(' ')}\nEXIT: ${result.status ?? 1}\nATTEMPTS: ${history.length}\n${previous ? `${previous}\n` : ''}STDOUT:\n${redact(result.stdout)}\nSTDERR:\n${redact(result.stderr)}`;
  if (result.status !== 0) throw new Error(output);
  return { ...result, output, startedAt, endedAt };
}

function recordedCommand(parts, attempts = 1) {
  const result = command(parts, { attempts });
  commandRuns.push({ runId: aggregateRunId, command: parts.join(' '), startedAt: result.startedAt, endedAt: result.endedAt, exitCode: result.status });
  return result;
}

async function files(relative = '') {
  const result = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await files(next));
    else result.push(next);
  }
  return result.sort();
}

async function nestedFiles(base, relative = '') {
  const result = [];
  for (const entry of await readdir(path.join(base, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await nestedFiles(base, next));
    else result.push(next);
  }
  return result.sort();
}

async function writeDirectoryManifest(base) {
  const names = (await nestedFiles(base)).filter(name => name !== 'evidence-sha256.txt').sort();
  const lines = await Promise.all(names.map(async name => `${sha256(await readFile(path.join(base, name)))}  ${name}`));
  await writeFile(path.join(base, 'evidence-sha256.txt'), `${lines.join('\n')}\n`);
}

async function writeManifest() {
  const names = (await files()).filter(name => name !== 'evidence-sha256.txt').sort();
  const lines = await Promise.all(names.map(async name => `${sha256(await readFile(path.join(directory, name)))}  ${name}`));
  await write('evidence-sha256.txt', `${lines.join('\n')}\n`);
}

async function copyCommandEvidence() {
  const source = '/private/tmp/sidproj-72-command-evidence';
  const target = path.join(directory, 'raw/command');
  await mkdir(target, { recursive: true });
  for (const name of ['manifest.json', 'expected-results.json', 'actual-results.json', 'privacy-results.json', 'allocation-counter.json']) await cp(path.join(source, name), path.join(target, name));
  await cp(path.join(source, 'artifacts'), path.join(target, 'artifacts'), { recursive: true });
}

async function copyEvidence(source, name) {
  await cp(source, path.join(directory, `raw/${name}`), { recursive: true });
}

function observe(page, diagnostics) {
  page.on('console', message => {
    if (message.type() === 'warning') diagnostics.warnings.push(message.text());
    if (message.type() === 'error') diagnostics.errors.push(message.text());
  });
  page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', request => diagnostics.requestFailures.push(`${request.method()} ${new URL(request.url()).pathname}`));
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function runChrome(bundle, fixture, diagnostics) {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, origin).pathname;
    if (pathname === '/canvas-scan.iife.js') {
      response.writeHead(200, { 'content-type': 'text/javascript', 'content-length': String(bundle.byteLength), 'cache-control': 'no-store' });
      response.end(bundle);
      return;
    }
    if (pathname === '/' || pathname === '/v05-lab.html') {
      response.writeHead(200, { 'content-type': 'text/html', 'content-length': String(fixture.byteLength), 'cache-control': 'no-store' });
      response.end(fixture);
      return;
    }
    if (pathname === '/favicon.ico') {
      response.writeHead(204, { 'cache-control': 'no-store' });
      response.end();
      return;
    }
    serverFailures.push(`${request.method} ${pathname}`);
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const browserRevision = browser.version();
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    observe(page, diagnostics);
    await page.goto(pageUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__V05_LAB__ && window.__CANVAS_SCAN__);
    await settle(page);

    const comparisonDirectory = path.join(directory, 'raw/comparison');
    await mkdir(path.join(comparisonDirectory, 'inputs'), { recursive: true });
    await mkdir(path.join(comparisonDirectory, 'artifacts'), { recursive: true });
    const comparisonArtifacts = [];
    for (const row of expectedMatrix.rows) {
      const baseline = sessionFor(row, 0);
      const candidate = sessionFor(row, 1);
      const pairing = { baselineFindingIndex: row.baselineFindingIndex, candidateFindingIndex: row.candidateFindingIndex };
      const artifact = await page.evaluate(({ baseline, candidate, pairing }) => window.__V05_LAB__.compare(baseline, candidate, pairing), { baseline, candidate, pairing });
      await writeFile(path.join(comparisonDirectory, 'inputs', `${row.id}-baseline.json`), stable(baseline));
      await writeFile(path.join(comparisonDirectory, 'inputs', `${row.id}-candidate.json`), stable(candidate));
      await writeFile(path.join(comparisonDirectory, 'artifacts', `${row.id}.json`), stable(artifact));
      comparisonArtifacts.push(artifact);
    }
    await writeFile(path.join(comparisonDirectory, 'expected-results.json'), stable(expectedMatrix));
    await writeFile(path.join(comparisonDirectory, 'actual-results.json'), stable(comparisonArtifacts));
    await writeFile(path.join(comparisonDirectory, 'browser-execution.json'), stable({ browserRevision, rowIds: expectedMatrix.rows.map(row => row.id), publicApi: 'window.__CANVAS_SCAN__.compareSessions' }));

    const actionLog = [];
    const focusLog = [];
    await page.locator('#baseline').click();
    actionLog.push('record-baseline');
    await page.waitForFunction(() => window.__V05_LAB__.state.baselineComplete, undefined, { timeout: 5000 });
    await settle(page);
    const baseline = await page.evaluate(() => window.__V05_LAB__.state.baseline);
    const baselineFindingIndex = baseline.findings.findIndex(finding => finding.type === 'repeated-draw-work');
    if (baselineFindingIndex < 0) throw new Error('integrated baseline repeated-draw-work finding is absent');
    const baselineAction = page.locator('#select-baseline');
    await baselineAction.click();
    focusLog.push({ action: 'select-baseline', inputMethod: 'pointer', key: null, focusBefore: false, focusAfter: await baselineAction.evaluate(node => document.activeElement === node) });
    actionLog.push('select-baseline');
    await settle(page);

    await page.locator('#start-explanation').click();
    actionLog.push('start-explanation');
    await page.locator('#replay').click();
    await page.waitForFunction(() => window.__V05_LAB__.state.explanationComplete, undefined, { timeout: 5000 });
    const explanation = await page.evaluate(() => window.__V05_LAB__.state.explanation);
    actionLog.push('replay-baseline', 'stop-explanation');
    if (!explanation) throw new Error('integrated explanation artifact is absent');
    const applyChange = page.locator('#apply-change');
    await applyChange.focus();
    const applyChangeFocusBefore = await applyChange.evaluate(node => document.activeElement === node);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__V05_LAB__.state.structuralChangeApplied);
    focusLog.push({ action: 'apply-structural-change', inputMethod: 'keyboard', key: 'Enter', focusBefore: applyChangeFocusBefore, focusAfter: await applyChange.evaluate(node => document.activeElement === node) });
    actionLog.push('apply-structural-change');

    const candidateButton = page.locator('#candidate');
    await candidateButton.focus();
    const candidateFocusBefore = await candidateButton.evaluate(node => document.activeElement === node);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__V05_LAB__.state.candidateComplete, undefined, { timeout: 5000 });
    const candidateFocusAfter = await candidateButton.evaluate(node => document.activeElement === node);
    focusLog.push({ action: 'record-candidate', inputMethod: 'keyboard', key: 'Enter', focusBefore: candidateFocusBefore, focusAfter: candidateFocusAfter });
    actionLog.push('record-candidate');
    await settle(page);
    const candidate = await page.evaluate(() => window.__V05_LAB__.state.candidate);
    const candidateFindingIndex = candidate.findings.findIndex(finding => finding.type === 'repeated-draw-work');
    if (candidateFindingIndex < 0) throw new Error('integrated candidate repeated-draw-work finding is absent');
    const selectCandidate = page.locator('#select-candidate');
    await selectCandidate.focus();
    const selectCandidateFocusBefore = await selectCandidate.evaluate(node => document.activeElement === node);
    await page.keyboard.press('Enter');
    const candidateSelected = await page.evaluate(() => window.__V05_LAB__.state.candidateSelected);
    if (!candidateSelected) throw new Error('integrated candidate selection action did not complete');
    focusLog.push({ action: 'select-candidate', inputMethod: 'keyboard', key: 'Enter', focusBefore: selectCandidateFocusBefore, focusAfter: await selectCandidate.evaluate(node => document.activeElement === node) });
    actionLog.push('select-candidate');

    const compareAction = page.locator('#compare');
    await compareAction.focus();
    const compareFocusBefore = await compareAction.evaluate(node => node.getRootNode().activeElement === node);
    await page.keyboard.press('Enter');
    await settle(page);
    const compareFocusAfter = await compareAction.evaluate(node => node.getRootNode().activeElement === node);
    focusLog.push({ action: 'compare', inputMethod: 'keyboard', key: 'Enter', focusBefore: compareFocusBefore, focusAfter: compareFocusAfter });
    actionLog.push('compare');

    const productComparison = await page.evaluate(() => window.__V05_LAB__.state.comparison);
    if (!productComparison) throw new Error('integrated comparison action did not complete');
    const copy = page.locator('#export');
    await copy.focus();
    const copyFocusBefore = await copy.evaluate(node => node.getRootNode().activeElement === node);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__V05_LAB__.state.exported);
    await settle(page);
    const copyFocusAfter = await copy.evaluate(node => node.getRootNode().activeElement === node);
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    const exported = JSON.parse(clipboard);
    focusLog.push({ action: 'export', inputMethod: 'keyboard', key: 'Enter', focusBefore: copyFocusBefore, focusAfter: copyFocusAfter });
    actionLog.push('export');
    const panelText = await page.locator('#comparison-panel').innerText();
    const screenshot = await page.locator('#comparison-panel').screenshot();
    const interactionState = await page.evaluate(() => ({
      baselineSelected: window.__V05_LAB__.state.baselineSelected,
      structuralChangeApplied: window.__V05_LAB__.state.structuralChangeApplied,
      candidateSelected: window.__V05_LAB__.state.candidateSelected,
      baselineFindingIndex: window.__V05_LAB__.state.baselineFindingIndex,
      candidateFindingIndex: window.__V05_LAB__.state.candidateFindingIndex,
      comparisonCount: window.__V05_LAB__.state.comparisonCount,
      exported: window.__V05_LAB__.state.exported,
    }));

    const integratedDirectory = path.join(directory, 'raw/integrated');
    await mkdir(integratedDirectory, { recursive: true });
    await Promise.all([
      writeFile(path.join(integratedDirectory, 'baseline-session.json'), stable(baseline)),
      writeFile(path.join(integratedDirectory, 'explanation.json'), stable(explanation)),
      writeFile(path.join(integratedDirectory, 'candidate-session.json'), stable(candidate)),
      writeFile(path.join(integratedDirectory, 'comparison.json'), stable(productComparison)),
      writeFile(path.join(integratedDirectory, 'exported-comparison.json'), stable(exported)),
      writeFile(path.join(integratedDirectory, 'action-log.json'), stable(actionLog)),
      writeFile(path.join(integratedDirectory, 'focus-log.json'), stable(focusLog)),
      writeFile(path.join(integratedDirectory, 'interaction-state.json'), stable(interactionState)),
      writeFile(path.join(integratedDirectory, 'panel-text.txt'), `${panelText}\n`),
      writeFile(path.join(integratedDirectory, 'comparison.png'), screenshot),
    ]);
    await context.close();
    return { browserRevision, baselineFindingIndex, candidateFindingIndex };
  } finally {
    try { await browser?.close(); } catch {}
    await new Promise(resolve => server.close(resolve));
  }
}

if (checkIndex >= 0) {
  await checkEvidence(directory);
  console.log('CANVAS_LAB_V05_CHECK: PASS');
  process.exit(0);
}

if (directory !== defaultDirectory) throw new Error('unexpected v0.5 evidence directory');
const initialStatus = status();
const startedAt = new Date().toISOString();
await rm(directory, { recursive: true, force: true });
await mkdir(path.join(directory, 'raw'), { recursive: true });

const mutationOutput = recordedCommand(['pnpm', '--filter', 'dogfood', 'run', 'lab:v0.5:test']).output;
const commands = [
  ['pnpm', '--filter', 'canvas-scan', 'run', 'build'],
  ['pnpm', '--filter', 'dogfood', 'run', 'probe:command-capture:test'],
  ['pnpm', '--filter', 'dogfood', 'run', 'probe:draw-callsite:test'],
  ['pnpm', '--filter', 'dogfood', 'run', 'probe:session-comparison:test'],
  ['pnpm', '--filter', 'dogfood', 'run', 'probe:overlay-comparison:test'],
  ['pnpm', '--filter', 'dogfood', 'run', 'probe:fixed-limits:test'],
  ['pnpm', '--filter', 'dogfood', 'run', 'lab:v0.4'],
  ['pnpm', '--filter', 'dogfood', 'run', 'lab:v0.4:check'],
  ['pnpm', '--filter', 'dogfood', 'run', 'probe:command-capture'],
  ['pnpm', '--filter', 'dogfood', 'run', 'probe:draw-callsite'],
  ['pnpm', '--filter', 'dogfood', 'run', 'probe:fixed-limits'],
  ['pnpm', '--filter', 'dogfood', 'run', 'probe:overlay-comparison'],
  ['pnpm', '-r', 'run', 'typecheck'],
  ['git', 'diff', '--exit-code', 'f05f2fe2a7b5c005e1ca2d3e4ea8b04d454e5617', '--', 'apps/workbench/public/v04-lab.html', 'apps/workbench/src/V04Lab.tsx', 'apps/workbench/src/v04-lab-main.tsx', 'packages/dogfood/lab-v04.mjs', 'packages/dogfood/lab-v04-truth.mjs', 'packages/dogfood/lab-v04.test.mjs'],
  ['git', 'diff', '--check'],
  ['git', 'status', '--short', '--branch'],
].filter(parts => !releaseMode || parts.join(' ') !== 'pnpm --filter dogfood run lab:v0.4');
const verificationOutput = [];
for (const parts of commands) {
  const commandText = parts.join(' ');
  const result = recordedCommand(parts);
  verificationOutput.push(result.output);
  if (commandText === 'pnpm --filter dogfood run probe:command-capture') {
    await copyCommandEvidence();
    const manifest = JSON.parse(await readFile(path.join(directory, 'raw/command/manifest.json'), 'utf8'));
    manifest.runId = aggregateRunId;
    await writeFile(path.join(directory, 'raw/command/manifest.json'), stable(manifest));
  }
  if (commandText === 'pnpm --filter dogfood run probe:draw-callsite') {
    await copyEvidence('/private/tmp/sidproj-68-draw-callsite-evidence', 'callsite');
    const requests = JSON.parse(await readFile(path.join(directory, 'raw/callsite/request-log.json'), 'utf8'));
    for (const request of requests) for (const key of ['url', 'responseUrl']) {
      const value = new URL(request[key]);
      request[key] = `${value.origin}${value.pathname}`;
    }
    await writeFile(path.join(directory, 'raw/callsite/request-log.json'), stable(requests));
    await writeDirectoryManifest(path.join(directory, 'raw/callsite'));
  }
  if (commandText === 'pnpm --filter dogfood run probe:fixed-limits') {
    await copyEvidence('/private/tmp/sidproj-84-fixed-limit-evidence', 'limits');
    const metadata = JSON.parse(await readFile(path.join(directory, 'raw/limits/run-metadata.json'), 'utf8'));
    metadata.runId = aggregateRunId;
    await writeFile(path.join(directory, 'raw/limits/run-metadata.json'), stable(metadata));
    await writeDirectoryManifest(path.join(directory, 'raw/limits'));
  }
  if (commandText === 'pnpm --filter dogfood run probe:overlay-comparison') await copyEvidence('/private/tmp/sidproj-66-overlay-comparison-evidence', 'overlay');
}

const truthBytes = await readFile(path.join(root, 'packages/dogfood/fixtures/v05-lab/expected.json'));
const truth = JSON.parse(truthBytes);
const bundle = await readFile(bundlePath);
const fixture = await readFile(fixturePath);
const diagnostics = Object.fromEntries(truth.requiredDiagnostics.map(key => [key, []]));
const browserStartedAt = new Date().toISOString();
const chrome = await runChrome(bundle, fixture, diagnostics);
const browserEndedAt = new Date().toISOString();
const browserRun = { runId: aggregateRunId, command: browserCollectorCommand, startedAt: browserStartedAt, endedAt: browserEndedAt, exitCode: 0 };
commandRuns.push(browserRun);
const browserExecution = await readJson('raw/comparison/browser-execution.json');
await write('raw/comparison/browser-execution.json', { schemaVersion: 1, runId: aggregateRunId, startedAt: browserStartedAt, endedAt: browserEndedAt, ...browserExecution });
const interactionState = await readJson('raw/integrated/interaction-state.json');
await write('raw/integrated/interaction-state.json', { schemaVersion: 1, runId: aggregateRunId, startedAt: browserStartedAt, endedAt: browserEndedAt, ...interactionState });
const producerByGroup = {
  command: 'pnpm --filter dogfood run probe:command-capture',
  callsite: 'pnpm --filter dogfood run probe:draw-callsite',
  comparison: browserCollectorCommand,
  limits: 'pnpm --filter dogfood run probe:fixed-limits',
  overlay: 'pnpm --filter dogfood run probe:overlay-comparison',
  integrated: browserCollectorCommand,
};
await mkdir(path.join(directory, 'provenance'), { recursive: true });
for (const [group, producer] of Object.entries(producerByGroup)) {
  const run = commandRuns.find(item => item.command === producer);
  await write(`provenance/${group}.json`, { schemaVersion: 1, runId: aggregateRunId, group, producer, startedAt: run.startedAt, endedAt: run.endedAt });
}
diagnostics.serverFailures.push(...serverFailures);
const commitHash = command(['git', 'rev-parse', 'HEAD']).stdout.trim();
const expectedHashes = Object.fromEntries(await Promise.all(truth.expectedSources.map(async name => [name, sha256(await readFile(path.join(root, name)))])));
const fixtureHashes = Object.fromEntries(await Promise.all(truth.fixtureSources.map(async name => [name, sha256(await readFile(path.join(root, name)))])));
const metadata = {
  schemaVersion: 1,
  runId: aggregateRunId,
  command: 'pnpm --filter dogfood run lab:v0.5',
  releaseMode,
  commitHash,
  packageHash: sha256(Buffer.concat([await readFile(packagePath), bundle])),
  bundleHash: sha256(bundle),
  expectedHash: sha256(truthBytes),
  expectedHashes,
  fixtureHashes,
  browserRevision: chrome.browserRevision,
  platform: process.platform,
  nodeVersion: process.version,
  startedAt,
  endedAt: new Date().toISOString(),
  initialStatus,
  finalStatus: status(),
};
const matrix = await deriveRows(directory, truth, metadata);
await Promise.all([
  write('expected.json', truthBytes),
  write('matrix.json', matrix),
  write('run-metadata.json', metadata),
  write('collector-runs.json', { schemaVersion: 1, runId: aggregateRunId, runs: commandRuns }),
  write('run-links.json', { schemaVersion: 1, runId: aggregateRunId, files: [], groups: Object.fromEntries(Object.keys(producerByGroup).map(group => [group, `provenance/${group}.json`])) }),
  write('diagnostics.json', diagnostics),
  write('checker-output.txt', 'PENDING\n'),
  write('mutation-test-output.txt', mutationOutput),
  write('verification-output.txt', `${verificationOutput.join('\n')}\n`),
]);
await write('run-links.json', { schemaVersion: 1, runId: aggregateRunId, files: (await files()).filter(name => !['run-links.json', 'evidence-sha256.txt'].includes(name)).sort(), groups: Object.fromEntries(Object.keys(producerByGroup).map(group => [group, `provenance/${group}.json`])) });
await writeManifest();
await checkEvidence(directory, { allowPendingCheckerOutput: true, allowPendingMutations: true });
await write('checker-output.txt', 'CANVAS_LAB_V05: PASS\n');
metadata.endedAt = new Date().toISOString();
await write('run-metadata.json', metadata);
await writeManifest();
await checkEvidence(directory, { allowPendingMutations: true });
const diskMutations = await runDiskMutations(directory);
await write('mutation-test-output.txt', `${mutationOutput}\nCANVAS_LAB_V05_DISK_MUTATIONS: PASS ${diskMutations.join(',')}\n`);
metadata.endedAt = new Date().toISOString();
metadata.finalStatus = status();
await write('run-metadata.json', metadata);
await writeManifest();
await checkEvidence(directory);
console.log(`CANVAS_LAB_V05_EVIDENCE: ${directory}`);
console.log('CANVAS_LAB_V05: PASS');
