import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROBES,
  REQUIRED_COMMANDS,
  candidateManifest,
  checkAbsoluteBenchmarks,
  checkCandidate,
  checkLab,
  checkManualRelease,
  checkMutation,
  checkEnvironmentRetryCandidate,
  checkEnvironmentRetryPrior,
  checkJudgeCorrectionCandidate,
  checkJudgeCorrectionPrior,
  checkJudgeCorrectionVerificationCandidate,
  checkJudgeCorrectionVerificationPrior,
  checkNewCandidateCycleCandidate,
  checkNewCandidateCyclePrior,
  checkPairedBenchmark,
  checkFailedPairedAttempt,
  checkPairedReplacementCandidate,
  checkProbes,
  checkPublicDocuments,
  checkResumeCandidate,
  classifyCommand,
  commandText,
  evaluateRelease,
  isAllowedEvidencePath,
  sha256,
} from './release-v04.mjs';

const candidate = {
  version: '0.4.0',
  baseGitSha: 'a'.repeat(40),
  iifeSha256: 'b'.repeat(64),
  esmSha256: 'c'.repeat(64),
  tarballSha256: 'd'.repeat(64),
  publicReadmeSha256: { root: 'e'.repeat(64), package: 'f'.repeat(64) },
  releaseHarnessSha256: '1'.repeat(64),
  benchmarkHarnessSha256: '2'.repeat(64),
  pairedBenchmarkHarnessSha256: '3'.repeat(64),
  candidateManifestSha256: '4'.repeat(64),
};
const lab = {
  pass: true,
  runId: 'lab-run',
  endedAt: '2026-08-05T12:00:00.000Z',
  gitSha: candidate.baseGitSha,
  diagnostics: {},
  scenarios: Array.from({ length: 53 }, () => ({ pass: true })),
  product: { version: '0.4.0', bundleSha256: candidate.iifeSha256 },
};
const mutation = { mutationRunId: 'mutation-run', parentRunId: lab.runId, startedAt: lab.endedAt, endedAt: lab.endedAt, missing: 'heavy-canvas-work' };
const mutationResult = { status: 'PASS' };
const probes = Object.fromEntries(PROBES.map((name) => [name, { status: 'PASS', gitSha: candidate.baseGitSha, bundleHash: candidate.iifeSha256 }]));
const pack = { finalStatus: 'PASS', packageVersion: '0.4.0', packageManifestVersion: '0.4.0', baseGitSha: candidate.baseGitSha, iifeSha256: candidate.iifeSha256, esmSha256: candidate.esmSha256, tarballSha256: candidate.tarballSha256, manualReleaseTestSha256: 'a'.repeat(64), publicContract: 'PASS', labBoundary: 'PASS', fixtureResults: [] };
const manual = {
  status: 'PASS',
  startedFromExactTarball: true,
  gitSha: candidate.baseGitSha,
  expectedGitSha: candidate.baseGitSha,
  packageVersion: '0.4.0',
  tarballSha256: candidate.tarballSha256,
  iifeSha256: candidate.iifeSha256,
  browserVersion: 'Chrome 150',
  checks: { continuousRecording: true, burstRecording: true, usefulFindingCopy: true, plainJsonExport: true, privacyBoundary: true },
  sessions: {
    continuous: { stopReason: 'manual', windows: [{}], findings: [{ type: 'repeated-draw-work' }] },
    burst: { stopReason: 'manual', windows: [{}], findings: [{ type: 'heavy-canvas-work' }] },
  },
  failures: [],
};
const commands = REQUIRED_COMMANDS.map((command) => ({ command: commandText(command), status: 'PASS' }));
const absolute = ['mixed', 'tracked-source'].map((stream) => ({
  schemaVersion: 1,
  stream,
  git: { sha: candidate.baseGitSha, dirty: true },
  bundleSha256: candidate.iifeSha256,
  harnessSha256: candidate.benchmarkHarnessSha256,
  browserVersion: 'Chrome 150',
  hardware: { cpu: 'test cpu', cores: 8 },
  thresholds: { fullAddedMeanMs: 2, fullAddedP95Ms: 3, countOnlyAddedMeanMs: 0.75, countOnlyAddedP95Ms: 2 },
  raw: Array(5),
  perBlock: Array(5),
  gates: { fullAddedMeanMs: 1.9, fullAddedP95Ms: 2.9, countOnlyAddedMeanMs: 0.74, countOnlyAddedP95Ms: 1.9, pass: true },
  failures: [],
}));
const pairedStream = () => ({
  pairs: Array(6),
  status: 'COMPLETE',
  verdict: { pass: true },
  pairedGateValues: { fullAddedMeanMs: 0.25, fullAddedP95Ms: 0.5 },
  absoluteGates: { candidate: { passes: { countOnlyAddedMeanMs: true, countOnlyAddedP95Ms: true } } },
});
const paired = {
  baselineCommit: '4d6d700c2982be7e06eb827f5bb9996a98995f6e',
  activeHead: candidate.baseGitSha,
  status: 'COMPLETE',
  verdict: { pass: true },
  errors: [],
  hashes: { candidateBundleSha256: candidate.iifeSha256, harnessSha256: candidate.pairedBenchmarkHarnessSha256 },
  inputs: { candidateExpectedBundleSha256: candidate.iifeSha256 },
  thresholds: { absolute: { fullAddedMeanMs: 2, fullAddedP95Ms: 3, countOnlyAddedMeanMs: 0.75, countOnlyAddedP95Ms: 2 }, pairedFullCapture: { fullAddedMeanMs: 0.25, fullAddedP95Ms: 0.5 } },
  streams: { mixed: pairedStream(), 'tracked-source': pairedStream() },
};
const failedAbsolute = structuredClone(absolute);
failedAbsolute[0].gates.pass = false;
failedAbsolute[0].failures = ['fullAddedP95Ms 3.100ms >= 3ms'];
failedAbsolute[0].gates.fullAddedP95Ms = 3.1;
const labCheckConsole = 'CANVAS_LAB_V04_NEAREST_NEGATIVES: PASS\nCANVAS_LAB_V04_VARIANTS: PASS\nCANVAS_LAB_V04_MANIFEST: PASS';
const baseInput = { candidate, expectedCandidate: candidate, commands, lab, labConsole: 'CANVAS_LAB_V04: PASS', labCheckConsole, mutation, mutationResult, probes, pack, manual, documents: { pass: true }, benchmarks: absolute, judgeState: 'PASS' };

