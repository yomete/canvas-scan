import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  lstat,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const tmpRoot = '/private/tmp';
const baselineCommit = '6c80da3eb2f3f9958aefaffaf9647a56f5908efb';
const expectedCandidateSha256 = '26e3694c1647e5627d4fa906d0d939ed889b25c79781e8b25e1dee4c98a043b7';
const streams = ['mixed', 'tracked-source'];
const pairCountPerStream = 6;
const opsLevels = [100, 1000, 10000];
const modes = ['off', 'passthrough', 'full', 'countonly'];
const thresholds = {
  fullAddedMeanMs: 2,
  fullAddedP95Ms: 3,
  countOnlyAddedMeanMs: 0.75,
  countOnlyAddedP95Ms: 2,
};
const pairedFullCapture = { fullAddedMeanMs: 0.25, fullAddedP95Ms: 0.5 };
const metrics = Object.keys(thresholds);

export const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

export const p95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
export const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
export const modeOrderForPair = (index) => modes.map((_, offset) => modes[(index + offset) % modes.length]);
export const pairOrders = (count) => interleavedPairs(count).flatMap((pair) => pair.order);
export const interleavedPairs = (count) => Array.from({ length: count }, (_, index) => ({
  index,
  order: index % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'],
  baselineModeOrder: modeOrderForPair(index),
  candidateModeOrder: modeOrderForPair(index),
}));

export const validateArtifactPath = (artifactPath) => {
  if (!artifactPath || !path.isAbsolute(artifactPath)) throw new Error('artifact path must be absolute');
  if (path.dirname(artifactPath) !== tmpRoot) throw new Error(`artifact path must be under ${tmpRoot}`);
  if (!/^sidproj-53-interleaved-[^.]+\.json$/.test(path.basename(artifactPath))) {
    throw new Error('artifact basename must match sidproj-53-interleaved-*.json');
  }
  if (path.resolve(artifactPath) !== artifactPath) throw new Error('artifact path must not contain traversal');
  return artifactPath;
};

export const writeArtifact = async (artifactPath, artifact) => {
  validateArtifactPath(artifactPath);
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' });
};

export const summarizeBlock = (raw) => {
  const summary = {};
  for (const ops of opsLevels) {
    const modeStats = {};
    for (const mode of modes) {
      const frames = raw[ops]?.[mode];
      if (!Array.isArray(frames) || frames.length !== 240 || frames.some((frame) => !Number.isFinite(frame))) {
        throw new Error(`invalid ${ops}/${mode} frame data`);
      }
      modeStats[mode] = { median: median(frames), p95: p95(frames), mean: mean(frames) };
    }
    summary[ops] = {
      ...modeStats,
      fullAddedMeanMs: modeStats.full.mean - modeStats.off.mean,
      fullAddedP95Ms: modeStats.full.p95 - modeStats.off.p95,
      countOnlyAddedMeanMs: modeStats.countonly.mean - modeStats.off.mean,
      countOnlyAddedP95Ms: modeStats.countonly.p95 - modeStats.off.p95,
      passthroughAddedMeanMs: modeStats.passthrough.mean - modeStats.off.mean,
    };
  }
  return summary;
};

export const pairDeltas = (baseline, candidate) => Object.fromEntries(
  metrics.map((metric) => [metric, candidate[1000][metric] - baseline[1000][metric]]),
);

const absoluteGates = (pairs) => Object.fromEntries(['baseline', 'candidate'].map((variant) => {
  const values = Object.fromEntries(metrics.map((metric) => [
    metric,
    median(pairs.map((pair) => pair[variant].summary[1000][metric])),
  ]));
  const passes = Object.fromEntries(metrics.map((metric) => [metric, values[metric] < thresholds[metric]]));
  return [variant, {
    values,
    passes,
    failures: metrics.filter((metric) => !passes[metric]).map((metric) => `${metric} ${values[metric].toFixed(3)}ms >= ${thresholds[metric]}ms`),
  }];
}));

export const streamVerdict = (pairs) => {
  if (pairs.length !== pairCountPerStream || pairs.some((pair) => !pair.baseline?.summary || !pair.candidate?.summary)) {
    return { status: 'ERROR', reasons: ['incomplete block'] };
  }
  const absolute = absoluteGates(pairs);
  const pairedGateValues = Object.fromEntries(metrics.map((metric) => [
    metric,
    median(pairs.map((pair) => pair.deltas[metric])),
  ]));
  const reasons = [];
  for (const [metric, limit] of Object.entries(pairedFullCapture)) {
    if (pairedGateValues[metric] > limit) reasons.push(`${metric} paired delta ${pairedGateValues[metric].toFixed(3)}ms > ${limit}ms`);
  }
  for (const metric of ['countOnlyAddedMeanMs', 'countOnlyAddedP95Ms']) {
    if (!absolute.candidate.passes[metric]) reasons.push(`candidate ${metric} absolute gate failed`);
  }
  return { status: 'COMPLETE', absoluteGates: absolute, pairedGateValues, verdict: { pass: reasons.length === 0, reasons } };
};

