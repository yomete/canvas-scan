// The north-star benchmark protocol and its scorer. No browser, no
// participant, no network — this is the part that must hold before six people
// are asked for two hours each.
//
// Run: node --test benchmark-score.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARMS, BenchmarkError, FORBIDDEN_CLAIM_SOURCES, PROTOCOL, RUN_STATUSES,
  checkAnswerKey, checkManifest, claimSentence, judge, refuseClaimFrom, scoreRun, summarize,
} from './benchmark-score.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const benchmark = path.join(here, 'benchmark');
const manifest = JSON.parse(readFileSync(path.join(benchmark, 'manifest.json'), 'utf8'));
const answers = JSON.parse(readFileSync(path.join(benchmark, 'answers.json'), 'utf8'));
const refuses = pattern => error => error instanceof BenchmarkError && pattern.test(error.message);

const task = manifest.tasks[0];
const key = answers.keys[task.id];
const run = (over = {}) => ({
  participantId: 'p1', arm: 'canvas-scan', elapsedSeconds: 120,
  answer: { canvas: key.canvas, cause: key.cause, nextCheck: 'stop redrawing on pointermove' },
  ...over,
});

// ------------------------------------------------------------ the fixtures

test('the benchmark ships six tasks, each with a page that exists', () => {
  assert.equal(checkManifest(manifest), manifest);
  assert.equal(manifest.tasks.length, 6);
  for (const item of manifest.tasks) {
    assert.ok(existsSync(path.join(benchmark, 'pages', item.page)), `${item.id} has no page`);
    assert.ok(item.symptom.length > 0, `${item.id} tells the participant nothing`);
    assert.ok(item.interaction.length > 0, `${item.id} defines no interaction`);
  }
});

test('both arms get the same fixtures, interactions and answer form', () => {
  // There is one list of tasks and one list of causes. Neither is per-arm, so
  // an arm cannot be given an easier fixture or a shorter list to choose from.
  assert.deepEqual(manifest.arms, [...ARMS]);
  assert.equal(manifest.tasks.filter(item => 'arm' in item).length, 0);
  assert.ok(manifest.causeTags.length >= 8, 'the closed cause list is too short to be a real choice');
});

test('the text a participant reads never names a cause', () => {
  const leaky = { ...manifest, tasks: [{ ...task, symptom: `It ${manifest.causeTags[0]} constantly.` }, ...manifest.tasks.slice(1)] };
  assert.throws(() => checkManifest(leaky), refuses(/names the cause/));
});

test('a task cannot set its own timeout', () => {
  const loose = { ...manifest, tasks: [{ ...task, timeoutSeconds: 60 }, ...manifest.tasks.slice(1)] };
  assert.throws(() => checkManifest(loose), refuses(/sets its own timeout/));
});

test('six tasks that all fail the same way are not a benchmark', () => {
  const flat = { ...manifest, tasks: manifest.tasks.map(item => ({ ...item, design: 'one stable canvas' })) };
  assert.throws(() => checkManifest(flat), refuses(/distinct canvas designs/));
});

// ------------------------------------------------------------ the answer key

test('every task has an answer authored from the fixture source', () => {
  assert.equal(checkAnswerKey(manifest, answers), answers);
  assert.equal(answers.derivedFrom, 'fixture-source');
  for (const item of manifest.tasks) {
    assert.ok(answers.keys[item.id].seededIn.includes(item.page), `${item.id} does not say where its defect was seeded`);
  }
});

test('an answer key taken from canvas-scan output is refused', () => {
  const borrowed = { ...answers, keys: { ...answers.keys, [task.id]: { ...key, findings: [{ type: 'repeated-draw-work' }] } } };
  assert.throws(() => checkAnswerKey(manifest, borrowed), refuses(/taken from canvas-scan output/));
});

test('an answer key not derived from the fixture source is refused', () => {
  assert.throws(() => checkAnswerKey(manifest, { ...answers, derivedFrom: 'canvas-scan-session' }), refuses(/derived from fixture-source/));
});

test('a cause outside the closed list is refused', () => {
  const invented = { ...answers, keys: { ...answers.keys, [task.id]: { ...key, cause: 'it is just slow' } } };
  assert.throws(() => checkAnswerKey(manifest, invented), refuses(/not in the closed list/));
});

