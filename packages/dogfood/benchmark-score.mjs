// The north-star benchmark scorer.
//
// The north star is one sentence: canvas-scan succeeds when it reduces the
// time from "this canvas app feels slow" to a correct next check. Everything
// else this repository measures — tests, builds, overhead, corpus outcomes —
// is a gate on the way there. None of them is that sentence, and none of them
// can stand in for it. This file exists to keep that distinction enforceable
// rather than merely written down.
//
// Four outcomes, kept apart on purpose:
//
//   correct     the participant named the right canvas and the right cause
//   incorrect   they answered, and the answer was wrong
//   timeout     they ran out of time without answering
//   invalid     the run itself was not sound, so it says nothing either way
//
// Collapsing timeout into incorrect would flatter whichever arm is slower, and
// collapsing invalid into anything at all would let a broken fixture become a
// result. Both are the mistakes this file prevents.
//
// The expected answers live in benchmark/answers.json and were authored from
// the fixture source, where each defect was seeded deliberately. They are never
// read from a canvas-scan session, finding, explanation, or comparison. A
// benchmark that took its answer key from the tool's own output would be
// marking canvas-scan against itself, so that is checked here, not assumed.
export const RUN_STATUSES = Object.freeze(['correct', 'incorrect', 'timeout', 'invalid']);
export const ARMS = Object.freeze(['control', 'canvas-scan']);

// Approved by the user on 2026-08-27, against SIDPROJ-107. Changing any of
// these values unfreezes the protocol and needs the same approval again.
export const PROTOCOL = Object.freeze({
  participants: 6,
  tasksPerParticipant: 6,
  runsPerArm: 36,
  taskTimeoutSeconds: 900,
  sessionMinutes: 120,
  // Correctness must not fall, and the median time to a correct answer must at
  // least halve. Speed bought with wrong answers is not the north star.
  threshold: Object.freeze({
    correctnessAtLeastControl: true,
    medianTimeAtMostShareOfControl: 0.5,
  }),
});

// A product-success claim comes from the benchmark or from nowhere. These are
// the things that most look like proof and are not: they say the tool builds,
// that a feature exists, or that it is cheap to run. None of them says a
// developer reached a correct next check sooner.
export const FORBIDDEN_CLAIM_SOURCES = Object.freeze(['build', 'feature', 'performance', 'overhead', 'corpus', 'test-suite']);

// Fields that only ever appear in canvas-scan's own artifacts. If one of these
// reaches the answer key or a submitted answer, the benchmark has started
// grading the tool against its own output.
const CANVAS_SCAN_ARTIFACT_FIELDS = ['sessionId', 'findings', 'findingIndex', 'canvasScanVersion', 'schemaVersion', 'episodes', 'commandStatuses'];

export class BenchmarkError extends Error {}
const fail = message => { throw new BenchmarkError(message); };

const REQUIRED_TASK_KEYS = ['id', 'title', 'page', 'design', 'symptom', 'interaction', 'timeoutSeconds'];

export function checkManifest(manifest) {
  if (manifest?.schemaVersion !== 1) fail(`unsupported benchmark manifest version ${manifest?.schemaVersion}`);
  if (!Array.isArray(manifest.tasks) || manifest.tasks.length < 6) fail(`the benchmark needs at least six tasks, has ${manifest.tasks?.length ?? 0}`);
  if (!Array.isArray(manifest.causeTags) || manifest.causeTags.length < 2) fail('the manifest defines no closed list of causes');
  if (ARMS.some(arm => !manifest.arms?.includes(arm))) fail(`the manifest must name both arms, has ${JSON.stringify(manifest.arms)}`);
  const designs = new Set();
  for (const task of manifest.tasks) {
    const missing = REQUIRED_TASK_KEYS.filter(key => !(key in task));
    if (missing.length) fail(`benchmark task ${task.id ?? '(unnamed)'} is missing ${missing.join(', ')}`);
    // The symptom is what a participant is told. An answer inside it would
    // hand the task away, in both arms at once.
    for (const tag of manifest.causeTags) {
      if (task.symptom.includes(tag) || task.interaction.includes(tag)) fail(`benchmark task ${task.id} names the cause ${tag} in the text a participant reads`);
    }
    if (task.timeoutSeconds !== PROTOCOL.taskTimeoutSeconds) fail(`benchmark task ${task.id} sets its own timeout ${task.timeoutSeconds}, the protocol freezes ${PROTOCOL.taskTimeoutSeconds}`);
    designs.add(task.design);
  }
  const ids = manifest.tasks.map(task => task.id);
  if (new Set(ids).size !== ids.length) fail('two benchmark tasks share an id');
  // Six tasks that all fail the same way would test one path six times.
  if (designs.size < 4) fail(`the benchmark has ${designs.size} distinct canvas designs across ${manifest.tasks.length} tasks; it needs four`);
  return manifest;
}

