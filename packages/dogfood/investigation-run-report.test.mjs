import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkDirectory } from './readiness-v05.mjs';
import { RUN_REPORT_CONTRACT, RUN_REPORT_WRITE_ERROR, RUN_STAGE_IDS, checkInvestigationRunReport, checkInvestigationSnapshot, checkTerminalRunOutput, createRunState, finalizeInvestigationRun, finalizeRunReport, investigationArtifactBytes, investigationManifestBytes, preflightInvestigationRunReport, reduceRunState, terminalRunOutput, writeInvestigationRunReport } from './investigation-run-report.mjs';

const candidate = { gitSha: 'a'.repeat(40), branch: 'agent/sidproj-106-run-report', packageVersion: '0.5.0' };
const copy = value => structuredClone(value);
const session = finding => ({ browserFeatures: { monotonicTime: true, eventTiming: true, longAnimationFrames: true }, collectionLimits: copy(RUN_REPORT_CONTRACT.fixed.sessionLimits), droppedEntryCounts: copy(RUN_REPORT_CONTRACT.fixed.sessionDropped), findings: finding ? [{ type: 'repeated-draw-work', evidenceLevel: 'candidate' }] : [], windows: [], browserEntries: [] });
const raw = ({ findings = true, unknown = false } = {}) => ({ browserVersion: '151.0.0.0', artifacts: { baselineSession: session(findings), candidateSession: session(findings), copiedExplanation: { collectionLimits: copy(RUN_REPORT_CONTRACT.fixed.explanationLimits), droppedEntryCounts: copy(RUN_REPORT_CONTRACT.fixed.explanationDropped), windows: unknown ? [{ commands: [{ unknownReason: 'unsupported-value' }] }] : [], stacks: [] }, copiedComparison: { incomparableReasons: [] } } });
const support = evidence => [{ id: 'canvas-2d', status: 'supported', reason: null }, { id: 'monotonic-time', status: 'supported', reason: null }, ...[['event-timing', 'eventTiming'], ['long-animation-frames', 'longAnimationFrames']].map(([id, key]) => { const supported = evidence.artifacts.baselineSession.browserFeatures[key] && evidence.artifacts.candidateSession.browserFeatures[key]; return { id, status: supported ? 'supported' : 'unavailable', reason: supported ? null : 'browser-feature-unavailable' }; })];
const ready = (evidence = raw()) => { const state = createRunState(); reduceRunState(state, { type: 'browser-support', rows: support(evidence) }); for (const id of RUN_STAGE_IDS.slice(0, -1)) reduceRunState(state, { type: 'stage-complete', id }); return state; };
const completed = (evidence = raw()) => { const state = ready(evidence); reduceRunState(state, { type: 'verification-result', status: 'complete', reason: null }); return state; };
const report = (state = completed(), evidence = raw()) => finalizeRunReport(state, { candidate, rawEvidence: evidence, files: investigationArtifactBytes(evidence), manifestBytes: Buffer.from('planned') });
const failed = (id, reason, type = 'stage-failed') => { const state = createRunState(); if (RUN_REPORT_CONTRACT.stageDependencies[id].includes('early-load')) reduceRunState(state, { type: 'browser-support', rows: support(raw()) }); for (const dependency of RUN_REPORT_CONTRACT.stageDependencies[id]) reduceRunState(state, { type: 'stage-complete', id: dependency }); if (id === 'verify-run') reduceRunState(state, { type: 'verification-result', status: 'failed', reason }); else reduceRunState(state, { type, id, reason }); return state; };
async function temporaryRun(callback) { const root = await mkdtemp(path.join(os.tmpdir(), 'sidproj-106-report-test-')); const directory = path.join(root, 'evidence'); try { return await callback(directory); } finally { await rm(root, { recursive: true, force: true }); } }
async function canonicalDirectory(directory, evidence = raw()) { return finalizeInvestigationRun({ directory, state: ready(), candidate, rawEvidence: evidence }); }
async function writeFixtureFile(directory, file, bytes) { const target = path.join(directory, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes); }

test('01 complete findings produce a complete findings report', () => {
  const value = report(); assert.equal(value.status, 'complete'); assert.equal(value.outcome, 'findings'); assert.equal(checkInvestigationRunReport(value, { candidate, rawEvidence: raw() }), true);
});

test('02 a complete run without findings or unknowns is clean', () => {
  const evidence = raw({ findings: false }); const value = report(completed(), evidence); assert.equal(value.outcome, 'clean'); assert.equal(checkInvestigationRunReport(value, { candidate, rawEvidence: evidence }), true);
});

