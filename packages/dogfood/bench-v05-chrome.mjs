import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import os from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 5210;
export const pairCount = 20;
export const thresholds = { meanMs: 4, p95Ms: 8 };
const resultKeys = ['schemaVersion', 'pairs', 'deltas', 'noSelection', 'thresholds', 'chromeRevision', 'hardware', 'gitSha', 'dirty', 'hashes', 'port', 'failures'];
const pairKeys = ['order', 'states'];
const stateKeys = ['mode', 'done', 'frames', 'sourceFindingIndex', 'startResult', 'countersBefore', 'countersAfter', 'diagnostics', 'stopResult'];
const counterKeys = ['commandEntryAllocations', 'stackAllocations'];
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
export const classifyFailure = value => /EADDRINUSE|ENOTFOUND|EAI_AGAIN|ECONN(?:REFUSED|RESET)|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|Chrome unavailable|browserType\.launch|Executable doesn't exist|server did not/i.test(String(value)) ? 'ENVIRONMENT_FAILURE' : 'PRODUCT_FAILURE';
export const pairOrder = (index) => index % 2 === 0 ? ['v04-full', 'v05-selected'] : ['v05-selected', 'v04-full'];
export const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
export const nearestRankP95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1];
export const counterDelta = (state) => ({
  commandEntryAllocations: state.countersAfter.commandEntryAllocations,
  stackAllocations: state.countersAfter.stackAllocations,
});
export const pairedDeltas = pairs => pairs.flatMap(pair => {
  const full = pair.states.find(state => state.mode === 'v04-full')?.frames ?? [];
  const selected = pair.states.find(state => state.mode === 'v05-selected')?.frames ?? [];
  return selected.map((value, index) => value - full[index]);
});
function checkState(state, mode) {
  if (!exactKeys(state, stateKeys) || state.mode !== mode || state.done !== true || !Array.isArray(state.frames) || state.frames.length !== 4 || state.frames.some(value => !Number.isFinite(value)) || !Number.isInteger(state.sourceFindingIndex) || state.sourceFindingIndex < 0 || !exactKeys(state.countersBefore, counterKeys) || !exactKeys(state.countersAfter, counterKeys) || Object.values(state.countersBefore).some(value => !Number.isInteger(value) || value < 0) || Object.values(state.countersAfter).some(value => !Number.isInteger(value) || value < 0) || !Array.isArray(state.diagnostics) || state.diagnostics.length || state.stopResult !== true) return false;
  return state.startResult === (mode === 'v05-selected' ? 'started' : 'not-requested');
}
export function checkRun(result) {
  const failures = [];
  if (result.schemaVersion !== 1) failures.push('schema changed');
  if (result.pairs?.length !== pairCount) failures.push('incomplete pairs');
  if (result.pairs?.some((pair, index) => !exactKeys(pair, pairKeys) || JSON.stringify(pair.order) !== JSON.stringify(pairOrder(index)) || !Array.isArray(pair.states) || pair.states.length !== 2 || pair.states.map(state => state.mode).join('|') !== pair.order.join('|'))) failures.push('pair order or schema changed');
  const selected = result.pairs?.flatMap(pair => pair.states.filter(state => state.mode === 'v05-selected')) ?? [];
  const full = result.pairs?.flatMap(pair => pair.states.filter(state => state.mode === 'v04-full')) ?? [];
  if (selected.length !== pairCount || full.length !== pairCount) failures.push('variant count changed');
  for (const state of selected) if (!checkState(state, 'v05-selected')) failures.push('invalid selected page state');
  for (const state of full) if (!checkState(state, 'v04-full')) failures.push('invalid full page state');
  if (!checkState(result.noSelection, 'v05-no-selection')) failures.push('invalid no-selection page state');
  const deltas = result.deltas ?? [];
  if (deltas.length !== 80 || deltas.some(value => !Number.isFinite(value))) failures.push('invalid paired deltas');
  const recomputed = pairedDeltas(result.pairs ?? []);
  if (JSON.stringify(deltas) !== JSON.stringify(recomputed)) failures.push('paired deltas changed');
  if (result.noSelection?.countersAfter?.commandEntryAllocations !== 0 || result.noSelection?.countersAfter?.stackAllocations !== 0) failures.push('no-selection allocated detail');
  if (selected.some(state => counterDelta(state).commandEntryAllocations <= 0 || counterDelta(state).stackAllocations <= 0)) failures.push('selected detail was vacuous');
  if (result.thresholds?.meanMs !== thresholds.meanMs || result.thresholds?.p95Ms !== thresholds.p95Ms) failures.push('threshold changed');
  if (!(mean(deltas) < thresholds.meanMs)) failures.push('mean threshold failed');
  if (!(nearestRankP95(deltas) < thresholds.p95Ms)) failures.push('p95 threshold failed');
  return failures;
}
export function checkEvidence(result, expected = {}) {
  const failures = [];
  if (!exactKeys(result, resultKeys)) return ['result schema keys changed'];
  failures.push(...checkRun(result));
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(result.chromeRevision ?? '')) failures.push('Chrome revision missing');
  if (!exactKeys(result.hardware, ['cpu', 'cores']) || !result.hardware.cpu || !Number.isInteger(result.hardware.cores) || result.hardware.cores < 1) failures.push('hardware facts missing');
  if (!/^[0-9a-f]{40}$/.test(result.gitSha ?? '') || typeof result.dirty !== 'boolean') failures.push('Git facts missing');
  if (!exactKeys(result.hashes, ['diagnosticBundleSha256', 'diagnosticSourceSha256', 'htmlSha256', 'harnessSha256', 'productionIifeSha256']) || Object.values(result.hashes ?? {}).some(value => !/^[0-9a-f]{64}$/.test(value ?? ''))) failures.push('benchmark hashes missing');
  if (!exactKeys(result.port, ['number', 'ownerPid', 'listenersBefore', 'listenersDuring', 'listenersAfter']) || result.port.number !== port || !Number.isInteger(result.port.ownerPid) || result.port.listenersBefore?.length || result.port.listenersAfter?.length || result.port.listenersDuring?.join('|') !== String(result.port.ownerPid)) failures.push('port ownership changed');
  if ('gitSha' in expected && result.gitSha !== expected.gitSha) failures.push('Git SHA changed');
  if ('harnessSha256' in expected && result.hashes?.harnessSha256 !== expected.harnessSha256) failures.push('harness hash changed');
  if ('productionIifeSha256' in expected && result.hashes?.productionIifeSha256 !== expected.productionIifeSha256) failures.push('production IIFE hash changed');
  if ('htmlSha256' in expected && result.hashes?.htmlSha256 !== expected.htmlSha256) failures.push('benchmark HTML hash changed');
  if ('diagnosticSourceSha256' in expected && result.hashes?.diagnosticSourceSha256 !== expected.diagnosticSourceSha256) failures.push('diagnostic source hash changed');
  if (result.failures?.join('|') !== checkRun({ ...result, failures: undefined }).join('|')) failures.push('recorded failures changed');
  return failures;
}
const listenerPids = () => {
  try { return execFileSync('lsof', ['-nP', '-iTCP@127.0.0.1:5210', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); }
  catch (error) { if (error.status === 1) return []; throw error; }
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function main() {
  const listenersBefore = listenerPids();
  if (listenersBefore.length) throw new Error('ENVIRONMENT_FAILURE: port 5210 already has a listener');
  const runId = `${Date.now()}-${process.pid}`;
  const output = `/private/tmp/sidproj-70-bench-v05-${runId}.json`;
  const directory = `/private/tmp/sidproj-70-bench-v05-${runId}`;
  await mkdir(directory, { recursive: false });
  const bundle = path.join(directory, 'bench-v05-diagnostic.js');
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'exec', 'esbuild', '../dogfood/v05-bench-diagnostic.ts', '--bundle', '--format=iife', `--outfile=${bundle}`], { cwd: root, stdio: 'inherit' });
  const htmlPath = path.join(root, 'apps/workbench/public/bench-v05.html');
  const diagnosticPath = path.join(root, 'packages/dogfood/v05-bench-diagnostic.ts');
  const harnessPath = fileURLToPath(import.meta.url);
  const iifePath = path.join(root, 'packages/core/dist/canvas-scan.iife.js');
  const [html, bytes, diagnosticSource, harness, productionIife] = await Promise.all([readFile(htmlPath), readFile(bundle), readFile(diagnosticPath), readFile(harnessPath), readFile(iifePath)]);
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/bench-v05-diagnostic.js')) { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(bytes); return; }
    if (request.url?.startsWith('/bench-v05.html')) { response.writeHead(200, { 'content-type': 'text/html' }); response.end(html); return; }
    response.writeHead(404); response.end();
  });
  let browser;
  try {
    await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
    const listenersDuring = listenerPids();
    if (listenersDuring.join('|') !== String(process.pid)) throw new Error('ENVIRONMENT_FAILURE: port 5210 listener ownership changed');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const visit = async (mode) => { const page = await browser.newPage(); try { await page.goto(`http://127.0.0.1:${port}/bench-v05.html?mode=${mode}`); await page.waitForFunction(() => window.__BENCH_V05__?.done || window.__BENCH_V05__?.diagnostics?.length); return await page.evaluate(() => window.__BENCH_V05__); } finally { await page.close(); } };
    const noSelectionState = await visit('v05-no-selection');
    const pairs = [];
    for (let index = 0; index < pairCount; index++) { const order = pairOrder(index); pairs.push({ order, states: [await visit(order[0]), await visit(order[1])] }); }
    const deltas = pairedDeltas(pairs);
    const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim();
    const cpus = os.cpus();
    const artifact = { schemaVersion: 1, pairs, deltas, noSelection: noSelectionState, thresholds, chromeRevision: await browser.version(), hardware: { cpu: cpus[0]?.model ?? process.arch, cores: cpus.length }, gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirty: Boolean(status), hashes: { diagnosticBundleSha256: hash(bytes), diagnosticSourceSha256: hash(diagnosticSource), htmlSha256: hash(html), harnessSha256: hash(harness), productionIifeSha256: hash(productionIife) }, port: { number: port, ownerPid: process.pid, listenersBefore, listenersDuring, listenersAfter: [] } };
    artifact.failures = checkRun(artifact);
    await browser?.close(); browser = undefined;
    await new Promise(resolve => server.close(resolve));
    artifact.port.listenersAfter = listenerPids();
    artifact.failures = checkEvidence(artifact);
    await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
    console.log(output);
    if (artifact.failures.length) process.exitCode = 1;
  } finally { await browser?.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); }
}
if (process.argv[2] === '--check-evidence') {
  const result = JSON.parse(await readFile(process.argv[3], 'utf8'));
  const failures = checkEvidence(result);
  if (failures.length) throw new Error(failures.join('; '));
  console.log('BENCH_V05_EVIDENCE: PASS');
} else if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`${classifyFailure(error)}: ${error instanceof Error ? error.stack : error}`); process.exitCode = 1; });