export const experimentVerdict = (streamResults, errors) => {
  if (errors.length > 0 || Object.values(streamResults).some((result) => result.status !== 'COMPLETE')) {
    return { status: 'ERROR', pass: false, reasons: errors.length > 0 ? errors : ['incomplete block'] };
  }
  const reasons = Object.entries(streamResults).flatMap(([stream, result]) => result.verdict.pass ? [] : result.verdict.reasons.map((reason) => `${stream}: ${reason}`));
  return { status: 'COMPLETE', pass: reasons.length === 0, reasons };
};

export const serverOwnership = (listenerPids, processGroupIds, expectedProcessGroupId, childAlive, priorListenerPids) => {
  if (!childAlive) return { ok: false, error: 'workbench server exited' };
  if (!Array.isArray(listenerPids) || listenerPids.length === 0 || listenerPids.some((pid) => !Number.isInteger(pid))) {
    return { ok: false, error: 'missing or malformed listener PID output' };
  }
  const normalizedPids = [...new Set(listenerPids)].sort((left, right) => left - right);
  if (!(processGroupIds instanceof Map) || normalizedPids.some((pid) => !Number.isInteger(processGroupIds.get(pid)))) {
    return { ok: false, error: 'missing or malformed listener process group output' };
  }
  const groups = [...new Set(normalizedPids.map((pid) => processGroupIds.get(pid)))];
  if (groups.length !== 1) return { ok: false, error: 'listener PIDs belong to multiple process groups' };
  if (groups[0] !== expectedProcessGroupId) return { ok: false, error: 'port 5199 listener does not belong to the spawned Vite process group' };
  const normalizedPriorPids = priorListenerPids && [...new Set(priorListenerPids)].sort((left, right) => left - right);
  if (normalizedPriorPids && normalizedPriorPids.join(',') !== normalizedPids.join(',')) {
    return { ok: false, error: 'port 5199 listener ownership changed during readiness check' };
  }
  return { ok: true, listenerPids: normalizedPids };
};

export const captureAndClose = async (capture, close) => {
  const errors = [];
  try { await capture(); } catch (error) { errors.push(error); }
  try { await close(); } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'page capture and close failed');
};