test('the release contract has the exact commands and all nine probes', () => {
  assert.deepEqual(REQUIRED_COMMANDS.map(commandText), [
    'pnpm -r run typecheck',
    'pnpm --filter canvas-scan run test',
    'pnpm --filter canvas-scan run build',
    'pnpm --filter demo run build',
    'pnpm --filter dogfood run lab:v0.4',
    'pnpm --filter dogfood run bench:chrome',
    'node scripts/verify-pack.mjs',
    'git diff --check',
    'pnpm --filter dogfood run probe:v0.4',
  ]);
  assert.deepEqual(PROBES, ['probe:reset', 'probe:recording', 'probe:burst-heavy', 'probe:continuous-repeated', 'probe:resize-churn', 'probe:backing-store', 'probe:lifecycle', 'probe:associations', 'probe:findings']);
});

test('candidate identity fails closed for every bound hash', () => {
  assert.deepEqual(checkCandidate(candidate, candidate), []);
  for (const key of ['version', 'baseGitSha', 'iifeSha256', 'esmSha256', 'tarballSha256', 'releaseHarnessSha256', 'benchmarkHarnessSha256', 'pairedBenchmarkHarnessSha256', 'candidateManifestSha256']) {
    assert.notDeepEqual(checkCandidate({ ...candidate, [key]: 'wrong' }, candidate), []);
  }
  assert.notDeepEqual(checkCandidate({ ...candidate, publicReadmeSha256: {} }, candidate), []);
});

test('lab, mutation, and probe evidence fail closed', () => {
  assert.deepEqual(checkLab(lab, candidate, 'CANVAS_LAB_V04: PASS'), []);
  const failedRows = structuredClone(lab); failedRows.scenarios[0].pass = false;
  assert.match(checkLab(failedRows, candidate, 'CANVAS_LAB_V04: PASS').join(' '), /53 passing/);
  assert.match(checkLab(lab, candidate, '').join(' '), /PASS line/);
  assert.deepEqual(checkMutation(mutation, lab, mutationResult), []);
  assert.notDeepEqual(checkMutation({ ...mutation, parentRunId: 'other' }, lab, mutationResult), []);
  assert.deepEqual(checkProbes(probes, candidate), []);
  assert.match(checkProbes({ ...probes, 'probe:reset': { status: 'FAIL' } }, candidate).join(' '), /probe:reset/);
  assert.match(checkProbes({ ...probes, 'probe:reset': { ...probes['probe:reset'], bundleHash: 'wrong' } }, candidate).join(' '), /bundle hash/);
});

