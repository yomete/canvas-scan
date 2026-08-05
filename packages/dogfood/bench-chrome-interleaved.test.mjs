import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  experimentVerdict,
  captureAndClose,
  interleavedPairs,
  modeOrderForPair,
  pairDeltas,
  pairOrders,
  streamVerdict,
  serverOwnership,
  validateArtifactPath,
  writeArtifact,
} from './bench-chrome-interleaved.mjs';

const summary = (value, overrides = {}) => ({ 1000: {
  fullAddedMeanMs: value,
  fullAddedP95Ms: value,
  countOnlyAddedMeanMs: value,
  countOnlyAddedP95Ms: value,
  ...overrides,
} });
const pair = (baseline, candidate) => ({ baseline: { summary: summary(baseline) }, candidate: { summary: summary(candidate) }, deltas: pairDeltas(summary(baseline), summary(candidate)) });
const pairs = (baseline = 0, candidate = 0) => Array.from({ length: 6 }, () => pair(baseline, candidate));

test('six pairs produce balanced orders and share rotated mode order', () => {
  const plans = interleavedPairs(6);
  assert.deepEqual(pairOrders(6), [
    'baseline', 'candidate',
    'candidate', 'baseline',
    'baseline', 'candidate',
    'candidate', 'baseline',
    'baseline', 'candidate',
    'candidate', 'baseline',
  ]);
  assert.equal(plans.filter((plan) => plan.order.join(',') === 'baseline,candidate').length, 3);
  assert.equal(plans.filter((plan) => plan.order.join(',') === 'candidate,baseline').length, 3);
  for (const plan of plans) {
    assert.deepEqual(plan.order, plan.index % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline']);
    assert.deepEqual(plan.baselineModeOrder, plan.candidateModeOrder);
    assert.deepEqual(plan.baselineModeOrder, modeOrderForPair(plan.index));
  }
});

test('a constant second-position penalty has a zero paired median', () => {
  const plannedPairs = interleavedPairs(6).map((plan) => {
    const blocks = Object.fromEntries(plan.order.map((variant, index) => [
      variant,
      { summary: summary(index === 0 ? 0 : 1) },
    ]));
    return {
      ...blocks,
      deltas: pairDeltas(blocks.baseline.summary, blocks.candidate.summary),
    };
  });
  const deltas = plannedPairs.map((plannedPair) => plannedPair.deltas.fullAddedMeanMs);
  assert.deepEqual(deltas.filter((delta) => delta === 1), [1, 1, 1]);
  assert.deepEqual(deltas.filter((delta) => delta === -1), [-1, -1, -1]);
  assert.equal(streamVerdict(plannedPairs).pairedGateValues.fullAddedMeanMs, 0);
});

test('pair deltas use candidate minus baseline and preserve negatives', () => {
  assert.equal(pairDeltas(summary(3), summary(1)).fullAddedMeanMs, -2);
});

test('paired medians use six deltas rather than aggregate subtraction', () => {
  const baselines = [1, 11, 21, 31, 41, 51];
  const candidates = [101, 12, 22, 32, 42, 52];
  const result = streamVerdict(baselines.map((baseline, index) => pair(baseline, candidates[index])));
  assert.equal(result.pairedGateValues.fullAddedMeanMs, 1);
  assert.equal(37 - 26, 11);
});

test('server readiness needs one owned listener before and after fetch', () => {
  assert.equal(serverOwnership([1], new Map([[1, 2]]), 3, true).ok, false);
  assert.equal(serverOwnership([1], new Map([[1, 3]]), 3, true).ok, true);
  assert.equal(serverOwnership([1], new Map([[1, 3]]), 3, false).ok, false);
  assert.equal(serverOwnership([1], new Map([[1, 3]]), 3, false, [1]).ok, false);
  assert.equal(serverOwnership([2], new Map([[2, 3]]), 3, true, [1]).ok, false);
  assert.deepEqual(serverOwnership([2, 1], new Map([[1, 3], [2, 3]]), 3, true, [1, 2]).listenerPids, [1, 2]);
  assert.equal(serverOwnership([1, 2], new Map([[1, 3], [2, 4]]), 3, true).ok, false);
  assert.equal(serverOwnership([], new Map(), 3, true).ok, false);
  assert.equal(serverOwnership([1], new Map(), 3, true).ok, false);
});

test('capture and close preserve each error in order', async () => {
  await captureAndClose(async () => {}, async () => {});
  await assert.rejects(() => captureAndClose(async () => { throw new Error('capture'); }, async () => {}), /capture/);
  await assert.rejects(() => captureAndClose(async () => {}, async () => { throw new Error('close'); }), /close/);
  await assert.rejects(
    () => captureAndClose(async () => { throw new Error('capture'); }, async () => { throw new Error('close'); }),
    (error) => error instanceof AggregateError && error.errors.map((item) => item.message).join(',') === 'capture,close',
  );
});

test('absolute limits are strict and paired full-capture tolerances include boundaries', () => {
  const absolute = streamVerdict(Array.from({ length: 6 }, () => ({
    baseline: { summary: summary(0) },
    candidate: { summary: summary(0, {
      fullAddedMeanMs: 2,
      fullAddedP95Ms: 3,
      countOnlyAddedMeanMs: 0.75,
      countOnlyAddedP95Ms: 2,
    }) },
    deltas: { fullAddedMeanMs: 0, fullAddedP95Ms: 0, countOnlyAddedMeanMs: 0, countOnlyAddedP95Ms: 0 },
  })));
  assert.deepEqual(absolute.absoluteGates.candidate.passes, {
    fullAddedMeanMs: false,
    fullAddedP95Ms: false,
    countOnlyAddedMeanMs: false,
    countOnlyAddedP95Ms: false,
  });
  const exactPaired = Array.from({ length: 6 }, () => ({
    baseline: { summary: summary(0) },
    candidate: { summary: summary(0, { fullAddedMeanMs: 0.25, fullAddedP95Ms: 0.5 }) },
    deltas: { fullAddedMeanMs: 0.25, fullAddedP95Ms: 0.5, countOnlyAddedMeanMs: 0, countOnlyAddedP95Ms: 0 },
  }));
  const paired = streamVerdict(exactPaired);
  assert.equal(paired.verdict.reasons.some((reason) => reason.includes('fullAddedMeanMs')), false);
  assert.equal(paired.verdict.reasons.some((reason) => reason.includes('fullAddedP95Ms')), false);
});

test('a stream verdict requires candidate count-only absolute limits', () => {
  const meanFailure = streamVerdict(pairs(0, 0.75));
  const p95Failure = streamVerdict(Array.from({ length: 6 }, () => ({
    baseline: { summary: summary(0) },
    candidate: { summary: summary(0, { countOnlyAddedP95Ms: 2 }) },
    deltas: { fullAddedMeanMs: 0, fullAddedP95Ms: 0, countOnlyAddedMeanMs: 0, countOnlyAddedP95Ms: 0 },
  })));
  assert.equal(meanFailure.verdict.pass, false);
  assert.equal(p95Failure.verdict.pass, false);
});

test('both streams must pass and incomplete blocks are errors', () => {
  const pass = streamVerdict(pairs());
  const fail = streamVerdict(pairs(0, 1));
  assert.equal(experimentVerdict({ mixed: pass, 'tracked-source': fail }, []).pass, false);
  assert.equal(streamVerdict(pairs().slice(0, 4)).status, 'ERROR');
});

test('artifact writes are immutable and paths are constrained', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sidproj-53-interleaved-test-'));
  const artifact = path.join('/private/tmp', `sidproj-53-interleaved-${path.basename(directory)}.json`);
  try {
    await writeArtifact(artifact, { value: 1 });
    const first = await readFile(artifact, 'utf8');
    await assert.rejects(() => writeArtifact(artifact, { value: 2 }));
    assert.equal(await readFile(artifact, 'utf8'), first);
    assert.throws(() => validateArtifactPath('../sidproj-53-interleaved-test.json'));
    assert.throws(() => validateArtifactPath('/private/tmp/nested/../sidproj-53-interleaved-test.json'));
    assert.throws(() => validateArtifactPath('/tmp/sidproj-53-interleaved-test.json'));
    assert.throws(() => validateArtifactPath('/private/tmp/not-interleaved.json'));
  } finally {
    await rm(artifact, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});
