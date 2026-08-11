import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { checkEvidence, counterexampleNames, limits, rowNames } from './command-capture-truth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = '/private/tmp/sidproj-72-command-evidence';
const bundle = path.join(output, 'command-capture-diagnostic.js');
const port = 5198;
const privacyCategories = ['strings', 'numbers', 'keys', 'urls', 'sha256', 'fnv', 'function-source', 'live-object-shapes', 'claim-language'];
const expectedRows = {
  'wrapper-depth': { changedFactor: 'wrapper-depth', status: 'changed', ordinal: 2, reason: 'argument-token', unknownReason: null },
  'canvas-order': { changedFactor: 'canvas-order', status: 'changed', ordinal: 2, reason: 'argument-token', unknownReason: null },
  'background-work': { changedFactor: 'background-work', status: 'changed', ordinal: 2, reason: 'argument-token', unknownReason: null },
  'identical-stream': { changedFactor: 'none', status: 'same', ordinal: null, reason: null, unknownReason: null },
  'unsupported-value': { changedFactor: 'unsupported-value', status: 'unknown', ordinal: null, reason: null, unknownReason: 'unsupported-value' },
};

let browser;
let server;
const failures = [];

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function scanPrivacy(value) {
  const strings = ['opaque-private-string', 'privateKey', 'privateValue', 'private-function', 'privateFunction', 'liveOnlyPrivateShape'];
  const numbers = [918273.645, 771928.125];
  const urls = ['https://secret.example.invalid/private-path?private-query=1#private-fragment'];
  const urlParts = ['secret.example.invalid', 'private-path', 'private-query', 'private-fragment'];
  const claims = ['same pixels', 'unchanged pixels', 'wasted work', 'avoidable work', 'caused by'];
  const seeds = [...strings, ...numbers.map(String), ...urls, ...urlParts];
  const combined = [seeds.join(''), seeds.join(':'), seeds.join('|'), JSON.stringify(seeds)];
  for (let left = 0; left < seeds.length; left++) for (let right = left + 1; right < seeds.length; right++) combined.push(`${seeds[left]}${seeds[right]}`, `${seeds[left]}:${seeds[right]}`, `${seeds[left]}|${seeds[right]}`);
  const fnv = [...new Set([...seeds, ...combined])].map(fnv1a);
  const digests = [...new Set([...seeds, ...combined])].map(entry => createHash('sha256').update(entry).digest('hex'));
  const fnvDecimal = fnv.map(value => String(Number.parseInt(value, 16)));
  const matches = [];
  const checkedPaths = [];
  function visit(entry, trail) {
    checkedPaths.push(trail);
    if (typeof entry === 'number') {
      if (numbers.some(value => Object.is(value, entry))) matches.push({ trail, category: 'numbers', value: String(entry) });
      if (fnvDecimal.includes(String(entry))) matches.push({ trail, category: 'fnv', value: String(entry) });
      return;
    }
    if (typeof entry === 'string') {
      const lower = entry.toLowerCase();
      if (strings.some(value => lower.includes(value.toLowerCase()))) matches.push({ trail, category: 'strings', value: entry });
      if (numbers.some(value => entry.includes(String(value)))) matches.push({ trail, category: 'numbers', value: entry });
      if ([...urls, ...urlParts].some(part => entry.includes(part))) matches.push({ trail, category: 'urls', value: entry });
      if (digests.some(value => entry.includes(value))) matches.push({ trail, category: 'digest', value: entry });
      if ([...fnv, ...fnvDecimal].some(value => entry.includes(value))) matches.push({ trail, category: 'fnv', value: entry });
      if (entry.includes('function privateFunction') || entry.includes("() => 'private-function'") || entry.includes('privateFunction')) matches.push({ trail, category: 'function-source', value: entry });
      if (claims.some(value => lower.includes(value))) matches.push({ trail, category: 'claim-language', value: entry });
      return;
    }
    if (Array.isArray(entry)) { entry.forEach((item, index) => visit(item, `${trail}[${index}]`)); return; }
    if (!entry || typeof entry !== 'object') return;
    for (const [key, item] of Object.entries(entry)) {
      if (strings.some(value => key.toLowerCase().includes(value.toLowerCase()))) matches.push({ trail: `${trail}.${key}`, category: 'keys', value: key });
      if (['privateKey', 'liveOnlyPrivateShape', 'ownerDocument', 'nodeType'].includes(key)) matches.push({ trail: `${trail}.${key}`, category: 'live-object-shapes', value: key });
      visit(item, `${trail}.${key}`);
    }
  }
  visit(value, '$');
  return { pass: matches.length === 0, checkedPaths, checkedCategories: privacyCategories, matches };
}
function artifactResult(artifact) {
  const result = artifact.comparisons.at(-1);
  if (!result) throw new Error(`no comparison for ${artifact.source.canvasId}`);
  return { status: result.status, ordinal: result.difference?.ordinal ?? null, reason: result.difference?.reason ?? null, unknownReason: result.unknownReason };
}