test('manual release evidence binds both workflows to the exact candidate', () => {
  assert.deepEqual(checkManualRelease(manual, candidate), []);
  assert.notDeepEqual(checkManualRelease({ ...manual, tarballSha256: 'wrong' }, candidate), []);
  assert.notDeepEqual(checkManualRelease({ ...manual, checks: { ...manual.checks, privacyBoundary: false } }, candidate), []);
  const noBurst = structuredClone(manual); noBurst.sessions.burst.findings = [];
  assert.notDeepEqual(checkManualRelease(noBurst, candidate), []);
});

test('absolute thresholds are strict and require both complete streams', () => {
  assert.deepEqual(checkAbsoluteBenchmarks(absolute, candidate), []);
  assert.notDeepEqual(checkAbsoluteBenchmarks([absolute[0]], candidate), []);
  const boundary = structuredClone(absolute); boundary[0].gates.fullAddedMeanMs = 2;
  assert.match(checkAbsoluteBenchmarks(boundary, candidate).join(' '), /strict limit/);
  const staleBundle = structuredClone(absolute); staleBundle[0].bundleSha256 = 'wrong';
  assert.match(checkAbsoluteBenchmarks(staleBundle, candidate).join(' '), /bundle hash/);
});

test('paired fallback requires one failed absolute attempt and exact approved limits', () => {
  const attempts = [{ status: 'FAIL', artifacts: failedAbsolute }];
  assert.deepEqual(checkPairedBenchmark(paired, 'stable host did not reproduce', attempts, candidate), []);
  assert.notDeepEqual(checkPairedBenchmark(paired, '', attempts, candidate), []);
  assert.notDeepEqual(checkPairedBenchmark({ ...paired, baselineCommit: 'bad' }, 'reason', attempts, candidate), []);
  assert.notDeepEqual(checkPairedBenchmark(paired, 'reason', [], candidate), []);
  const incomplete = structuredClone(paired); incomplete.streams.mixed.pairs = Array(5);
  assert.notDeepEqual(checkPairedBenchmark(incomplete, 'reason', attempts, candidate), []);
  const above = structuredClone(paired); above.streams.mixed.pairedGateValues.fullAddedP95Ms = 0.501;
  assert.notDeepEqual(checkPairedBenchmark(above, 'reason', attempts, candidate), []);
});

test('product failures and environment limits remain separate', () => {
  assert.equal(evaluateRelease(baseInput).pass, true);
  assert.match(evaluateRelease({ ...baseInput, pack: { ...pack, finalStatus: 'FAIL' } }).productFailures.join(' '), /package contract/);
  assert.match(evaluateRelease({ ...baseInput, documents: { pass: false, missing: ['workflow'] } }).productFailures.join(' '), /document contract/);
  for (const error of ['Chrome unavailable', 'EADDRINUSE: port unavailable', 'listen EPERM: operation not permitted 127.0.0.1:5190', 'npm cache EPERM']) {
    assert.equal(classifyCommand({ exitCode: 1, stdout: '', stderr: error }), 'ENVIRONMENT_LIMIT');
  }
  assert.equal(classifyCommand({ exitCode: 1, stdout: '', stderr: 'timing threshold failed' }), 'FAIL');
  assert.equal(classifyCommand({ exitCode: 1, stdout: 'Network: use --host to expose\ntiming threshold failed', stderr: '' }), 'FAIL');
});

test('the document check normalizes case and whitespace', () => {
  const readme = 'canvas-scan@0.4.0 release candidate not published on npm npm install -D canvas-scan npx canvas-scan init --write import \'canvas-scan/auto\' main-thread\nCanvas2D React owner data is optional attribution startRecording stopRecording getLastSession mark InvestigationSessionV1 schemaVersion dropped-entry counts heavy-canvas-work repeated-draw-work resize-churn backing-store-mismatch measured associated candidate claimBoundary nextCheck Worker and transferred canvases wasted work pixel identity does not prove causality <2ms <3ms <0.75ms';
  assert.equal(checkPublicDocuments(readme, `<!-- This README is packed with the canvas-scan package. -->\n\n${readme}`).pass, true);
});

test('absolute resume protects product and benchmark identity', () => {
  assert.deepEqual(checkResumeCandidate(candidate, candidate), []);
  assert.deepEqual(checkResumeCandidate({ ...candidate, releaseHarnessSha256: 'changed', candidateManifestSha256: 'changed' }, candidate), []);
  for (const key of ['version', 'baseGitSha', 'iifeSha256', 'esmSha256', 'tarballSha256', 'benchmarkHarnessSha256', 'pairedBenchmarkHarnessSha256']) {
    assert.notDeepEqual(checkResumeCandidate({ ...candidate, [key]: 'wrong' }, candidate), []);
  }
  assert.notDeepEqual(checkResumeCandidate({ ...candidate, publicReadmeSha256: {} }, candidate), []);
});