const hashFile = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
const errorText = (error) => error instanceof Error ? error.message : String(error);
const flattenErrors = (error) => error instanceof AggregateError ? error.errors.flatMap(flattenErrors) : [error];
const listenerPids = () => {
  let output;
  try {
    output = execFileSync('lsof', ['-nP', '-iTCP@127.0.0.1:5199', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim();
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
  if (!output) return [];
  const values = output.split('\n').map((value) => Number(value));
  if (values.some((value) => !Number.isInteger(value))) throw new Error('malformed listener PID output');
  return values;
};
const listenerProcessGroups = (pids) => new Map(pids.map((pid) => {
  const output = execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  const pgid = Number(output);
  if (!Number.isInteger(pgid)) throw new Error('malformed listener process group output');
  return [pid, pgid];
}));
const waitForServer = async (server) => {
  const url = 'http://127.0.0.1:5199/bench.html';
  const deadline = Date.now() + 60_000;
  let serverError;
  server.once('error', (error) => { serverError = error; });
  while (Date.now() < deadline) {
    if (serverError) throw serverError;
    if (server.exitCode != null || server.signalCode != null) throw new Error(`workbench server exited with ${server.exitCode ?? server.signalCode}`);
    const firstPids = listenerPids();
    if (firstPids.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    const first = serverOwnership(firstPids, listenerProcessGroups(firstPids), server.pid, server.exitCode == null && server.signalCode == null);
    if (!first.ok) throw new Error(first.error);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status !== 200) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    const secondPids = listenerPids();
    const second = serverOwnership(secondPids, listenerProcessGroups(secondPids), server.pid, server.exitCode == null && server.signalCode == null, first.listenerPids);
    if (!second.ok) throw new Error(second.error);
    if (server.exitCode != null || server.signalCode != null) throw new Error('workbench server exited after readiness fetch');
    return { spawnedPid: server.pid, expectedProcessGroupId: server.pid, listenerPids: second.listenerPids };
  }
  throw new Error('workbench server did not return 200 within 60s');
};

const stopServer = async (server) => {
  if (!server?.pid) return;
  try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; return; }
  if (server.exitCode == null && server.signalCode == null) await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (server.exitCode == null && server.signalCode == null) {
    try { process.kill(-server.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
};

const expectedPaths = (artifactPath) => {
  const suffix = path.basename(artifactPath).slice('sidproj-53-interleaved-'.length, -'.json'.length);
  return {
    snapshot: path.join(tmpRoot, `sidproj-53-interleaved-baseline-source-${suffix}`),
    archive: path.join(tmpRoot, `sidproj-53-interleaved-baseline-source-${suffix}.tar`),
    baselineBundle: path.join(tmpRoot, `sidproj-53-interleaved-baseline-bundle-${suffix}.js`),
    candidateBundle: path.join(tmpRoot, `sidproj-53-interleaved-candidate-bundle-${suffix}.js`),
  };
};

const ensureAbsent = async (target) => {
  try { await lstat(target); throw new Error(`run-owned path already exists: ${target}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
};

const removeFile = async (target) => {
  if (path.resolve(target) !== target || path.dirname(target) !== tmpRoot) throw new Error(`unsafe cleanup path: ${target}`);
  await unlink(target);
};

const removeSnapshot = async (target) => {
  if (path.resolve(target) !== target || path.dirname(target) !== tmpRoot) throw new Error(`unsafe cleanup path: ${target}`);
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`unsafe snapshot path: ${target}`);
  await rm(target, { recursive: true });
};

const collectBlock = async (browser, stream, pairIndex, bundle, block) => {
  const raw = block.raw;
  const order = modeOrderForPair(pairIndex);
  for (const ops of opsLevels) {
    raw[ops] = {};
    for (const mode of order) {
      const page = await browser.newPage();
      let bundleRequests = 0;
      await captureAndClose(async () => {
        await page.route('**/canvas-scan.iife.js', async (route) => {
          bundleRequests++;
          await route.fulfill({ path: bundle, contentType: 'application/javascript' });
        });
        const url = new URL('/bench.html', 'http://127.0.0.1:5199');
        url.searchParams.set('mode', mode);
        url.searchParams.set('ops', String(ops));
        url.searchParams.set('stream', stream);
        await page.goto(url.href, { waitUntil: 'load' });
        const loaded = await page.evaluate(() => window.__CANVAS_SCAN__ != null);
        if ((mode === 'full' || mode === 'countonly') && !loaded) throw new Error('canvas-scan did not load');
        if ((mode === 'off' || mode === 'passthrough') && loaded) throw new Error(`canvas-scan loaded in ${mode} mode`);
        if ((mode === 'full' || mode === 'countonly') ? bundleRequests !== 1 : bundleRequests !== 0) throw new Error(`unexpected bundle requests in ${mode}: ${bundleRequests}`);
        await page.waitForFunction(() => window.__BENCH?.done, null, { timeout: 60_000 });
        const frames = await page.evaluate(() => window.__BENCH.frames);
        if (!Array.isArray(frames) || frames.length !== 240 || frames.some((frame) => !Number.isFinite(frame))) throw new Error(`invalid frame capture for ${ops}/${mode}`);
        raw[ops][mode] = frames;
      }, () => page.close());
    }
  }
  block.modeOrder = order;
  block.summary = summarizeBlock(raw);
};

const main = async () => {
  const artifactArg = process.argv.slice(2).find((arg) => arg.startsWith('--artifact='));
  const artifactPath = validateArtifactPath(artifactArg?.slice('--artifact='.length));
  if (process.argv.slice(2).filter((arg) => arg.startsWith('--artifact=')).length !== 1) throw new Error('exactly one --artifact option is required');
  const paths = expectedPaths(artifactPath);
  await ensureAbsent(artifactPath);
  for (const target of Object.values(paths)) await ensureAbsent(target);

  const startedAt = new Date().toISOString();
  const artifact = {
    schemaVersion: 1,
    experimentId: path.basename(artifactPath, '.json'),
    status: 'ERROR',
    startedAt,
    endedAt: null,
    purpose: 'method-corrected interleaved SIDPROJ-53 A/B',
    baselineCommit,
    activeHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    activeWorktreeDirty: execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim().length > 0,
    inputs: { candidateExpectedBundleSha256: expectedCandidateSha256, streamOrder: streams, pairCountPerStream, pairOrder: pairOrders(pairCountPerStream), opsLevels, modes, warmupFrames: 30, measuredFrames: 240 },
    thresholds: { absolute: thresholds, pairedFullCapture },
    hashes: {},
    environment: { browserVersion: null, hardware: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model, cores: os.cpus().length } },
    streams: { mixed: { pairs: [] }, 'tracked-source': { pairs: [] } },
    verdict: { pass: false, reasons: [] },
    errors: [],
    cleanup: {},
  };
  let server;
  let browser;
  try {
    execFileSync('git', ['archive', '--format=tar', `--output=${paths.archive}`, baselineCommit], { cwd: repoRoot });
    await mkdir(paths.snapshot);
    execFileSync('tar', ['-xf', paths.archive, '-C', paths.snapshot]);
    const corePackage = path.join(repoRoot, 'packages/core/package.json');
    const require = createRequire(pathToFileURL(corePackage));
    const esbuild = require('esbuild');
    const build = (entry, outfile) => esbuild.build({ entryPoints: [entry], outfile, bundle: true, format: 'iife', minify: true, nodePaths: [path.join(repoRoot, 'packages/core/node_modules')] });
    await build(path.join(paths.snapshot, 'packages/core/src/auto.ts'), paths.baselineBundle);
    await build(path.join(repoRoot, 'packages/core/src/auto.ts'), paths.candidateBundle);
    artifact.hashes.baselineBundleSha256 = await hashFile(paths.baselineBundle);
    artifact.hashes.candidateBundleSha256 = await hashFile(paths.candidateBundle);
    artifact.hashes.harnessSha256 = await hashFile(fileURLToPath(import.meta.url));
    artifact.hashes.benchPageSha256 = await hashFile(path.join(repoRoot, 'apps/workbench/public/bench.html'));
    if (artifact.hashes.candidateBundleSha256 !== expectedCandidateSha256) throw new Error(`candidate bundle hash mismatch: ${artifact.hashes.candidateBundleSha256}`);
    server = spawn('pnpm', ['--filter', 'workbench', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5199', '--strictPort'], { cwd: repoRoot, stdio: 'inherit', detached: true });
    artifact.environment.server = await waitForServer(server);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    artifact.environment.browserVersion = browser.version();
    for (const stream of streams) {
      for (const plan of interleavedPairs(pairCountPerStream)) {
        const { index } = plan;
        const pair = {
          index,
          order: plan.order,
          baseline: { variant: 'baseline', pairIndex: index, modeOrder: plan.baselineModeOrder, raw: {} },
          candidate: { variant: 'candidate', pairIndex: index, modeOrder: plan.candidateModeOrder, raw: {} },
          deltas: null,
        };
        artifact.streams[stream].pairs.push(pair);
        for (const variant of plan.order) {
          await collectBlock(browser, stream, index, paths[`${variant}Bundle`], pair[variant]);
        }
        pair.deltas = pairDeltas(pair.baseline.summary, pair.candidate.summary);
      }
    }
    if (!browser.isConnected()) throw new Error('Chrome disconnected during measurement');
    if (browser.version() !== artifact.environment.browserVersion) throw new Error('Chrome version changed during measurement');
  } catch (error) { artifact.errors.push(...flattenErrors(error).map(errorText)); }
  finally {
    for (const [name, action] of [
      ['browserClose', async () => browser?.close()],
      ['serverStop', async () => stopServer(server)],
      ['baselineSnapshotRemoval', async () => removeSnapshot(paths.snapshot)],
      ['baselineArchiveRemoval', async () => removeFile(paths.archive)],
      ['baselineBundleRemoval', async () => removeFile(paths.baselineBundle)],
      ['candidateBundleRemoval', async () => removeFile(paths.candidateBundle)],
    ]) {
      try { await action(); artifact.cleanup[name] = { ok: true }; } catch (error) { artifact.cleanup[name] = { ok: false, error: errorText(error) }; artifact.errors.push(`${name}: ${errorText(error)}`); }
    }
  }
  const results = Object.fromEntries(streams.map((stream) => [stream, streamVerdict(artifact.streams[stream].pairs)]));
  for (const stream of streams) Object.assign(artifact.streams[stream], results[stream]);
  const verdict = experimentVerdict(results, artifact.errors);
  artifact.status = verdict.status;
  artifact.verdict = { pass: verdict.pass, reasons: verdict.reasons };
  artifact.endedAt = new Date().toISOString();
  await writeArtifact(artifactPath, artifact);
  console.log(`${artifactPath} ${artifact.status === 'COMPLETE' ? (artifact.verdict.pass ? 'PASS' : 'FAIL') : 'ERROR'}`);
  if (artifact.status === 'ERROR') process.exitCode = 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(errorText(error)); process.exitCode = 1; });
}