test('03 a complete run with a measured unknown is unknown', () => {
  const evidence = raw({ findings: false, unknown: true }); const value = report(completed(), evidence); assert.equal(value.outcome, 'unknown'); assert.deepEqual(value.unknownReasons, [{ scope: 'explanation-command', reason: 'unsupported-value', count: 1 }]);
});

test('04 every first-nine stage accepts only its declared unavailable reasons', () => {
  for (const id of RUN_STAGE_IDS.slice(0, -1)) { for (const reason of RUN_REPORT_CONTRACT.stageReasons[id].unavailable) { const state = failed(id, reason, 'stage-unavailable'); assert.deepEqual(state.runStages.find(row => row.id === id), { id, status: 'unavailable', reason }); } assert.throws(() => reduceRunState(createRunState(), { type: 'stage-unavailable', id, reason: RUN_REPORT_CONTRACT.stageReasons[id].failed[0] ?? 'private-value' })); }
});

test('05 every first-nine stage accepts only its declared failed reasons', () => {
  for (const id of RUN_STAGE_IDS.slice(0, -1)) { for (const reason of RUN_REPORT_CONTRACT.stageReasons[id].failed) { const state = failed(id, reason); assert.deepEqual(state.runStages.find(row => row.id === id), { id, status: 'failed', reason }); } assert.throws(() => reduceRunState(createRunState(), { type: 'stage-failed', id, reason: RUN_REPORT_CONTRACT.stageReasons[id].unavailable[0] ?? 'private-value' })); }
});

test('06 browser, capture, explanation, comparison, and export failures are incomplete', () => {
  for (const [id, reason] of [['early-load', 'browser-start-failed'], ['record-baseline', 'capture-failed'], ['explain-baseline', 'explanation-failed'], ['copy-explanation', 'export-failed'], ['record-candidate', 'capture-failed'], ['pair-findings', 'comparison-failed'], ['copy-comparison', 'export-failed']]) assert.equal(report(failed(id, reason), raw({ findings: false })).status, 'incomplete');
});

test('07 a failed stage blocks every later stage', () => {
  const state = failed('record-baseline', 'capture-failed'); assert.deepEqual(state.runStages.slice(2).map(row => row.reason), Array(8).fill('blocked-by-prior-stage')); assert.throws(() => reduceRunState(state, { type: 'stage-complete', id: 'explain-baseline' }));
});

test('08 the reducer rejects out-of-order completion', () => {
  assert.throws(() => reduceRunState(createRunState(), { type: 'stage-complete', id: 'record-baseline' }));
});

test('09 the reducer rejects a second terminal transition', () => {
  const state = createRunState(); reduceRunState(state, { type: 'stage-failed', id: 'early-load', reason: 'setup-failed' }); assert.throws(() => reduceRunState(state, { type: 'stage-failed', id: 'early-load', reason: 'setup-failed' }));
});

test('10 setup failure writes an explicit incomplete report', async () => temporaryRun(async directory => {
  const evidence = { browserVersion: '', artifacts: {} }; const result = await finalizeInvestigationRun({ directory, state: failed('early-load', 'setup-failed'), candidate, rawEvidence: evidence, verificationReason: 'ritual-incomplete' }); assert.equal(result.report.status, 'incomplete'); assert.deepEqual(result.report.runStages[0], { id: 'early-load', status: 'failed', reason: 'setup-failed' }); assert.equal(await checkDirectory(directory, candidate), true);
}));

test('11 report-write failure has no success output and one exact error', async () => {
  const events = []; await assert.rejects(() => writeInvestigationRunReport({ directory: '/virtual', report: report(), makeDirectory: async () => {}, writeBytes: async () => { events.push('write'); throw new Error('private path'); }, removeFile: async () => events.push('remove') }), error => error.message === RUN_REPORT_WRITE_ERROR); assert.deepEqual(events, ['write', 'remove']); const output = terminalRunOutput('/virtual', null, true); assert.deepEqual(output, { exitCode: 1, stdout: '', stderr: `${RUN_REPORT_WRITE_ERROR}\n` }); assert.equal(checkTerminalRunOutput(output, '/virtual', null, true), true);
  await temporaryRun(async directory => { await preflightInvestigationRunReport({ directory }); await writeFile(path.join(directory, 'stale-file'), 'stale'); await assert.rejects(() => preflightInvestigationRunReport({ directory }), error => error.message === RUN_REPORT_WRITE_ERROR); });
});

