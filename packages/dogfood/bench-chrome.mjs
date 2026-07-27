import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const baseUrl = process.argv[2] ?? 'http://localhost:5174';
const opsLevels = [100, 1000, 10000];
const modes = ['off', 'passthrough', 'full', 'countonly'];

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

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const BLOCKS = 5;
// Independently warmed blocks with rotated mode order (breaks JIT/ordering
// bias); gates evaluate the MEDIAN of per-block statistics.
const blocks = [];

for (let block = 0; block < BLOCKS; block++) {
  const blockRaw = {};
  const order = modes.map((_, i) => modes[(i + block) % modes.length]);
  for (const ops of opsLevels) {
    blockRaw[ops] = {};
    for (const mode of order) {
      const page = await browser.newPage();
      const url = new URL('/bench.html', baseUrl);
      url.searchParams.set('mode', mode);
      url.searchParams.set('ops', String(ops));
      await page.goto(url.href, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__BENCH?.done, null, { timeout: 60000 });
      blockRaw[ops][mode] = await page.evaluate(() => window.__BENCH.frames);
      await page.close();
    }
  }
  blocks.push(blockRaw);
}

const browserVersion = browser.version();
await browser.close();

const perBlock = blocks.map((blockRaw) => {
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

const medianAcrossBlocks = (metric) =>
  median(perBlock.map((stats) => stats[1000][metric]));

// Gates (agreed budget revision, 2026-07-27 cross-review): absolute added
// cost at the 1,000-iteration level, median across the five blocks.
const gateValues = {
  fullAddedMeanMs: medianAcrossBlocks('fullAddedMeanMs'),
  fullAddedP95Ms: medianAcrossBlocks('fullAddedP95Ms'),
  countOnlyAddedMeanMs: medianAcrossBlocks('countOnlyAddedMeanMs'),
  countOnlyAddedP95Ms: medianAcrossBlocks('countOnlyAddedP95Ms'),
};
const gateChecks = [
  ['fullAddedMeanMs', 2.0],
  ['fullAddedP95Ms', 3.0],
  ['countOnlyAddedMeanMs', 0.75],
  ['countOnlyAddedP95Ms', 2.0],
];
const failures = gateChecks
  .filter(([metric, limit]) => !(gateValues[metric] < limit))
  .map(([metric, limit]) => `${metric} ${gateValues[metric].toFixed(3)}ms >= ${limit}ms`);
const pass = failures.length === 0;
const when = new Date();
const result = {
  when: when.toISOString(),
  browserVersion,
  hardware: {
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
  },
  raw: blocks,
  perBlock,
  gates: { ...gateValues, pass },
};

const resultsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
await mkdir(resultsDir, { recursive: true });
const stamp = when.toISOString().replace(/[:.]/g, '-');
await writeFile(
  path.join(resultsDir, `bench-chrome-${stamp}.json`),
  `${JSON.stringify(result, null, 2)}\n`,
);

const medianMetric = (ops, metric) => median(perBlock.map((s) => s[ops][metric]));
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

console.log(
  pass ? 'RELEASE GATE: PASS' : `RELEASE GATE: FAIL ${failures.join('; ')}`,
);

process.exitCode = pass ? 0 : 1;