test('a replacement paired attempt protects product identity and records the failed harness', () => {
  const changed = { ...candidate, pairedBenchmarkHarnessSha256: '5'.repeat(64), releaseHarnessSha256: '6'.repeat(64), candidateManifestSha256: '7'.repeat(64) };
  assert.deepEqual(checkPairedReplacementCandidate(changed, candidate), []);
  assert.notDeepEqual(checkPairedReplacementCandidate({ ...changed, iifeSha256: 'wrong' }, candidate), []);
  const failed = { status: 'ERROR', verdict: { pass: false }, errors: ['timeout'], baselineCommit: '4d6d700c2982be7e06eb827f5bb9996a98995f6e', activeHead: candidate.baseGitSha, hashes: { candidateBundleSha256: candidate.iifeSha256, harnessSha256: candidate.pairedBenchmarkHarnessSha256 }, inputs: { candidateExpectedBundleSha256: candidate.iifeSha256 }, streams: { mixed: { pairs: [{}, {}] }, 'tracked-source': { pairs: [] } }, cleanup: { browserClose: { ok: true }, serverStop: { ok: true } } };
  assert.deepEqual(checkFailedPairedAttempt(failed, candidate), []);
  assert.notDeepEqual(checkFailedPairedAttempt({ ...failed, status: 'COMPLETE' }, candidate), []);
});

test('a new candidate cycle requires a failed paired gate and a changed product bundle', () => {
  const prior = {
    benchmarkPolicy: 'paired-v0.3.1',
    mechanicalStatus: 'FAIL',
    finalStatus: 'FAIL',
    judgeState: 'PENDING',
    candidate,
    benchmarkResults: [{ status: 'COMPLETE', verdict: { pass: false } }],
  };
  assert.deepEqual(checkNewCandidateCyclePrior(prior), []);
  assert.notDeepEqual(checkNewCandidateCyclePrior({ ...prior, mechanicalStatus: 'PASS' }), []);
  assert.notDeepEqual(checkNewCandidateCyclePrior({ ...prior, benchmarkPolicy: 'absolute' }), []);
  assert.notDeepEqual(checkNewCandidateCyclePrior({ ...prior, benchmarkResults: [{ status: 'COMPLETE', verdict: { pass: true } }] }), []);

  const changed = {
    ...candidate,
    iifeSha256: '5'.repeat(64),
    esmSha256: '6'.repeat(64),
    tarballSha256: '9'.repeat(64),
    releaseHarnessSha256: '7'.repeat(64),
    candidateManifestSha256: '8'.repeat(64),
  };
  assert.deepEqual(checkNewCandidateCycleCandidate(changed, candidate), []);
  assert.notDeepEqual(checkNewCandidateCycleCandidate({ ...changed, iifeSha256: candidate.iifeSha256 }, candidate), []);
  assert.notDeepEqual(checkNewCandidateCycleCandidate({ ...changed, benchmarkHarnessSha256: 'wrong' }, candidate), []);
});

test('an environment retry requires zero benchmark samples and fixed product identity', () => {
  const prior = {
    benchmarkPolicy: 'absolute',
    mechanicalStatus: 'FAIL',
    finalStatus: 'FAIL',
    judgeState: 'PENDING',
    candidate,
    commandResults: [{ exitCode: 1, stdout: '', stderr: 'listen EPERM: operation not permitted 127.0.0.1:5190' }],
    benchmarkResults: ['mixed', 'tracked-source'].map((stream) => ({ stream, bundleSha256: null, raw: [], perBlock: [], gates: { pass: false } })),
  };
  assert.deepEqual(checkEnvironmentRetryPrior(prior), []);
  const sampled = structuredClone(prior); sampled.benchmarkResults[0].raw.push({});
  assert.notDeepEqual(checkEnvironmentRetryPrior(sampled), []);
  assert.notDeepEqual(checkEnvironmentRetryPrior({ ...prior, commandResults: [{ exitCode: 1, stdout: '', stderr: 'timing threshold failed' }] }), []);

  const harnessOnly = { ...candidate, releaseHarnessSha256: '5'.repeat(64), candidateManifestSha256: '6'.repeat(64) };
  assert.deepEqual(checkEnvironmentRetryCandidate(harnessOnly, candidate), []);
  assert.notDeepEqual(checkEnvironmentRetryCandidate({ ...harnessOnly, iifeSha256: 'wrong' }, candidate), []);
});