// ------------------------------------------------------------ scoring one run

test('a run naming the seeded canvas and cause is correct', () => {
  assert.equal(scoreRun(task, key, run()).status, 'correct');
});

test('an accepted alias for the canvas still counts', () => {
  const cache = manifest.tasks.find(item => item.id === 'hidden-cache-canvas');
  const cacheKey = answers.keys[cache.id];
  for (const alias of cacheKey.canvasAliases) {
    const outcome = scoreRun(cache, cacheKey, run({ answer: { canvas: alias.toUpperCase(), cause: cacheKey.cause } }));
    assert.equal(outcome.status, 'correct', `${alias} was not accepted`);
  }
});

test('the right cause on the wrong canvas is incorrect, and says which half failed', () => {
  const outcome = scoreRun(task, key, run({ answer: { canvas: 'some other canvas', cause: key.cause } }));
  assert.equal(outcome.status, 'incorrect');
  assert.match(outcome.reason, /wrong canvas/);
});

test('a timeout is a timeout, never a wrong answer', () => {
  const outcome = scoreRun(task, key, run({ timedOut: true, answer: null }));
  assert.equal(outcome.status, 'timeout');
  assert.notEqual(outcome.status, 'incorrect');
});

test('an unsound run is invalid whatever it answered', () => {
  const outcome = scoreRun(task, key, run({ invalidReason: 'the participant had seen this fixture before' }));
  assert.equal(outcome.status, 'invalid');
  assert.match(outcome.reason, /seen this fixture/);
});

test('an answer submitted after the timeout is invalid, not fast', () => {
  const outcome = scoreRun(task, key, run({ elapsedSeconds: task.timeoutSeconds + 1 }));
  assert.equal(outcome.status, 'invalid');
});

test('an incomplete answer form is invalid, not wrong', () => {
  assert.equal(scoreRun(task, key, run({ answer: { canvas: key.canvas } })).status, 'invalid');
});

test('the answer form takes an answer, not a canvas-scan artifact', () => {
  assert.throws(() => scoreRun(task, key, run({ answer: { canvas: key.canvas, cause: key.cause, sessionId: 's-1' } })), refuses(/not an artifact/));
});

test('every outcome carries a status from the closed list', () => {
  const cases = [run(), run({ timedOut: true }), run({ invalidReason: 'x' }), run({ answer: { canvas: 'no', cause: key.cause } })];
  for (const item of cases) assert.ok(RUN_STATUSES.includes(scoreRun(task, key, item).status));
});

// ------------------------------------------------------------ the summary

const fill = (arm, { correct, incorrect, timeouts, invalid, seconds }) => {
  const outcomes = [];
  for (let index = 0; index < correct; index++) outcomes.push(scoreRun(task, key, run({ arm, participantId: `p${index}`, elapsedSeconds: seconds })));
  for (let index = 0; index < incorrect; index++) outcomes.push(scoreRun(task, key, run({ arm, participantId: `p${index}`, answer: { canvas: 'wrong', cause: key.cause } })));
  for (let index = 0; index < timeouts; index++) outcomes.push(scoreRun(task, key, run({ arm, participantId: `p${index}`, timedOut: true })));
  for (let index = 0; index < invalid; index++) outcomes.push(scoreRun(task, key, run({ arm, participantId: `p${index}`, invalidReason: 'fixture did not load' })));
  return outcomes;
};

test('the correctness rate leaves invalid runs out of both halves of the fraction', () => {
  const summary = summarize([
    ...fill('canvas-scan', { correct: 3, incorrect: 1, timeouts: 0, invalid: 10, seconds: 100 }),
    ...fill('control', { correct: 0, incorrect: 0, timeouts: 0, invalid: 0, seconds: 0 }),
  ]);
  assert.equal(summary.arms['canvas-scan'].graded, 4);
  assert.equal(summary.arms['canvas-scan'].invalid, 10);
  assert.equal(summary.arms['canvas-scan'].correctnessRate, 0.75);
});

test('a timeout lowers the correctness rate without becoming a wrong answer', () => {
  const summary = summarize(fill('canvas-scan', { correct: 3, incorrect: 0, timeouts: 1, invalid: 0, seconds: 100 }));
  assert.equal(summary.arms['canvas-scan'].correctnessRate, 0.75);
  assert.equal(summary.arms['canvas-scan'].incorrect, 0);
  assert.equal(summary.arms['canvas-scan'].timeouts, 1);
});

