import assert from 'node:assert/strict';
import { cp, lstat, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkDirectory } from './readiness-v05.mjs';
import { RUN_REPORT_CONTRACT, RUN_REPORT_WRITE_ERROR, RUN_STAGE_IDS, checkInvestigationRunReport, checkInvestigationSnapshot, checkTerminalRunOutput, createRunState, finalizeInvestigationRun, finalizeRunReport, investigationArtifactBytes, investigationManifestBytes, reduceRunState, terminalRunOutput, writeInvestigationRunReport } from './investigation-run-report.mjs';

const syntheticCandidate = { gitSha: 'a'.repeat(40), branch: 'agent/sidproj-106-run-report', packageVersion: '0.5.0' };
const copy = value => structuredClone(value);
const session = finding => ({ browserFeatures: { monotonicTime: true, eventTiming: true, longAnimationFrames: true }, collectionLimits: copy(RUN_REPORT_CONTRACT.fixed.sessionLimits), droppedEntryCounts: copy(RUN_REPORT_CONTRACT.fixed.sessionDropped), findings: finding ? [{ type: 'repeated-draw-work', evidenceLevel: 'candidate' }] : [], windows: [], browserEntries: [] });
const raw = ({ findings = true, unknown = false } = {}) => ({ browserVersion: '151.0.0.0', artifacts: { baselineSession: session(findings), candidateSession: session(findings), copiedExplanation: { collectionLimits: copy(RUN_REPORT_CONTRACT.fixed.explanationLimits), droppedEntryCounts: copy(RUN_REPORT_CONTRACT.fixed.explanationDropped), windows: unknown ? [{ commands: [{ unknownReason: 'unsupported-value' }] }] : [], stacks: [] }, copiedComparison: { incomparableReasons: [] } } });
const support = evidence => [{ id: 'canvas-2d', status: 'supported', reason: null }, { id: 'monotonic-time', status: 'supported', reason: null }, ...[['event-timing', 'eventTiming'], ['long-animation-frames', 'longAnimationFrames']].map(([id, key]) => { const supported = evidence.artifacts.baselineSession.browserFeatures[key] && evidence.artifacts.candidateSession.browserFeatures[key]; return { id, status: supported ? 'supported' : 'unavailable', reason: supported ? null : 'browser-feature-unavailable' }; })];
const ready = (evidence = raw()) => { const state = createRunState(); reduceRunState(state, { type: 'browser-support', rows: support(evidence) }); for (const id of RUN_STAGE_IDS.slice(0, -1)) reduceRunState(state, { type: 'stage-complete', id }); return state; };
const completed = (evidence = raw()) => { const state = ready(evidence); reduceRunState(state, { type: 'verification-result', status: 'complete', reason: null }); return state; };
const failed = (id, reason) => { const state = createRunState(); if (RUN_REPORT_CONTRACT.stageDependencies[id].includes('early-load')) reduceRunState(state, { type: 'browser-support', rows: support(raw()) }); for (const dependency of RUN_REPORT_CONTRACT.stageDependencies[id]) reduceRunState(state, { type: 'stage-complete', id: dependency }); reduceRunState(state, { type: 'stage-failed', id, reason }); return state; };
const stable = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
function syntheticFixture(evidence = raw()) { const files = investigationArtifactBytes(evidence); const report = finalizeRunReport(completed(evidence), { candidate: syntheticCandidate, rawEvidence: evidence, files, manifestBytes: Buffer.from('planned') }); return { candidate: syntheticCandidate, rawEvidence: evidence, files, manifestBytes: investigationManifestBytes(files, stable(report)), report }; }
async function diskFixture(source, callback) { const root = await mkdtemp(path.join(os.tmpdir(), 'sidproj-106-mutation-')); const directory = path.join(root, 'evidence'); try { if (source) await cp(source, directory, { recursive: true }); else await finalizeInvestigationRun({ directory, state: ready(), candidate: syntheticCandidate, rawEvidence: raw() }); return await callback(directory); } finally { await rm(root, { recursive: true, force: true }); } }
async function emptyDirectory(callback) { const root = await mkdtemp(path.join(os.tmpdir(), 'sidproj-106-mutation-')); const directory = path.join(root, 'evidence'); try { return await callback(directory); } finally { await rm(root, { recursive: true, force: true }); } }
async function fixtureFromDirectory(directory) { if (!directory) return syntheticFixture(); const report = JSON.parse(await readFile(path.join(directory, 'run-report.json'))); const rawEvidence = JSON.parse(await readFile(path.join(directory, 'evidence.json'))); const files = {}; for (const row of report.artifacts) if (row.sha256 !== null) files[row.path] = await readFile(path.join(directory, row.path)); return { candidate: { gitSha: report.gitSha, branch: report.branch, packageVersion: report.packageVersion }, rawEvidence, files, manifestBytes: report.missingFiles.includes('evidence-sha256.txt') ? null : await readFile(path.join(directory, 'evidence-sha256.txt')), report }; }
function checkFixture(fixture) { return checkInvestigationRunReport(fixture.report, fixture); }
const reportMutation = mutate => async fixture => { mutate(fixture.report, fixture); checkFixture(fixture); };
const alternateRaw = options => { const evidence = raw(options); const fixture = syntheticFixture(evidence); return fixture; };

