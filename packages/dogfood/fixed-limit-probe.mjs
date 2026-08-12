import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { expectedMatrix as comparisonMatrix, sessionFor } from './session-comparison-fixture.mjs';
import { checkEvidence } from './fixed-limit-truth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceRoot = '/private/tmp/sidproj-84-fixed-limit-evidence';
const expectedPath = path.join(root, 'packages/dogfood/fixtures/v05-08a-fixed-limits/expected.json');
const fixturePath = path.join(root, 'apps/workbench/public/v05-08a-fixed-limits.html');
const bundlePath = path.join(root, 'packages/core/dist/canvas-scan.iife.js');
const port = 5208;
const origin = `http://127.0.0.1:${port}`;
const pageUrl = `${origin}/v05-08a-fixed-limits.html`;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const status = () => execFileSync('git', ['status', '--short', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
const focusedCommand = ['--filter', 'canvas-scan', 'exec', 'vitest', 'run', 'test/explanation.test.ts', 'test/command-capture.test.ts', 'test/draw-callsite.test.ts', 'test/comparison.test.ts', 'test/overlay.test.ts'];
const mutationCommand = ['--filter', 'dogfood', 'run', 'probe:fixed-limits:test'];
const buildCommand = ['--filter', 'canvas-scan', 'run', 'build'];
const verificationCommands = [
  focusedCommand,
  ['--filter', 'dogfood', 'run', 'probe:command-capture:test'],
  ['--filter', 'dogfood', 'run', 'probe:draw-callsite:test'],
  ['--filter', 'dogfood', 'run', 'probe:session-comparison:test'],
  ['--filter', 'dogfood', 'run', 'probe:overlay-comparison:test'],
  ['--filter', 'canvas-scan', 'run', 'test'],
  ['--filter', 'dogfood', 'run', 'lab:v0.4'],
  ['--filter', 'dogfood', 'run', 'probe:explanation-state'],
  ['--filter', 'dogfood', 'run', 'probe:command-capture'],
  ['--filter', 'dogfood', 'run', 'probe:draw-callsite'],
  ['--filter', 'dogfood', 'run', 'probe:draw-callsite:check'],
  ['--filter', 'dogfood', 'run', 'probe:explanation-overlay'],
  ['--filter', 'dogfood', 'run', 'probe:overlay-comparison'],
  ['--filter', 'dogfood', 'run', 'probe:overlay-comparison:check'],
  ['-r', 'run', 'typecheck'],
  buildCommand,
  ['--filter', 'demo', 'run', 'build'],
];
const diagnostics = { warnings: [], errors: [], pageErrors: [], requestFailures: [], instrumentationKills: [], runnerFailures: [], general: [] };
const requests = [];
let browser;
let server;
let activeRowKey = null;

if (process.argv[2] === '--check-evidence') {
  try { await checkEvidence(process.argv[3] ?? evidenceRoot); console.log('SIDPROJ_84_FIXED_LIMITS: PASS'); }
  catch (error) { console.error(`SIDPROJ_84_FIXED_LIMITS: FAIL ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
  process.exit();
}

function exactMap(size, source) {
  const marker = 'SIDPROJ_84_SOURCE_CONTENT';
  const base = { version: 3, sources: [source], names: [], mappings: 'AAAA', x_google_ignoreList: [], padding: '' };
  const empty = Buffer.from(JSON.stringify(base));
  const padding = size - empty.byteLength;
  if (padding < marker.length) throw new Error('source map size too small');
  base.padding = marker + 'x'.repeat(padding - marker.length);
  const bytes = Buffer.from(JSON.stringify(base));
  if (bytes.byteLength !== size) throw new Error(`source map size mismatch: ${bytes.byteLength} != ${size}`);
  return bytes;
}

function commandOutput(args, attempts = 1) {
  let result;
  for (let attempt = 0; attempt < attempts; attempt++) {
    result = spawnSync('pnpm', args, { cwd: root, encoding: 'utf8' });
    if (result.status === 0) break;
  }
  const redact = value => String(value ?? '').replace(/sourcesContent/gi, '[redacted field]').replace(/\bquery\b/gi, '[redacted URL part]').replace(/\bfragment\b/gi, '[redacted URL part]');
  const output = `COMMAND: pnpm ${args.join(' ')}\nEXIT: ${result.status ?? 1}\nSTDOUT:\n${redact(result.stdout)}\nSTDERR:\n${redact(result.stderr)}`;
  if (result.status !== 0) throw new Error(output);
  return output;
}

function gitOutput(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const output = `COMMAND: git ${args.join(' ')}\nEXIT: ${result.status ?? 1}\nSTDOUT:\n${result.stdout ?? ''}\nSTDERR:\n${result.stderr ?? ''}`;
  if (result.status !== 0) throw new Error(output);
  return output;
}

function chainScript(index, total) {
  const body = index + 1 < total
    ? `return window.__LIMIT_CHAIN_${index + 1}__(context, value);`
    : 'return context.fillRect(value, 0, 1, 1);';
  return `window.__LIMIT_CHAIN_${index}__ = function limitFrame${index}(context, value) { ${body} };\n//# sourceMappingURL=${index}-of-${total}.js.map\n`;
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.json') || file.endsWith('.map')) return 'application/json';
  return 'text/javascript; charset=utf-8';
}

function makeServer(bundle, fixture) {
  return createServer((request, response) => {
    const url = new URL(request.url, origin);
    let body;
    if (url.pathname === '/v05-08a-fixed-limits.html' || url.pathname === '/') body = fixture;
    else if (url.pathname === '/canvas-scan.iife.js') body = bundle;
    else {
      let match = url.pathname.match(/^\/limit-chain\/(\d+)-of-(\d+)\.js$/);
      if (match) body = Buffer.from(chainScript(Number(match[1]), Number(match[2])));
      match = url.pathname.match(/^\/limit-chain\/(\d+)-of-(\d+)\.js\.map$/);
      if (match) body = Buffer.from(JSON.stringify({ version: 3, sources: [`fixtures/v05-08a/frame-${match[1]}-source.js`], names: [], mappings: 'AAAA' }));
      if (url.pathname === '/large/fixture.js') body = Buffer.from(`window.__LIMIT_LARGE__ = function privateLimitFixture(context, value) { return context.fillRect(value, 0, 1, 1); };\n//# sourceMappingURL=fixture.js.map?bytes=${url.searchParams.get('bytes') ?? '0'}&private-query=84#private-fragment-84\n`);
      if (url.pathname === '/large/fixture.js.map') body = exactMap(Number(url.searchParams.get('bytes')), 'fixtures/v05-08a/large-source.js');
    }
    if (!body) { response.writeHead(404); response.end(); return; }
    const headers = { 'content-type': contentType(url.pathname), 'content-length': body.byteLength, 'cache-control': 'no-store' };
    if (activeRowKey && (url.pathname.startsWith('/limit-chain/') || url.pathname.startsWith('/large/'))) {
      requests.push({
        row: activeRowKey,
        kind: url.pathname.endsWith('.map') ? 'source-map' : 'generated-script',
        origin: url.origin,
        responseUrl: `${url.origin}${url.pathname}`,
        status: 200,
        redirected: false,
        responseHeaders: { contentType: headers['content-type'], contentLength: String(headers['content-length']), cacheControl: headers['cache-control'] },
        responseByteSource: 'served-body',
        responseBytes: body.byteLength,
      });
    }
    response.writeHead(200, headers);
    response.end(body);
  });
}

function observe(page, key) {
  page.on('console', message => {
    if (message.type() === 'warning') diagnostics.warnings.push(`${key}: ${message.text()}`);
    if (message.type() === 'error') diagnostics.errors.push(`${key}: ${message.text()}`);
  });
  page.on('pageerror', error => diagnostics.pageErrors.push(`${key}: ${error.message}`));
  page.on('requestfailed', request => diagnostics.requestFailures.push(`${key}: ${request.url()}`));
}

async function source(page, variant) {
  await page.clock.install({ time: new Date('2026-08-12T10:00:00.000Z') });
  await page.goto(pageUrl, { waitUntil: 'load' });
  await page.evaluate(value => window.__V05_08A__.prepare(value), variant === 'nearest-negative' ? 'wrapper-depth' : variant);
  const pending = page.evaluate(() => window.__V05_08A__.makeSource());
  await page.clock.runFor(90);
  return pending;
}

async function advanceFrame(page, callback, argument, duration = 17) {
  const pending = page.evaluate(callback, argument);
  await page.clock.runFor(duration);
  return pending;
}

async function runRow(row) {
  const key = `${row.limit}:${row.variant}`;
  activeRowKey = key;
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const page = await context.newPage();
  observe(page, key);
  await source(page, row.variant);

  if (row.limit === 'source-map-lookups') {
    const count = row.attempted - 1;
    for (let index = count - 1; index >= 0; index--) await page.addScriptTag({ url: `${origin}/limit-chain/${index}-of-${count}.js?private-query=84#private-fragment-84` });
  }
  if (row.limit === 'source-map-response-bytes') await page.addScriptTag({ url: `${origin}/large/fixture.js?bytes=${row.attempted}&private-query=84#private-fragment-84` });

  await page.clock.pauseAt(new Date('2026-08-12T10:01:00.000Z'));
  const start = await page.evaluate(() => window.__V05_08A__.startSelected());
  if (start.status !== 'started') throw new Error(`${key}: explanation did not start`);

  if (row.limit !== 'duration-ms' && row.limit !== 'selected-canvases') {
    await advanceFrame(page, () => window.__V05_08A__.resetWindow());
    await advanceFrame(page, () => window.__V05_08A__.resetWindow());
  }
  if (row.limit === 'active-windows') await advanceFrame(page, () => window.__V05_08A__.settleInactive(), undefined, 34);

  let repeatedStart = null;
  let completedArtifactStable = null;
  if (row.limit === 'duration-ms') {
    if (row.mode === 'negative') {
      await page.clock.fastForward(row.attempted);
      await page.evaluate(() => window.__V05_08A__.stop());
    }
    else {
      await page.clock.fastForward(10000);
      if (row.attempted > 10000) {
        const before = await page.evaluate(() => window.__V05_08A__.last());
        await page.clock.fastForward(row.attempted - 10000);
        await page.evaluate(() => window.__V05_08A__.drawArguments([99, 0, 1, 1]));
        const after = await page.evaluate(() => window.__V05_08A__.last());
        completedArtifactStable = JSON.stringify(before) === JSON.stringify(after);
      }
    }
    if (row.mode === 'positive' && await page.evaluate(() => window.__V05_08A__.last()?.stopReason) !== 'max-duration') throw new Error(`${key}: automatic duration stop missing`);
  } else if (row.limit === 'selected-canvases') {
    repeatedStart = await page.evaluate(positive => positive ? window.__V05_08A__.startAlternative() : window.__V05_08A__.startSame(), row.mode === 'positive');
    await page.evaluate(() => window.__V05_08A__.stop());
  } else if (row.limit === 'active-windows') {
    for (let index = 2; index < row.attempted; index++) await advanceFrame(page, () => window.__V05_08A__.resetWindow());
    await page.evaluate(() => window.__V05_08A__.stop());
  } else if (row.limit === 'command-entries') {
    await page.evaluate(count => { for (let index = 0; index < count; index++) window.__V05_08A__.drawArguments([1, 0, 1, 1]); }, row.attempted);
    await advanceFrame(page, () => window.__V05_08A__.frame());
    await page.evaluate(() => window.__V05_08A__.stop());
  } else if (row.limit === 'arguments-per-command') {
    await page.evaluate(count => window.__V05_08A__.drawArguments(Array.from({ length: count }, (_, index) => index + 0.25)), row.attempted);
    await advanceFrame(page, () => window.__V05_08A__.frame());
    await page.evaluate(() => window.__V05_08A__.stop());
  } else if (row.limit === 'value-tokens') {
    await page.evaluate(count => {
      let next = 0;
      while (next < count) {
        const size = Math.min(20, count - next);
        window.__V05_08A__.drawArguments(Array.from({ length: size }, (_, index) => next + index + 0.125));
        next += size;
      }
    }, row.attempted);
    await advanceFrame(page, () => window.__V05_08A__.frame());
    await page.evaluate(() => window.__V05_08A__.stop());
  } else if (row.limit === 'stack-samples') {
    for (let index = 0; index < row.attempted - 1; index++) await advanceFrame(page, value => window.__V05_08A__.drawWindow(value), index + 10);
    await page.evaluate(() => window.__V05_08A__.stop());
  } else if (row.limit === 'frames-per-stack') {
    await page.evaluate(() => { Error.stackTraceLimit = 100; });
    await advanceFrame(page, () => window.__V05_08A__.drawWindow(0), undefined);
    const wrapper = row.variant === 'wrapper-depth' || row.variant === 'nearest-negative';
    await page.evaluate(depth => window.__V05_08A__.deepDraw(depth, 1), row.attempted - (wrapper ? 13 : 8));
    await advanceFrame(page, () => window.__V05_08A__.frame());
    await page.evaluate(() => window.__V05_08A__.stop());
  } else if (row.limit === 'source-map-lookups') {
    await advanceFrame(page, () => window.__V05_08A__.drawWindow(0), undefined);
    await page.evaluate(() => window.__V05_08A__.runExternal('__LIMIT_CHAIN_0__', 1));
    await advanceFrame(page, () => window.__V05_08A__.frame());
    await page.clock.runFor(200);
    await page.evaluate(() => window.__V05_08A__.stop());
  } else if (row.limit === 'source-map-response-bytes') {
    await advanceFrame(page, () => window.__V05_08A__.drawWindow(0), undefined);
    await page.evaluate(() => window.__V05_08A__.runExternal('__LIMIT_LARGE__', 1));
    await advanceFrame(page, () => window.__V05_08A__.frame());
    await page.clock.runFor(300);
    await page.evaluate(() => window.__V05_08A__.stop());
  }

  const artifact = await page.evaluate(() => window.__V05_08A__.last());
  if (!artifact) throw new Error(`${key}: explanation artifact missing`);
  const facts = { start, repeatedStart, completedArtifactStable, sourceCanvasId: artifact.source.canvasId, followUpCanvasId: artifact.followUp.canvasId };
  if (await page.evaluate(() => window.__CANVAS_SCAN_COMMAND_CAPTURE_TEST__?.isKilled?.() === true)) diagnostics.instrumentationKills.push(key);
  await context.close();
  return { artifact, facts };
}

async function mismatchEvidence() {
  const row = comparisonMatrix.rows.find(item => item.id === 'finding-type-mismatch');
  if (!row) throw new Error('comparison mismatch truth missing');
  const baseline = sessionFor(row, 0);
  const candidate = sessionFor(row, 1);
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const page = await context.newPage();
  observe(page, 'finding-type-mismatch');
  await page.goto(pageUrl, { waitUntil: 'load' });
  const artifact = await page.evaluate(({ baseline, candidate, pairing }) => window.__V05_08A__.compare(baseline, candidate, pairing), { baseline, candidate, pairing: { baselineFindingIndex: row.baselineFindingIndex, candidateFindingIndex: row.candidateFindingIndex } });
  await context.close();
  return { row: { baselineFindingIndex: row.baselineFindingIndex, candidateFindingIndex: row.candidateFindingIndex }, baseline, candidate, artifact };
}

async function overlayFilterEvidence() {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const page = await context.newPage();
  observe(page, 'overlay-filter');
  const first = await source(page, 'wrapper-depth');
  const host = page.locator('[data-canvas-scan]');
  await host.evaluate(node => { const button = node.shadowRoot.querySelector('.counts'); if (button?.getAttribute('aria-expanded') !== 'true') button.click(); });
  const baseline = page.locator(`.baseline-action[data-finding-index="${first.selectedFindingIndex}"]`).first();
  if (!await baseline.isVisible()) await baseline.locator('xpath=ancestor::section[contains(@class,"finding-card")]').locator('.finding-toggle').click();
  await baseline.click();
  const candidate = await advanceFrame(page, () => window.__V05_08A__.makeResizeSource(), undefined, 90);
  await advanceFrame(page, () => window.__V05_08A__.settle(), undefined, 34);
  const mismatch = await host.evaluate((node, candidateTypes) => {
    const actions = [...node.shadowRoot.querySelectorAll('.comparison-action')].map(action => ({ findingIndex: Number(action.dataset.findingIndex), hidden: action.hidden }));
    return { actions, candidateTypes };
  }, candidate.findings.map(finding => finding.type));
  const sameCandidate = await advanceFrame(page, () => window.__V05_08A__.makeSource(), undefined, 90);
  await advanceFrame(page, () => window.__V05_08A__.settle(), undefined, 34);
  const same = await host.evaluate((node, candidateTypes) => {
    const actions = [...node.shadowRoot.querySelectorAll('.comparison-action')].map(action => ({ findingIndex: Number(action.dataset.findingIndex), hidden: action.hidden }));
    return { actions, candidateTypes };
  }, sameCandidate.source.findings.map(finding => finding.type));
  const evidence = { baselineType: first.source.findings[first.selectedFindingIndex].type, mismatch, same };
  await context.close();
  return evidence;
}

async function privacyEvidence() {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const page = await context.newPage();
  observe(page, 'privacy-probe');
  await source(page, 'wrapper-depth');
  await page.clock.pauseAt(new Date('2026-08-12T10:01:00.000Z'));
  const start = await page.evaluate(() => window.__V05_08A__.startSelected());
  if (start.status !== 'started') throw new Error('privacy explanation did not start');
  await advanceFrame(page, () => window.__V05_08A__.resetWindow());
  await advanceFrame(page, () => window.__V05_08A__.resetWindow());
  await page.evaluate(() => {
    window.__SIDPROJ_84_PREPARE_STACK_CALLS__ = 0;
    Error.prepareStackTrace = () => {
      window.__SIDPROJ_84_PREPARE_STACK_CALLS__++;
      return 'Error: SIDPROJ_84_RAW_STACK\n    at privateLimitFixture (https://secret.example.invalid/private.js?token=abc#secret:1:1)';
    };
  });
  const nativeSucceeded = await page.evaluate(() => window.__V05_08A__.drawPrivateSeeds());
  await advanceFrame(page, () => window.__V05_08A__.frame());
  await page.evaluate(() => window.__V05_08A__.stop());
  const result = await page.evaluate(() => ({ prepareStackTraceCalls: window.__SIDPROJ_84_PREPARE_STACK_CALLS__, artifact: window.__V05_08A__.last() }));
  await context.close();
  return { nativeSucceeded, ...result };
}

async function manifest(directory) {
  const files = [];
  async function visit(relative) {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(next);
      else if (next !== 'evidence-sha256.txt') files.push(next);
    }
  }
  await visit('');
  return `${(await Promise.all(files.sort().map(async file => `${sha256(await readFile(path.join(directory, file)))}  ${file}`))).join('\n')}\n`;
}

async function run() {
  if (evidenceRoot !== '/private/tmp/sidproj-84-fixed-limit-evidence') throw new Error('unexpected evidence root');
  const initialStatus = status();
  const expectedBytes = await readFile(expectedPath);
  const expected = JSON.parse(expectedBytes);
  await rm(evidenceRoot, { recursive: true, force: true });
  await mkdir(path.join(evidenceRoot, 'artifacts'), { recursive: true });
  const mutationOutput = commandOutput(mutationCommand);
  const verificationOutput = `${verificationCommands.map(args => commandOutput(args, args.includes('lab:v0.4') ? 3 : 1)).join('\n')}\n${gitOutput(['diff', '--check'])}\n${gitOutput(['status', '--short', '--branch'])}`;
  const bundle = await readFile(bundlePath);
  const fixture = await readFile(fixturePath);
  const bundleHash = sha256(bundle);
  const fixtureHash = sha256(fixture);
  const packageHash = sha256(Buffer.concat([await readFile(path.join(root, 'packages/core/package.json')), bundle]));
  const commitHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  server = makeServer(bundle, fixture);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const chromeRevision = browser.version();
  const matrix = [];
  for (const row of expected.rows) {
    const result = await runRow(row);
    const artifactPath = `artifacts/${row.limit}/${row.variant}.json`;
    const file = path.join(evidenceRoot, artifactPath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, json(result.artifact));
    matrix.push({ ...row, artifactPath, commitHash, packageHash, chromeRevision, facts: result.facts });
  }
  const mismatch = await mismatchEvidence();
  const overlayFilter = await overlayFilterEvidence();
  const privacy = await privacyEvidence();
  const finalStatus = status();
  const metadata = {
    schemaVersion: 1,
    runId: randomUUID(),
    command: 'pnpm --filter dogfood run probe:fixed-limits',
    checkCommand: 'pnpm --filter dogfood run probe:fixed-limits:check',
    commitHash,
    initialStatus,
    finalStatus,
    chromeRevision,
    bundleHash,
    packageHash,
    expectedHash: sha256(expectedBytes),
    fixtureHash,
    platform: process.platform,
    nodeVersion: process.version,
  };
  await Promise.all([
    writeFile(path.join(evidenceRoot, 'expected.json'), expectedBytes),
    writeFile(path.join(evidenceRoot, 'matrix.json'), json(matrix)),
    writeFile(path.join(evidenceRoot, 'requests.json'), json(requests)),
    writeFile(path.join(evidenceRoot, 'mismatch.json'), json(mismatch)),
    writeFile(path.join(evidenceRoot, 'overlay-filter.json'), json(overlayFilter)),
    writeFile(path.join(evidenceRoot, 'privacy.json'), json(privacy)),
    writeFile(path.join(evidenceRoot, 'diagnostics.json'), json(diagnostics)),
    writeFile(path.join(evidenceRoot, 'run-metadata.json'), json(metadata)),
    writeFile(path.join(evidenceRoot, 'mutation-test-output.txt'), mutationOutput),
    writeFile(path.join(evidenceRoot, 'verification-output.txt'), verificationOutput),
  ]);
  await writeFile(path.join(evidenceRoot, 'evidence-sha256.txt'), await manifest(evidenceRoot));
  await checkEvidence(evidenceRoot, { allowMissingCheckerOutput: true });
  await writeFile(path.join(evidenceRoot, 'checker-output.txt'), 'SIDPROJ_84_FIXED_LIMITS: PASS\n');
  await writeFile(path.join(evidenceRoot, 'evidence-sha256.txt'), await manifest(evidenceRoot));
  await checkEvidence(evidenceRoot);
  console.log(`SIDPROJ_84_FIXED_LIMIT_EVIDENCE: ${evidenceRoot}`);
  console.log('SIDPROJ_84_FIXED_LIMITS: PASS');
}

try { await run(); }
catch (error) { diagnostics.runnerFailures.push(error instanceof Error ? error.stack ?? error.message : String(error)); console.error(`SIDPROJ_84_FIXED_LIMITS: FAIL ${diagnostics.runnerFailures.at(-1)}`); process.exitCode = 1; }
finally {
  try { await browser?.close(); } catch {}
  try { if (server) await new Promise(resolve => server.close(resolve)); } catch {}
}