export function checkAnswerKey(manifest, answers) {
  if (answers?.schemaVersion !== 1) fail(`unsupported answer key version ${answers?.schemaVersion}`);
  if (answers.derivedFrom !== 'fixture-source') fail(`the answer key must be derived from fixture-source, says ${JSON.stringify(answers.derivedFrom)}`);
  const serialized = JSON.stringify(answers);
  for (const field of CANVAS_SCAN_ARTIFACT_FIELDS) {
    // schemaVersion is the key's own, so only a nested one is the tool's.
    if (field === 'schemaVersion') continue;
    if (serialized.includes(`"${field}"`)) fail(`the answer key carries ${field}, so it was taken from canvas-scan output rather than from the fixture source`);
  }
  for (const task of manifest.tasks) {
    const key = answers.keys?.[task.id];
    if (!key) fail(`benchmark task ${task.id} has no answer`);
    if (!key.canvas) fail(`the answer for ${task.id} names no canvas`);
    if (!manifest.causeTags.includes(key.cause)) fail(`the answer for ${task.id} uses cause ${JSON.stringify(key.cause)}, which is not in the closed list`);
    if (!key.seededIn?.includes('pages/')) fail(`the answer for ${task.id} does not say where in the fixture the defect was seeded`);
  }
  const extra = Object.keys(answers.keys).filter(id => !manifest.tasks.some(task => task.id === id));
  if (extra.length) fail(`the answer key holds answers for tasks that do not exist: ${extra.join(', ')}`);
  return answers;
}

const normalize = text => String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// One submitted run becomes one outcome. The order of the checks is the whole
// design: an unsound run is never graded, and a timeout is never graded either,
// because a participant who ran out of time did not give a wrong answer.
export function scoreRun(task, key, run) {
  if (!ARMS.includes(run?.arm)) fail(`run for ${task.id} has arm ${JSON.stringify(run?.arm)}`);
  if (!run.participantId) fail(`run for ${task.id} names no participant`);
  const serialized = JSON.stringify(run.answer ?? {});
  for (const field of CANVAS_SCAN_ARTIFACT_FIELDS) {
    if (serialized.includes(`"${field}"`)) fail(`the answer submitted for ${task.id} carries ${field}; the answer form takes a canvas, a cause and a next check, not an artifact`);
  }

  if (run.invalidReason) return outcome(task, run, 'invalid', run.invalidReason);
  if (run.timedOut === true) return outcome(task, run, 'timeout', `no answer within ${task.timeoutSeconds} seconds`);
  if (!Number.isFinite(run.elapsedSeconds)) return outcome(task, run, 'invalid', 'the run recorded no elapsed time');
  // A run that reports an answer after the timeout is not a faster answer, it
  // is an untimed one.
  if (run.elapsedSeconds > task.timeoutSeconds) return outcome(task, run, 'invalid', `elapsed ${run.elapsedSeconds}s exceeds the ${task.timeoutSeconds}s timeout but was not recorded as a timeout`);
  if (!run.answer?.canvas || !run.answer?.cause) return outcome(task, run, 'invalid', 'the answer form was submitted incomplete');

  const accepted = [key.canvas, ...(key.canvasAliases ?? [])].map(normalize);
  const namedRightCanvas = accepted.includes(normalize(run.answer.canvas));
  const namedRightCause = normalize(run.answer.cause) === normalize(key.cause);
  if (namedRightCanvas && namedRightCause) return outcome(task, run, 'correct', 'named the seeded canvas and the seeded cause');
  const wrong = [!namedRightCanvas && 'canvas', !namedRightCause && 'cause'].filter(Boolean).join(' and ');
  return outcome(task, run, 'incorrect', `wrong ${wrong}`);
}