async function artifactFailureFixture() {
  const evidence = raw(); const files = {};
  const result = await finalizeInvestigationRun({ directory: '/virtual', state: ready(), candidate: syntheticCandidate, rawEvidence: evidence, writeArtifact: async (file, bytes) => { if (file === 'artifacts/baseline-session.json') throw new Error('write'); files[file] = bytes; }, writeManifest: async () => assert.fail('manifest must not be written'), writeReport: async report => report });
  return { candidate: syntheticCandidate, rawEvidence: evidence, files, manifestBytes: null, report: result.report };
}

async function manifestFailureFixture() {
  const evidence = raw(); const files = {};
  const result = await finalizeInvestigationRun({ directory: '/virtual', state: ready(), candidate: syntheticCandidate, rawEvidence: evidence, writeArtifact: async (file, bytes) => { files[file] = bytes; }, writeManifest: async () => { throw new Error('manifest'); }, writeReport: async report => report });
  return { candidate: syntheticCandidate, rawEvidence: evidence, files, manifestBytes: null, report: result.report };
}

export const investigationReportMutations = [
  ['candidate-snapshot rejection produces a complete verify-run stage', async () => { const result = await finalizeInvestigationRun({ directory: '/virtual', state: ready(), candidate: syntheticCandidate, rawEvidence: raw(), checkSnapshot: () => { throw new Error('snapshot'); }, writeReport: async report => report }); result.report.runStages.at(-1) = { id: 'verify-run', status: 'complete', reason: null }; checkInvestigationRunReport(result.report); }],
  ['candidate snapshot accepts a valid-shaped false manifest', async fixture => { fixture.manifestBytes = Buffer.from(`${'0'.repeat(64)}  evidence.json\n`); checkInvestigationSnapshot(fixture.report, fixture); }],
  ['a dirty worktree retains a complete verify-run stage', reportMutation(value => { value.runStages.at(-1).reason = 'dirty-worktree'; })],
  ['an artifact hash mismatch retains a complete verify-run stage', reportMutation(value => { value.runStages.at(-1).reason = 'artifact-hash-mismatch'; })],
  ['a raw-artifact write failure claims its artifact exists', async () => { const fixture = await artifactFailureFixture(); const row = fixture.report.artifacts.find(value => value.path === 'artifacts/baseline-session.json'); row.sha256 = 'b'.repeat(64); fixture.report.missingFiles = fixture.report.missingFiles.filter(file => file !== row.path); checkFixture(fixture); }],
  ['a raw-artifact write failure claims a manifest exists', async () => { const fixture = await artifactFailureFixture(); fixture.report.missingFiles = fixture.report.missingFiles.filter(file => file !== 'evidence-sha256.txt'); checkFixture(fixture); }],
  ['a manifest-write failure claims the manifest exists', async () => { const fixture = await manifestFailureFixture(); fixture.report.missingFiles = []; checkFixture(fixture); }],
  ['a report-write failure after manifest creation leaves a report', async () => emptyDirectory(async directory => { try { await finalizeInvestigationRun({ directory, state: ready(), candidate: syntheticCandidate, rawEvidence: raw(), writeReport: report => writeInvestigationRunReport({ directory, report, writeBytes: async () => { throw new Error('private'); } }) }); } catch (error) { assert.equal(error.message, RUN_REPORT_WRITE_ERROR); } await lstat(path.join(directory, 'run-report.json')); })],
  ['a report-write failure after manifest creation emits success', async () => { const output = terminalRunOutput('/virtual', null, true); output.stdout = 'SIDPROJ_106_READINESS: PASS\n'; checkTerminalRunOutput(output, '/virtual', null, true); }],
  ['final external report corruption is accepted', async (fixture, source) => diskFixture(source, async directory => { await writeFile(path.join(directory, 'run-report.json'), '{}\n'); await checkDirectory(directory, fixture.candidate); })],
  ['final external raw-artifact corruption is accepted', async (fixture, source) => diskFixture(source, async directory => { await writeFile(path.join(directory, 'evidence.json'), '{}\n'); await checkDirectory(directory, fixture.candidate); })],
  ['final external manifest corruption is accepted', async (fixture, source) => diskFixture(source, async directory => { await writeFile(path.join(directory, 'evidence-sha256.txt'), '0'.repeat(64)); await checkDirectory(directory, fixture.candidate); })],
  ['a final external disk failure rewrites the historical report', async (fixture, source) => diskFixture(source, async directory => { const report = await readFile(path.join(directory, 'run-report.json')); await writeFile(path.join(directory, 'evidence.json'), '{}\n'); await assert.rejects(() => checkDirectory(directory, fixture.candidate)); assert.notDeepEqual(await readFile(path.join(directory, 'run-report.json')), report); })],
  ['a setup failure omits the explicit failed stage', async () => { const evidence = { browserVersion: '', artifacts: {} }; const result = await finalizeInvestigationRun({ directory: '/virtual', state: failed('early-load', 'setup-failed'), candidate: syntheticCandidate, rawEvidence: evidence, verificationReason: 'ritual-incomplete', writeArtifact: async () => {}, writeManifest: async () => {}, writeReport: async report => report }); result.report.runStages[0] = { id: 'early-load', status: 'incomplete', reason: 'not-started' }; checkInvestigationRunReport(result.report); }],
  ['a setup failure suppresses the report although report storage works', async () => diskFixture(null, async directory => { await rm(directory, { recursive: true, force: true }); const evidence = { browserVersion: '', artifacts: {} }; await finalizeInvestigationRun({ directory, state: failed('early-load', 'setup-failed'), candidate: syntheticCandidate, rawEvidence: evidence, verificationReason: 'ritual-incomplete' }); await unlink(path.join(directory, 'run-report.json')); await checkDirectory(directory, syntheticCandidate); })],
  ['a report-write failure emits a success marker', async () => { const output = terminalRunOutput('/virtual', null, true); output.stdout = 'SIDPROJ_106_READINESS: PASS\n'; checkTerminalRunOutput(output, '/virtual', null, true); }],
  ['a report-write failure emits raw file-system text', async () => { const output = terminalRunOutput('/virtual', null, true); output.stderr += 'EACCES /private/user/path\n'; checkTerminalRunOutput(output, '/virtual', null, true); }],
  ['a complete action ID list replaces missing runStages', reportMutation(value => { value.runStages = RUN_STAGE_IDS.slice(0, -1); })],
  ['a legacy action ID invents a completed stage', reportMutation(value => { value.runStages[1].id = 'legacy-action'; })],
  ['a missing action ID suppresses an explicit failed stage', reportMutation(value => { value.runStages[1] = { id: 'record-baseline', status: 'failed', reason: 'capture-failed' }; })],
  ['runStages has a missing row', reportMutation(value => value.runStages.pop())],
  ['runStages has an extra valid-shaped row', reportMutation(value => value.runStages.push(copy(value.runStages[0])))],
  ['runStages has a duplicate row', reportMutation(value => { value.runStages[1].id = value.runStages[0].id; })],
  ['runStages is reordered', reportMutation(value => { [value.runStages[0], value.runStages[1]] = [value.runStages[1], value.runStages[0]]; })],
  ['a stage uses an unsupported status', reportMutation(value => { value.runStages[0].status = 'other'; })],
  ['a stage uses a valid reason on the wrong stage', reportMutation(value => { value.runStages[1].reason = 'setup-failed'; })],
  ['a complete stage has a reason', reportMutation(value => { value.runStages[0].reason = 'setup-failed'; })],
  ['a blocked stage appears complete', reportMutation(value => { value.runStages[0] = { id: 'early-load', status: 'failed', reason: 'setup-failed' }; })],
  ['browser support claims event timing while the raw sessions do not support it', async () => { const fixture = alternateRaw({ findings: false }); for (const key of ['baselineSession', 'candidateSession']) fixture.rawEvidence.artifacts[key].browserFeatures.eventTiming = false; fixture.files = investigationArtifactBytes(fixture.rawEvidence); fixture.report = finalizeRunReport(completed(fixture.rawEvidence), fixture); fixture.report.browserSupport[2] = { id: 'event-timing', status: 'supported', reason: null }; checkFixture(fixture); }],
  ['browser support claims unavailable event timing while raw event rows exist', async () => { const fixture = syntheticFixture(); fixture.rawEvidence.artifacts.baselineSession.browserEntries.push({ kind: 'event-timing' }); fixture.files = investigationArtifactBytes(fixture.rawEvidence); fixture.report = finalizeRunReport(completed(), fixture); fixture.report.browserSupport[2] = { id: 'event-timing', status: 'unavailable', reason: 'browser-feature-unavailable' }; checkFixture(fixture); }],
  ['browser support claims unavailable long animation frames while a raw row exists', async () => { const fixture = syntheticFixture(); fixture.rawEvidence.artifacts.baselineSession.browserEntries.push({ kind: 'long-animation-frame' }); fixture.files = investigationArtifactBytes(fixture.rawEvidence); fixture.report = finalizeRunReport(completed(), fixture); fixture.report.browserSupport[3] = { id: 'long-animation-frames', status: 'unavailable', reason: 'browser-feature-unavailable' }; checkFixture(fixture); }],
  ['browser support has an extra valid-shaped row', reportMutation(value => value.browserSupport.push(copy(value.browserSupport[0])))],
  ['browser support is reordered', reportMutation(value => { [value.browserSupport[0], value.browserSupport[1]] = [value.browserSupport[1], value.browserSupport[0]]; })],
  ['an incomplete report claims a clean outcome', reportMutation(value => { value.runStages.at(-1) = { id: 'verify-run', status: 'failed', reason: 'ritual-incomplete' }; value.status = 'incomplete'; value.outcome = 'clean'; })],
  ['an honest unknown report claims a clean outcome', async () => { const fixture = alternateRaw({ findings: false, unknown: true }); fixture.report.outcome = 'clean'; checkFixture(fixture); }],
  ['an empty findings array claims clean while one stage is incomplete', reportMutation(value => { value.findings = []; value.runStages.at(-1) = { id: 'verify-run', status: 'failed', reason: 'ritual-incomplete' }; value.status = 'incomplete'; value.outcome = 'clean'; })],
  ['a limit changes to another valid integer', reportMutation(value => { value.collectionLimits.baselineSession.maxDurationMs = 30001; })],
  ['a drop count changes to another valid integer', reportMutation(value => { value.dropCounts.baselineSession.eventTiming = 1; })],
  ['an unknown row uses an unsupported reason', reportMutation(value => { value.unknownReasons = [{ scope: 'browser', reason: 'private-value', count: 1 }]; })],
  ['an unknown row uses a valid reason with the wrong scope', reportMutation(value => { value.unknownReasons = [{ scope: 'candidate-session', reason: 'first-window', count: 1 }]; })],
  ['an unknown row has zero count', reportMutation(value => { value.unknownReasons = [{ scope: 'browser', reason: 'event-timing', count: 0 }]; })],
  ['an extra valid-looking unknown row appears', reportMutation(value => { value.unknownReasons = [{ scope: 'browser', reason: 'event-timing', count: 1 }]; })],
  ['a raw finding is missing from the report', reportMutation(value => value.findings.pop())],
  ['an extra valid-looking finding row appears', reportMutation(value => value.findings.push(copy(value.findings[0])))],
  ['an artifact path changes to another valid-looking path', reportMutation(value => { value.artifacts[0].path = 'evidence-copy.json'; })],
  ['an artifact path uses traversal', reportMutation(value => { value.artifacts[0].path = '../evidence.json'; })],
  ['an artifact path has a query string', reportMutation(value => { value.artifacts[0].path = 'evidence.json?x=1'; })],
  ['an artifact path has a fragment', reportMutation(value => { value.artifacts[0].path = 'evidence.json#x'; })],
  ['an artifact hash changes to another valid hash', reportMutation(value => { value.artifacts[0].sha256 = 'b'.repeat(64); })],
  ['a null artifact hash points to an existing file', reportMutation(value => { value.artifacts[0].sha256 = null; value.missingFiles = ['evidence.json']; })],
  ['a non-null artifact hash points to no file', reportMutation((_value, fixture) => { delete fixture.files['evidence.json']; })],
  ['an extra file appears in the evidence directory', async (fixture, source) => diskFixture(source, async directory => { await writeFile(path.join(directory, 'extra.json'), '{}\n'); await checkDirectory(directory, fixture.candidate); })],
  ['an extra root field appears', reportMutation(value => { value.extra = true; })],
  ['an extra nested field appears', reportMutation(value => { value.runStages[0].extra = true; })],
];

export async function runInvestigationReportMutations(directory) {
  const base = await fixtureFromDirectory(directory);
  assert.equal(checkInvestigationSnapshot(base.report, base), true);
  if (directory) assert.equal(await checkDirectory(directory, base.candidate), true);
  for (const [name, mutate] of investigationReportMutations) await assert.rejects(() => mutate(copy(base), directory), undefined, name);
  return investigationReportMutations.length;
}

if (process.argv[1]?.endsWith('investigation-run-report-mutations.mjs')) console.log(`SIDPROJ_106_REPORT_MUTATIONS: PASS (${await runInvestigationReportMutations(process.argv[2])})`);