test('12 missing browser produces finite unavailable support without an inferred cause', () => {
  const value = report(failed('early-load', 'browser-unavailable', 'stage-unavailable'), { artifacts: {} }); assert.deepEqual(value.browserSupport, RUN_REPORT_CONTRACT.supportIds.map(id => ({ id, status: 'unavailable', reason: 'browser-not-run' })));
});

test('13 optional browser feature unavailability produces honest unknowns', () => {
  const evidence = raw({ findings: false }); for (const key of ['baselineSession', 'candidateSession']) { evidence.artifacts[key].browserFeatures.eventTiming = false; evidence.artifacts[key].browserFeatures.longAnimationFrames = false; } const value = report(completed(evidence), evidence); assert.equal(value.outcome, 'unknown'); assert.deepEqual(value.unknownReasons, [{ scope: 'browser', reason: 'event-timing', count: 1 }, { scope: 'browser', reason: 'long-animation-frames', count: 1 }]);
});

test('14 explicit runStages are mandatory and action IDs cannot replace them', () => {
  const value = report(); value.runStages = RUN_STAGE_IDS.slice(0, -1); value.actionIds = RUN_STAGE_IDS.slice(0, -1); assert.throws(() => checkInvestigationRunReport(value, { candidate, rawEvidence: raw() }));
});

test('15 candidate-snapshot rejection applies one failed verification event before writes', async () => {
  const state = ready(); const writes = []; const result = await finalizeInvestigationRun({ directory: '/virtual', state, candidate, rawEvidence: raw(), checkSnapshot: () => { throw new Error('snapshot'); }, writeArtifact: async () => writes.push('artifact'), writeManifest: async () => writes.push('manifest'), writeReport: async value => { writes.push('report'); return value; } }); assert.deepEqual(writes, ['report']); assert.deepEqual(state.runStages.at(-1), { id: 'verify-run', status: 'failed', reason: 'candidate-snapshot-invalid' }); assert.equal(result.report.status, 'incomplete'); assert.throws(() => reduceRunState(state, { type: 'verification-result', status: 'failed', reason: 'candidate-snapshot-invalid' })); await assert.rejects(() => writeInvestigationRunReport({ directory: '/virtual', report: report(), checkSnapshot: () => { throw new Error('snapshot'); }, writeBytes: async () => writes.push('unexpected') }), error => error.message === 'snapshot');
});

test('16 raw-artifact write failure declares every absent file', async () => {
  const writes = []; const result = await finalizeInvestigationRun({ directory: '/virtual', state: ready(), candidate, rawEvidence: raw(), writeArtifact: async file => { writes.push(file); if (file === 'artifacts/baseline-session.json') throw new Error('write'); }, writeManifest: async () => writes.push('manifest'), writeReport: async value => { writes.push('run-report.json'); return value; } }); assert.deepEqual(writes, ['evidence.json', 'artifacts/baseline-session.json', 'run-report.json']); assert.deepEqual(result.report.runStages.at(-1), { id: 'verify-run', status: 'failed', reason: 'artifact-write-failed' }); assert.deepEqual(result.report.missingFiles, ['artifacts/baseline-session.json', 'artifacts/candidate-session.json', 'artifacts/comparison.json', 'artifacts/explanation.json', 'evidence-sha256.txt']);
});

test('17 manifest-write failure declares the manifest absent', async () => {
  const result = await finalizeInvestigationRun({ directory: '/virtual', state: ready(), candidate, rawEvidence: raw(), writeArtifact: async () => {}, writeManifest: async () => { throw new Error('manifest'); }, writeReport: async value => value }); assert.deepEqual(result.report.runStages.at(-1), { id: 'verify-run', status: 'failed', reason: 'manifest-write-failed' }); assert.deepEqual(result.report.missingFiles, ['evidence-sha256.txt']); assert.ok(result.report.artifacts.every(row => row.sha256 !== null));
});

test('18 report-write failure after manifest creation leaves no report and emits the exact line', async () => {
  const writes = []; await assert.rejects(() => finalizeInvestigationRun({ directory: '/virtual', state: ready(), candidate, rawEvidence: raw(), writeArtifact: async file => writes.push(file), writeManifest: async () => writes.push('evidence-sha256.txt'), writeReport: async () => { throw new Error(RUN_REPORT_WRITE_ERROR); } }), error => error.message === RUN_REPORT_WRITE_ERROR); assert.equal(writes.at(-1), 'evidence-sha256.txt'); assert.ok(!writes.includes('run-report.json')); assert.equal(checkTerminalRunOutput(terminalRunOutput('/virtual', null, true), '/virtual', null, true), true);
});