try {
  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, 'artifacts'), { recursive: true });
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'exec', 'esbuild', '../dogfood/command-capture-diagnostic.ts', '--bundle', '--format=iife', `--outfile=${bundle}`], { cwd: root, stdio: 'inherit' });
  const bytes = await readFile(bundle);
  const bundleSha256 = createHash('sha256').update(bytes).digest('hex');
  server = createServer((request, response) => {
    if (request.url === '/bundle.js') { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(bytes); }
    else { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><title>SIDPROJ-72 probe</title><script src="/bundle.js"></script>'); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__CANVAS_SCAN__ && window.__CANVAS_SCAN_COMMAND_CAPTURE_TEST__);

  const rows = [];
  const allocationRows = [];
  const counterexamples = [];
  const artifacts = {};
  for (const name of rowNames) {
    const outcome = await page.evaluate(async name => {
      const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
      const registrationOrder = [];
      const selected = document.createElement('canvas');
      const decoy = document.createElement('canvas');
      selected.id = `selected-${name}`;
      decoy.id = `decoy-${name}`;
      document.body.append(selected, decoy);
      let context;
      let decoyContext;
      if (name === 'canvas-order') {
        decoyContext = decoy.getContext('2d'); registrationOrder.push('decoy');
        context = selected.getContext('2d'); registrationOrder.push('selected');
      } else {
        context = selected.getContext('2d'); registrationOrder.push('selected');
        decoyContext = decoy.getContext('2d'); registrationOrder.push('decoy');
      }
      window.__CANVAS_SCAN__.startRecording();
      for (let index = 0; index < 4; index++) { context.fillRect(0, 0, 10, 10); context.fillRect(1, 1, 10, 10); await frame(); }
      const source = window.__CANVAS_SCAN__.stopRecording();
      const findingIndex = source.findings.findIndex(finding => finding.canvasId.startsWith(`${selected.id}#`));
      if (findingIndex < 0) throw new Error(`no source finding for ${name}`);

      const noExplanationBefore = window.__CANVAS_SCAN_COMMAND_CAPTURE_TEST__.getAllocationCount();
      context.strokeRect(2, 2, 2, 2);
      await frame();
      const noExplanationAfter = window.__CANVAS_SCAN_COMMAND_CAPTURE_TEST__.getAllocationCount();
      const start = window.__CANVAS_SCAN__.startExplanation({ sessionId: source.sessionId, findingIndex });
      if (start.status !== 'started') throw new Error(`start failed for ${name}: ${JSON.stringify(start)}`);
      await frame();

      const nonSelectedBefore = window.__CANVAS_SCAN_COMMAND_CAPTURE_TEST__.getAllocationCount();
      decoyContext.fillRect(90, 90, 1, 1);
      let nonSelectedOperationCount = 1;
      if (name === 'background-work') {
        decoyContext.fillRect(91, 91, 1, 1);
        decoyContext.strokeRect(92, 92, 1, 1);
        decoyContext.clearRect(93, 93, 1, 1);
        nonSelectedOperationCount += 3;
      }
      const nonSelectedAfter = window.__CANVAS_SCAN_COMMAND_CAPTURE_TEST__.getAllocationCount();

      const privateObject = { privateKey: 'privateValue', liveOnlyPrivateShape: true, ownerDocument: document, nodeType: 771928.125 };
      const privateUrl = 'https://secret.example.invalid/private-path?private-query=1#private-fragment';
      let activeDepth = 0;
      let measuredDepth = 0;
      const layer = callback => {
        activeDepth++;
        measuredDepth = Math.max(measuredDepth, activeDepth);
        try { return callback(); } finally { activeDepth--; }
      };
      const directDraw = (value, unsupported = false) => {
        context.save(unsupported ? function privateFunction() {} : privateObject);
        context.fillStyle = 'opaque-private-string';
        context.fillRect(value, 0, 10, 10, 918273.645, privateUrl);
        context.restore();
      };
      const draw = (value, unsupported = false) => name === 'wrapper-depth'
        ? layer(() => layer(() => layer(() => directDraw(value, unsupported))))
        : layer(() => directDraw(value, unsupported));
      const selectedBefore = window.__CANVAS_SCAN_COMMAND_CAPTURE_TEST__.getAllocationCount();
      draw(11); await frame();
      draw(11); await frame();
      if (name === 'unsupported-value') draw(12, true);
      else draw(name === 'identical-stream' ? 11 : 12);
      await frame();
      const selectedAfter = window.__CANVAS_SCAN_COMMAND_CAPTURE_TEST__.getAllocationCount();
      const artifact = window.__CANVAS_SCAN__.stopExplanation();
      if (!artifact) throw new Error(`no artifact for ${name}`);
      return {
        artifact,
        allocation: { name, noExplanationDelta: noExplanationAfter - noExplanationBefore, nonSelectedDelta: nonSelectedAfter - nonSelectedBefore, selectedDelta: selectedAfter - selectedBefore },
        facts: { name, canvasId: artifact.source.canvasId, wrapperDepth: measuredDepth, registrationOrder, nonSelectedOperationCount, nonSelectedProbeOperationCount: 1, selectedOperationCount: 12, gap: artifact.firstGap },
      };
    }, name);
    artifacts[name] = outcome.artifact;
    allocationRows.push(outcome.allocation);
    rows.push({ ...outcome.facts, ...artifactResult(outcome.artifact) });
  }

  for (const name of counterexampleNames) {
    const outcome = await page.evaluate(async name => {
      const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
      const selected = document.createElement('canvas');
      const decoy = document.createElement('canvas');
      selected.id = `counter-selected-${name}`;
      decoy.id = `counter-decoy-${name}`;
      document.body.append(selected, decoy);
      const context = selected.getContext('2d');
      const decoyContext = decoy.getContext('2d');
      window.__CANVAS_SCAN__.startRecording();
      for (let index = 0; index < 4; index++) { context.fillRect(0, 0, 10, 10); context.fillRect(1, 1, 10, 10); await frame(); }
      const source = window.__CANVAS_SCAN__.stopRecording();
      const findingIndex = source.findings.findIndex(finding => finding.canvasId.startsWith(`${selected.id}#`));
      if (findingIndex < 0) throw new Error(`no counterexample source for ${name}`);
      const start = window.__CANVAS_SCAN__.startExplanation({ sessionId: source.sessionId, findingIndex });
      if (start.status !== 'started') throw new Error(`counterexample start failed for ${name}`);
      await frame();

      let trapCount = 0;
      let nativeSucceeded = true;
      let selectedOperationCount = 0;
      let nonSelectedOperationCount = 0;
      const traps = Object.fromEntries(['get', 'set', 'has', 'ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf', 'setPrototypeOf', 'defineProperty', 'deleteProperty', 'isExtensible', 'preventExtensions', 'apply', 'construct'].map(trap => [trap, () => { trapCount++; throw new Error(`proxy trap ${trap}`); }]));
      const hostile = new Proxy({}, traps);
      const revoked = Proxy.revocable({}, {}); revoked.revoke();
      const stable = { label: 'privateValue' };
      const normalDraw = value => { context.save(stable); context.fillStyle = 'opaque-private-string'; context.fillRect(value, 0, 10, 10, 918273.645); context.restore(); selectedOperationCount += 4; };
      const proxyDraw = value => { context.save(stable); context.fillStyle = 'opaque-private-string'; try { context.fillRect(value, 0, 10, 10, name === 'proxy-zero-traps' ? hostile : revoked.proxy); } catch { nativeSucceeded = false; } context.restore(); selectedOperationCount += 4; };
      const unsupportedDraw = value => { try { context.save(function privateFunction() {}); } catch { nativeSucceeded = false; } context.fillStyle = 'opaque-private-string'; context.fillRect(value, 0, 10, 10); context.restore(); selectedOperationCount += 4; };
      if (name === 'reset-only-start') {
        try { selected.width = selected.width; } catch { nativeSucceeded = false; }
        await frame();
        try { selected.width = selected.width; } catch { nativeSucceeded = false; }
        await frame();
      } else if (name === 'proxy-zero-traps') {
        proxyDraw(21); await frame();
        proxyDraw(21); await frame();
        proxyDraw(21); await frame();
      } else {
        normalDraw(21); if (name === 'non-selected-decoy') { decoyContext.fillRect(1, 1, 1, 1); nonSelectedOperationCount++; } await frame();
        if (name === 'unsupported-gap') unsupportedDraw(21);
        else if (name === 'proxy-zero-traps' || name === 'revoked-proxy') proxyDraw(21);
        else normalDraw(21);
        if (name === 'non-selected-decoy') { decoyContext.strokeRect(2, 2, 1, 1); nonSelectedOperationCount++; } await frame();
        normalDraw(name === 'unsupported-gap' ? 22 : 21);
        if (name === 'non-selected-decoy') { decoyContext.clearRect(3, 3, 1, 1); nonSelectedOperationCount++; } await frame();
      }
      const artifact = window.__CANVAS_SCAN__.stopExplanation();
      if (!artifact) throw new Error(`no counterexample artifact for ${name}`);
      decoyContext.fillRect(99, 99, 1, 1);
      await frame();
      const passiveReport = Object.entries(window.__CANVAS_SCAN__.getReports()).find(([canvasId]) => canvasId.startsWith(`${decoy.id}#`))?.[1] ?? null;
      return { artifact, facts: { name, canvasId: artifact.source.canvasId, nativeSucceeded, passiveAlive: !window.__CANVAS_SCAN_COMMAND_CAPTURE_TEST__.isKilled() && passiveReport !== null, passiveReportStatus: passiveReport?.signatureStatus ?? null, trapCount, selectedOperationCount, nonSelectedOperationCount, gap: artifact.firstGap } };
    }, name);
    artifacts[name] = outcome.artifact;
    const result = artifactResult(outcome.artifact);
    outcome.facts.status = result.status;
    outcome.facts.unknownReason = result.unknownReason;
    outcome.facts.ordinal = result.ordinal;
    outcome.facts.reason = result.reason;
    counterexamples.push(outcome.facts);
  }

  for (const [name, artifact] of Object.entries(artifacts)) await writeFile(path.join(output, 'artifacts', `${name}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
  const privacyScan = scanPrivacy(artifacts);
  const allocationCounter = {
    rows: allocationRows,
    totals: {
      noExplanation: allocationRows.reduce((sum, row) => sum + row.noExplanationDelta, 0),
      nonSelected: allocationRows.reduce((sum, row) => sum + row.nonSelectedDelta, 0),
      selected: allocationRows.reduce((sum, row) => sum + row.selectedDelta, 0),
    },
  };
  const actualResults = { rows, counterexamples };
  const expectedResults = { rows: rowNames.map(name => ({ name, ...expectedRows[name] })) };
  const productionBundle = await readFile(path.join(root, 'packages/core/dist/canvas-scan.iife.js'));
  const manifest = {
    schemaVersion: '1',
    probeVersion: '1',
    chromeVersion: browser.version(),
    platform: process.platform,
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
    productionBundleSha256: createHash('sha256').update(productionBundle).digest('hex'),
    diagnosticBundleSha256: bundleSha256,
    limits,
    rows: rowNames,
    counterexamples: counterexampleNames,
  };
  await Promise.all([
    writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(path.join(output, 'expected-results.json'), `${JSON.stringify(expectedResults, null, 2)}\n`),
    writeFile(path.join(output, 'actual-results.json'), `${JSON.stringify(actualResults, null, 2)}\n`),
    writeFile(path.join(output, 'privacy-results.json'), `${JSON.stringify(privacyScan, null, 2)}\n`),
    writeFile(path.join(output, 'allocation-counter.json'), `${JSON.stringify(allocationCounter, null, 2)}\n`),
  ]);
  const checked = checkEvidence({ manifest, expectedResults, actualResults, artifacts, privacyScan, allocationCounter });
  if (!checked.pass) failures.push(...checked.failures);
} catch (error) {
  failures.push(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  try { await browser?.close(); } catch {}
  try { if (server) await new Promise(resolve => server.close(resolve)); } catch {}
}

if (failures.length) { console.error(`SIDPROJ_72_COMMAND_CAPTURE: FAIL ${failures.join('; ')}`); process.exitCode = 1; }
else console.log('SIDPROJ_72_COMMAND_CAPTURE: PASS');