function outcome(task, run, status, reason) {
  if (!RUN_STATUSES.includes(status)) fail(`unknown run status ${JSON.stringify(status)}`);
  return {
    taskId: task.id,
    arm: run.arm,
    participantId: run.participantId,
    status,
    reason,
    // Elapsed time is carried on every outcome and used only for correct ones.
    // Keeping it visible on the others is what lets a reader see that it was
    // not quietly folded into the median.
    elapsedSeconds: Number.isFinite(run.elapsedSeconds) ? run.elapsedSeconds : null,
    nextCheck: run.answer?.nextCheck ?? null,
  };
}

const median = values => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// The correctness rate has invalid runs out of both halves of the fraction. An
// invalid run is not a failure to answer; it is a run that never happened.
export function summarize(outcomes) {
  const arms = {};
  for (const arm of ARMS) {
    const forArm = outcomes.filter(item => item.arm === arm);
    const correct = forArm.filter(item => item.status === 'correct');
    const incorrect = forArm.filter(item => item.status === 'incorrect');
    const timeouts = forArm.filter(item => item.status === 'timeout');
    const invalid = forArm.filter(item => item.status === 'invalid');
    const graded = correct.length + incorrect.length + timeouts.length;
    arms[arm] = {
      submitted: forArm.length,
      graded,
      correct: correct.length,
      incorrect: incorrect.length,
      timeouts: timeouts.length,
      invalid: invalid.length,
      correctnessRate: graded === 0 ? null : correct.length / graded,
      medianSecondsToCorrect: median(correct.map(item => item.elapsedSeconds)),
    };
  }
  return { protocol: PROTOCOL, arms };
}

// The frozen threshold, applied. It reports the reasons either way, because a
// bare pass or fail invites the reader to reconstruct the arithmetic and get
// it wrong.
export function judge(summary) {
  const control = summary.arms.control;
  const scan = summary.arms['canvas-scan'];
  const reasons = [];
  if (control.graded < PROTOCOL.runsPerArm || scan.graded < PROTOCOL.runsPerArm) {
    reasons.push(`the protocol needs ${PROTOCOL.runsPerArm} graded runs per arm, has ${control.graded} control and ${scan.graded} canvas-scan`);
  }
  if (control.correctnessRate === null || scan.correctnessRate === null) {
    reasons.push('an arm produced no graded run, so there is no rate to compare');
  } else if (scan.correctnessRate < control.correctnessRate) {
    reasons.push(`correctness fell: ${percent(scan.correctnessRate)} with canvas-scan against ${percent(control.correctnessRate)} without`);
  }
  if (scan.medianSecondsToCorrect === null || control.medianSecondsToCorrect === null) {
    reasons.push('an arm produced no correct answer, so there is no median time to compare');
  } else {
    const allowed = control.medianSecondsToCorrect * PROTOCOL.threshold.medianTimeAtMostShareOfControl;
    if (scan.medianSecondsToCorrect > allowed) {
      reasons.push(`the median time to a correct answer was ${scan.medianSecondsToCorrect}s, above the ${allowed}s the threshold allows against a control median of ${control.medianSecondsToCorrect}s`);
    }
  }
  return { meetsThreshold: reasons.length === 0, reasons };
}

const percent = rate => `${Math.round(rate * 100)}%`;
const minutes = seconds => Math.round(seconds / 6) / 10;

// The approved public wording, and the only way to produce one. It refuses to
// build a sentence from a result that did not meet the threshold, and it
// refuses to omit the numbers, because the numbers are what make the claim
// bounded rather than a slogan.
export function claimSentence(summary) {
  const verdict = judge(summary);
  if (!verdict.meetsThreshold) fail(`this result does not meet the approved threshold, so it supports no public claim: ${verdict.reasons.join('; ')}`);
  const control = summary.arms.control;
  const scan = summary.arms['canvas-scan'];
  return `In a controlled benchmark, ${PROTOCOL.participants} developers reached a correct next check on ${PROTOCOL.tasksPerParticipant} seeded canvas defects ${percent(scan.correctnessRate)} of the time in a median of ${minutes(scan.medianSecondsToCorrect)} minutes with canvas-scan, against ${percent(control.correctnessRate)} and ${minutes(control.medianSecondsToCorrect)} minutes with the Chrome DevTools Performance panel alone.`;
}

// Called by anything tempted to announce product success from a green gate.
export function refuseClaimFrom(source) {
  if (FORBIDDEN_CLAIM_SOURCES.includes(source)) {
    fail(`${source} cannot prove the product outcome; only the north-star benchmark can`);
  }
  if (source !== 'north-star-benchmark') fail(`unknown claim source ${JSON.stringify(source)}`);
  return true;
}
