import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const sourceBundle = path.join(repoRoot, 'packages/core/dist/canvas-scan.iife.js');
const workbenchBundle = path.join(repoRoot, 'apps/workbench/public/canvas-scan.iife.js');
const args = process.argv.slice(2);
const positionalArgs = args.filter((arg) => !arg.startsWith('--'));
const streamFlag = args.find((arg) => arg.startsWith('--stream='));
const baseUrlOverride = positionalArgs[0];
const baseUrl = baseUrlOverride ?? 'http://localhost:5199';
const stream =
  streamFlag?.slice('--stream='.length) ??
  positionalArgs[1] ??
  'mixed';
const selfContained = baseUrlOverride == null;
const opsLevels = [100, 1000, 10000];
const modes = ['off', 'passthrough', 'full', 'countonly'];
const thresholds = {
  fullAddedMeanMs: 2,
  fullAddedP95Ms: 3,
  countOnlyAddedMeanMs: 0.75,
  countOnlyAddedP95Ms: 2,
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const p95 = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
};

// Headless Chrome clamps performance.now() to 100µs granularity; means over
// 240 frames recover sub-clamp precision where quantized medians cannot.
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

const runCommand = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });

const waitForServer = async (url, server) => {
  const deadline = Date.now() + 60_000;
  let serverError;
  server.once('error', (error) => {
    serverError = error;
  });
  while (Date.now() < deadline) {
    if (serverError) throw serverError;
    if (server.exitCode != null || server.signalCode != null) {
      throw new Error(
        `workbench server exited with ${server.exitCode ?? server.signalCode}`,
      );
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`workbench server did not return 200 within 60s: ${url}`);
};

const stopServer = async (server) => {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
    return;
  }
  if (server.exitCode == null && server.signalCode == null) {
    await Promise.race([
      once(server, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
  if (server.exitCode != null || server.signalCode != null) return;
  try {
    process.kill(-server.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
};

const hashFile = async (file) =>
  createHash('sha256').update(await readFile(file)).digest('hex');

const hashUrl = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not load bundle for hashing: ${response.status}`);
  return createHash('sha256')
    .update(Buffer.from(await response.arrayBuffer()))
    .digest('hex');
};

const git = {
  sha: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim(),
  dirty:
    execFileSync('git', ['status', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim().length > 0,
};

const collectBlocks = async (browser) => {
  const blocks = [];
  const blockCount = 5;
  // Independently warmed blocks with rotated mode order (breaks JIT/ordering
  // bias); gates evaluate the MEDIAN of per-block statistics.
  for (let block = 0; block < blockCount; block++) {
    const blockRaw = {};
    const order = modes.map((_, i) => modes[(i + block) % modes.length]);
    for (const ops of opsLevels) {
      blockRaw[ops] = {};
      for (const mode of order) {
        const page = await browser.newPage();
        try {
          const url = new URL('/bench.html', baseUrl);
          url.searchParams.set('mode', mode);
          url.searchParams.set('ops', String(ops));
          url.searchParams.set('stream', stream);
          await page.goto(url.href, { waitUntil: 'load' });
          const loaded = await page.evaluate(() => window.__CANVAS_SCAN__ != null);
          if ((mode === 'full' || mode === 'countonly') && !loaded) {
            throw new Error('canvas-scan did not load');
          }
          if ((mode === 'off' || mode === 'passthrough') && loaded) {
            throw new Error(`canvas-scan loaded in ${mode} mode`);
          }
          await page.waitForFunction(() => window.__BENCH?.done, null, { timeout: 60000 });
          blockRaw[ops][mode] = await page.evaluate(() => window.__BENCH.frames);
        } finally {
          await page.close();
        }
      }
    }
    blocks.push(blockRaw);
  }
  return blocks;
};

const summarizeBlocks = (blocks) => blocks.map((blockRaw) => {
  const stats = {};
  for (const ops of opsLevels) {
    const modeStats = {};
    for (const mode of modes) {
      modeStats[mode] = {
        median: median(blockRaw[ops][mode]),
        p95: p95(blockRaw[ops][mode]),
        mean: mean(blockRaw[ops][mode]),
      };
    }
    stats[ops] = {
      ...modeStats,
      fullAddedMeanMs: modeStats.full.mean - modeStats.off.mean,
      fullAddedP95Ms: modeStats.full.p95 - modeStats.off.p95,
      countOnlyAddedMeanMs: modeStats.countonly.mean - modeStats.off.mean,
      countOnlyAddedP95Ms: modeStats.countonly.p95 - modeStats.off.p95,
      // evidence, not a gate: the floor an EMPTY wrapper pays (no canvas-scan)
      passthroughAddedMeanMs: modeStats.passthrough.mean - modeStats.off.mean,
    };
  }
  return stats;
});

const when = new Date();
let server;
let browser;
let browserVersion = null;
let bundleSha256 = null;
let blocks = [];
let failures = [];

try {
  if (selfContained) {
    await runCommand('pnpm', [
      '--filter',
      'canvas-scan',
      'exec',
      'esbuild',
      'src/auto.ts',
      '--bundle',
      '--format=iife',
      '--outfile=dist/canvas-scan.iife.js',
      '--minify',
    ]);
    await copyFile(sourceBundle, workbenchBundle);
    server = spawn(
      'pnpm',
      ['--filter', 'workbench', 'exec', 'vite', '--port', '5199', '--strictPort'],
      { cwd: repoRoot, stdio: 'inherit', detached: true },
    );
    await waitForServer(baseUrl, server);
    bundleSha256 = await hashFile(workbenchBundle);
  } else {
    bundleSha256 = await hashUrl(new URL('/canvas-scan.iife.js', baseUrl));
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  browserVersion = browser.version();
  blocks = await collectBlocks(browser);
} catch (error) {
  failures = [error instanceof Error ? error.message : String(error)];
} finally {
  try {
    await browser?.close();
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  try {
    await stopServer(server);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
}

const perBlock = summarizeBlocks(blocks);
let gateValues = {};
if (failures.length === 0) {
  const medianAcrossBlocks = (metric) =>
    median(perBlock.map((stats) => stats[1000][metric]));
  // Gates (agreed budget revision, 2026-07-27 cross-review): absolute added
  // cost at the 1,000-iteration level, median across the five blocks.
  gateValues = {
    fullAddedMeanMs: medianAcrossBlocks('fullAddedMeanMs'),
    fullAddedP95Ms: medianAcrossBlocks('fullAddedP95Ms'),
    countOnlyAddedMeanMs: medianAcrossBlocks('countOnlyAddedMeanMs'),
    countOnlyAddedP95Ms: medianAcrossBlocks('countOnlyAddedP95Ms'),
  };
  failures = Object.entries(thresholds)
    .filter(([metric, limit]) => !(gateValues[metric] < limit))
    .map(([metric, limit]) => `${metric} ${gateValues[metric].toFixed(3)}ms >= ${limit}ms`);
}
const pass = failures.length === 0;
const result = {
  when: when.toISOString(),
  selfContained,
  baseUrl,
  stream,
  git,
  bundleSha256,
  browserVersion,
  hardware: {
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
  },
  thresholds,
  failures,
  raw: blocks,
  perBlock,
  gates: { ...gateValues, pass },
};

const resultsDir = path.join(scriptDir, 'results');
await mkdir(resultsDir, { recursive: true });
const stamp = when.toISOString().replace(/[:.]/g, '-');
await writeFile(
  path.join(resultsDir, `bench-chrome-${stamp}.json`),
  `${JSON.stringify(result, null, 2)}\n`,
);

const medianMetric = (ops, metric) => median(perBlock.map((s) => s[ops][metric]));
if (perBlock.length > 0) {
  console.table(
    opsLevels.map((ops) => ({
      ops,
      'off mean': median(perBlock.map((s) => s[ops].off.mean)).toFixed(3),
      'passthru added': medianMetric(ops, 'passthroughAddedMeanMs').toFixed(3),
      'full added mean': medianMetric(ops, 'fullAddedMeanMs').toFixed(3),
      'full added p95': medianMetric(ops, 'fullAddedP95Ms').toFixed(3),
      'countonly added mean': medianMetric(ops, 'countOnlyAddedMeanMs').toFixed(3),
      'countonly added p95': medianMetric(ops, 'countOnlyAddedP95Ms').toFixed(3),
    })),
  );
}

console.log(
  pass ? 'RELEASE GATE: PASS' : `RELEASE GATE: FAIL (reason '${failures.join('; ')}')`,
);

process.exitCode = pass ? 0 : 1;