test('a judge correction preserves the measured product and requires a failed judge', () => {
  const prior = { benchmarkPolicy: 'absolute', mechanicalStatus: 'PASS', finalStatus: 'FAIL', judgeState: 'PENDING', candidate };
  assert.deepEqual(checkJudgeCorrectionPrior(prior, 'VERDICT: FAIL\nFINDINGS:\n- gap'), []);
  assert.notDeepEqual(checkJudgeCorrectionPrior({ ...prior, mechanicalStatus: 'FAIL' }, 'VERDICT: FAIL'), []);
  assert.notDeepEqual(checkJudgeCorrectionPrior(prior, 'VERDICT: PASS'), []);
  const changedHarness = { ...candidate, tarballSha256: '5'.repeat(64), publicReadmeSha256: { root: '6'.repeat(64), package: '7'.repeat(64) }, releaseHarnessSha256: '8'.repeat(64), pairedBenchmarkHarnessSha256: '9'.repeat(64), candidateManifestSha256: '0'.repeat(64) };
  assert.deepEqual(checkJudgeCorrectionCandidate(changedHarness, candidate), []);
  assert.notDeepEqual(checkJudgeCorrectionCandidate({ ...changedHarness, iifeSha256: 'wrong' }, candidate), []);
  assert.notDeepEqual(checkJudgeCorrectionCandidate({ ...changedHarness, benchmarkHarnessSha256: 'wrong' }, candidate), []);
});

test('a judge correction verification retry is limited to the README claim test failure', () => {
  const failedTest = {
    command: 'pnpm --filter canvas-scan run test',
    status: 'FAIL',
    exitCode: 1,
    stdout: 'FAIL test/claim-discipline.test.ts',
    stderr: 'keeps forbidden claims out of both READMEs',
  };
  const prior = {
    benchmarkPolicy: 'absolute',
    mechanicalStatus: 'FAIL',
    finalStatus: 'FAIL',
    judgeState: 'PENDING',
    candidate,
    commandResults: [failedTest],
    productFailures: ['pnpm --filter canvas-scan run test: failed'],
    environmentLimits: [],
    judgeCorrections: [{}],
    judgeCorrectionVerificationRetries: [],
  };
  assert.deepEqual(checkJudgeCorrectionVerificationPrior(prior), []);
  assert.notDeepEqual(checkJudgeCorrectionVerificationPrior({ ...prior, productFailures: [...prior.productFailures, 'another failure'] }), []);
  assert.notDeepEqual(checkJudgeCorrectionVerificationPrior({ ...prior, commandResults: [{ ...failedTest, stderr: 'another test failed' }] }), []);
  assert.notDeepEqual(checkJudgeCorrectionVerificationPrior({ ...prior, judgeCorrectionVerificationRetries: [{}] }), []);

  const changedDocuments = {
    ...candidate,
    tarballSha256: '5'.repeat(64),
    publicReadmeSha256: { root: '6'.repeat(64), package: '7'.repeat(64) },
    releaseHarnessSha256: '8'.repeat(64),
    candidateManifestSha256: '9'.repeat(64),
  };
  assert.deepEqual(checkJudgeCorrectionVerificationCandidate(changedDocuments, candidate), []);
  assert.notDeepEqual(checkJudgeCorrectionVerificationCandidate({ ...changedDocuments, iifeSha256: 'wrong' }, candidate), []);
  assert.notDeepEqual(checkJudgeCorrectionVerificationCandidate({ ...changedDocuments, pairedBenchmarkHarnessSha256: 'wrong' }, candidate), []);
});

test('only judge PASS can complete a mechanically passing gate', () => {
  assert.equal(evaluateRelease({ ...baseInput, judgeState: 'PENDING' }).pass, false);
  assert.equal(evaluateRelease({ ...baseInput, judgeState: 'FAIL' }).pass, false);
  assert.equal(evaluateRelease({ ...baseInput, judgeState: 'PASS' }).pass, true);
});

test('evidence paths, freshness, and deterministic manifests are strict', () => {
  assert.equal(isAllowedEvidencePath('/private/tmp/sidproj-56-pack-summary.json'), true);
  assert.equal(isAllowedEvidencePath('/tmp/sidproj-56-pack-summary.json'), false);
  assert.equal(isAllowedEvidencePath('/private/tmp/../tmp/sidproj-56-pack-summary.json'), false);
  const stale = evaluateRelease({ ...baseInput, evidence: [{ path: '/private/tmp/sidproj-56-pack-summary.json', stale: true }] });
  assert.match(stale.productFailures.join(' '), /invalid evidence/);
  assert.equal(candidateManifest(['packages/core/package.json']).length, 64);
  assert.equal(sha256('canvas-scan').length, 64);
});