test('the median time counts correct answers only', () => {
  // The wrong answers and timeouts here are slower than every correct one. If
  // any of them reached the median it would move.
  const outcomes = [
    ...fill('canvas-scan', { correct: 3, incorrect: 2, timeouts: 2, invalid: 0, seconds: 100 }),
    ...fill('control', { correct: 0, incorrect: 0, timeouts: 0, invalid: 0, seconds: 0 }),
  ];
  assert.equal(summarize(outcomes).arms['canvas-scan'].medianSecondsToCorrect, 100);
});

// ------------------------------------------------------------ the threshold

const armed = ({ scanCorrect, scanSeconds, controlCorrect, controlSeconds }) => summarize([
  ...fill('canvas-scan', { correct: scanCorrect, incorrect: PROTOCOL.runsPerArm - scanCorrect, timeouts: 0, invalid: 0, seconds: scanSeconds }),
  ...fill('control', { correct: controlCorrect, incorrect: PROTOCOL.runsPerArm - controlCorrect, timeouts: 0, invalid: 0, seconds: controlSeconds }),
]);

test('a faster arm with equal correctness meets the frozen threshold', () => {
  const verdict = judge(armed({ scanCorrect: 30, scanSeconds: 200, controlCorrect: 30, controlSeconds: 600 }));
  assert.deepEqual(verdict, { meetsThreshold: true, reasons: [] });
});

test('speed bought with wrong answers fails', () => {
  const verdict = judge(armed({ scanCorrect: 20, scanSeconds: 60, controlCorrect: 30, controlSeconds: 600 }));
  assert.equal(verdict.meetsThreshold, false);
  assert.match(verdict.reasons.join(' '), /correctness fell/);
});

test('a median time above half the control fails', () => {
  const verdict = judge(armed({ scanCorrect: 30, scanSeconds: 400, controlCorrect: 30, controlSeconds: 600 }));
  assert.equal(verdict.meetsThreshold, false);
  assert.match(verdict.reasons.join(' '), /above the 300s the threshold allows/);
});

test('too few graded runs is not a result', () => {
  const verdict = judge(summarize([
    ...fill('canvas-scan', { correct: 2, incorrect: 0, timeouts: 0, invalid: 0, seconds: 100 }),
    ...fill('control', { correct: 2, incorrect: 0, timeouts: 0, invalid: 0, seconds: 600 }),
  ]));
  assert.equal(verdict.meetsThreshold, false);
  assert.match(verdict.reasons.join(' '), /needs 36 graded runs per arm/);
});

test('the frozen protocol holds the approved values', () => {
  assert.equal(PROTOCOL.participants, 6);
  assert.equal(PROTOCOL.runsPerArm, 36);
  assert.equal(PROTOCOL.taskTimeoutSeconds, 900);
  assert.equal(PROTOCOL.sessionMinutes, 120);
  assert.equal(PROTOCOL.threshold.medianTimeAtMostShareOfControl, 0.5);
});

// ------------------------------------------------------------ the claim

test('the approved sentence carries both arms and their numbers', () => {
  const sentence = claimSentence(armed({ scanCorrect: 30, scanSeconds: 240, controlCorrect: 30, controlSeconds: 600 }));
  assert.match(sentence, /6 developers/);
  assert.match(sentence, /83%/);
  assert.match(sentence, /4 minutes with canvas-scan/);
  assert.match(sentence, /10 minutes with the Chrome DevTools Performance panel alone/);
});

test('a result below the threshold supports no public claim', () => {
  assert.throws(() => claimSentence(armed({ scanCorrect: 30, scanSeconds: 500, controlCorrect: 30, controlSeconds: 600 })), refuses(/supports no public claim/));
});

test('no green gate can stand in for the benchmark', () => {
  for (const source of FORBIDDEN_CLAIM_SOURCES) {
    assert.throws(() => refuseClaimFrom(source), refuses(/cannot prove the product outcome/), `${source} was allowed to claim success`);
  }
  assert.equal(refuseClaimFrom('north-star-benchmark'), true);
});