test('19 successful finalization writes the report last and applies one complete event', async () => {
  const state = ready(); const writes = []; const result = await finalizeInvestigationRun({ directory: '/virtual', state, candidate, rawEvidence: raw(), writeArtifact: async file => writes.push(file), writeManifest: async () => writes.push('evidence-sha256.txt'), writeReport: async value => { writes.push('run-report.json'); return value; } }); assert.deepEqual(writes, ['evidence.json', 'artifacts/baseline-session.json', 'artifacts/explanation.json', 'artifacts/candidate-session.json', 'artifacts/comparison.json', 'evidence-sha256.txt', 'run-report.json']); assert.deepEqual(state.runStages.at(-1), { id: 'verify-run', status: 'complete', reason: null }); assert.equal(result.report.status, 'complete'); assert.throws(() => reduceRunState(state, { type: 'verification-result', status: 'complete', reason: null }));
});

test('20 source and disk checkers accept the canonical complete fixture', async () => temporaryRun(async directory => {
  const evidence = raw(); const result = await canonicalDirectory(directory, evidence); const files = investigationArtifactBytes(evidence); const manifestBytes = investigationManifestBytes(files, Buffer.from(`${JSON.stringify(result.report, null, 2)}\n`)); assert.equal(checkInvestigationSnapshot(result.report, { candidate, rawEvidence: evidence, files, manifestBytes }), true); assert.equal(await checkDirectory(directory, candidate), true);
}));

test('21 disk checker rejects report, artifact, and manifest corruption without rewriting', async () => {
  for (const file of ['run-report.json', 'artifacts/baseline-session.json', 'evidence-sha256.txt']) await temporaryRun(async directory => { await canonicalDirectory(directory); const target = path.join(directory, file); const beforeReport = await readFile(path.join(directory, 'run-report.json')); await writeFile(target, Buffer.concat([await readFile(target), Buffer.from('corrupt')])); const corrupted = await readFile(target); await assert.rejects(() => checkDirectory(directory, candidate)); assert.deepEqual(await readFile(target), corrupted); if (file !== 'run-report.json') assert.deepEqual(await readFile(path.join(directory, 'run-report.json')), beforeReport); });
});

test('22 disk checker accepts declared incomplete sets and rejects undeclared absence, extras, and symlinks', async () => {
  await temporaryRun(async directory => { const evidence = { browserVersion: '', artifacts: {} }; await finalizeInvestigationRun({ directory, state: failed('early-load', 'setup-failed'), candidate, rawEvidence: evidence, verificationReason: 'ritual-incomplete' }); assert.equal(await checkDirectory(directory, candidate), true); });
  await temporaryRun(async directory => { await finalizeInvestigationRun({ directory, state: ready(), candidate, rawEvidence: raw(), checkSnapshot: () => { throw new Error('snapshot'); } }); assert.equal(await checkDirectory(directory, candidate), true); });
  await temporaryRun(async directory => { await finalizeInvestigationRun({ directory, state: ready(), candidate, rawEvidence: raw(), writeArtifact: async (file, bytes) => { if (file === 'artifacts/baseline-session.json') throw new Error('artifact'); await writeFixtureFile(directory, file, bytes); } }); assert.equal(await checkDirectory(directory, candidate), true); });
  await temporaryRun(async directory => { await finalizeInvestigationRun({ directory, state: ready(), candidate, rawEvidence: raw(), writeArtifact: (file, bytes) => writeFixtureFile(directory, file, bytes), writeManifest: async () => { throw new Error('manifest'); } }); assert.equal(await checkDirectory(directory, candidate), true); });
  await temporaryRun(async directory => { await canonicalDirectory(directory); await unlink(path.join(directory, 'artifacts/comparison.json')); await assert.rejects(() => checkDirectory(directory, candidate)); });
  await temporaryRun(async directory => { await canonicalDirectory(directory); await writeFile(path.join(directory, 'extra.json'), '{}\n'); await assert.rejects(() => checkDirectory(directory, candidate)); });
  await temporaryRun(async directory => { await canonicalDirectory(directory); await symlink(path.join(directory, 'evidence.json'), path.join(directory, 'extra-link')); await assert.rejects(() => checkDirectory(directory, candidate)); });
});
