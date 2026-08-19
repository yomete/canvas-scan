import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const RUN_STAGE_IDS = ['early-load', 'record-baseline', 'explain-baseline', 'copy-explanation', 'keep-baseline', 'apply-change', 'record-candidate', 'pair-findings', 'copy-comparison', 'verify-run'];
export const RUN_REPORT_WRITE_ERROR = 'SIDPROJ_106_RUN_REPORT_ERROR: report-write-failed';
export const RUN_DISK_CHECK_ERROR = 'SIDPROJ_106_RUN_REPORT_ERROR: disk-check-failed';
const stageReasons = Object.freeze({
  'early-load': { unavailable: ['browser-unavailable'], failed: ['setup-failed', 'browser-start-failed'] },
  'record-baseline': { unavailable: ['capture-unavailable'], failed: ['capture-failed'] },
  'explain-baseline': { unavailable: ['explanation-unavailable'], failed: ['explanation-failed'] },
  'copy-explanation': { unavailable: ['export-unavailable'], failed: ['export-failed'] },
  'keep-baseline': { unavailable: [], failed: ['baseline-selection-failed'] },
  'apply-change': { unavailable: [], failed: ['candidate-change-failed'] },
  'record-candidate': { unavailable: ['capture-unavailable'], failed: ['capture-failed'] },
  'pair-findings': { unavailable: ['finding-unavailable', 'comparison-unavailable'], failed: ['comparison-failed'] },
  'copy-comparison': { unavailable: ['export-unavailable'], failed: ['export-failed'] },
  'verify-run': { unavailable: [], failed: ['artifact-missing', 'artifact-hash-mismatch', 'artifact-write-failed', 'manifest-write-failed', 'candidate-snapshot-invalid', 'ritual-incomplete', 'dirty-worktree', 'cleanup-failed'] },
});
const artifactRows = Object.freeze([['readiness-evidence', 'evidence.json', null], ['baseline-session', 'artifacts/baseline-session.json', 'baselineSession'], ['explanation', 'artifacts/explanation.json', 'copiedExplanation'], ['candidate-session', 'artifacts/candidate-session.json', 'candidateSession'], ['comparison', 'artifacts/comparison.json', 'copiedComparison']]);
const artifactStages = [null, 'record-baseline', 'copy-explanation', 'record-candidate', 'copy-comparison'];
const supportIds = ['canvas-2d', 'monotonic-time', 'event-timing', 'long-animation-frames'];
const rootKeys = ['schemaVersion', 'issue', 'status', 'outcome', 'gitSha', 'branch', 'packageVersion', 'browserVersion', 'runStages', 'browserSupport', 'collectionLimits', 'dropCounts', 'unknownReasons', 'findings', 'artifacts', 'missingFiles'];
const stageStatuses = ['complete', 'incomplete', 'unavailable', 'failed'];
const supportStatuses = ['supported', 'unavailable'];
const supportReasons = ['browser-not-run', 'browser-feature-unavailable'];
const findingTypes = ['heavy-canvas-work', 'repeated-draw-work', 'resize-churn', 'backing-store-mismatch'];
const sessionLimits = Object.freeze({ maxDurationMs: 30000, maxCanvasWindowReports: 10000, maxCanvasLifetimes: 128, maxResetEvents: 10000, maxLifecycleEvents: 10000, maxBrowserEvidenceEntries: 2000, maxLongFrameScriptAttributions: 20 });
const sessionDropped = Object.freeze({ canvasWindowReports: 0, canvasLifetimes: 0, resetEvents: 0, lifecycleEvents: 0, documentEvents: 0, eventTiming: 0, userMarks: 0, longAnimationFrames: 0 });
const explanationLimits = Object.freeze({ maxDurationMs: 10000, maxSelectedCanvases: 1, maxActiveWindows: 120, maxCommandEntries: 5000, maxArgumentsPerCommand: 20, maxValueTokens: 1024, maxStackSamples: 8, maxFramesPerStack: 20, maxSourceMapLookups: 8, maxSourceMapResponseBytes: 2097152 });
const explanationDropped = Object.freeze({ durationStops: 0, selectedCanvasRejections: 0, activeWindows: 0, commandEntries: 0, commandArguments: 0, valueTokens: 0, stackSamples: 0, stackFrames: 0, sourceMapLookups: 0, sourceMapResponses: 0 });
const allowedMissing = [...artifactRows.map(([, file]) => file), 'evidence-sha256.txt'];
const unknownReasons = Object.freeze({
  browser: ['event-timing', 'long-animation-frames'],
  'baseline-session': ['first-window'],
  'candidate-session': [],
  'explanation-command': ['unsupported-value', 'argument-limit', 'value-token-limit', 'command-limit', 'window-limit', 'sampling-gap', 'missing-reference', 'instrumentation-disabled'],
  'explanation-callsite': ['no-source-map', 'cross-origin-source-map', 'source-map-lookup-limit', 'source-map-too-large', 'source-map-load-failed', 'source-map-parse-failed', 'mapping-missing'],
  comparison: ['finding-not-found', 'finding-type-mismatch', 'unsupported-schema', 'incomplete-evidence'],
});
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const stable = value => `${JSON.stringify(value, null, 2)}\n`;
const digest = value => createHash('sha256').update(value).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const terminal = row => row.status !== 'incomplete';
const nonNegative = value => Number.isInteger(value) && value >= 0;

export const RUN_REPORT_CONTRACT = Object.freeze({ schemaVersion: 1, issue: 'SIDPROJ-106', rootKeys, stageStatuses, stageReasons, stageDependencies: Object.freeze(Object.fromEntries(RUN_STAGE_IDS.map((id, index) => [id, RUN_STAGE_IDS.slice(0, index)]))), artifactRows: Object.freeze(artifactRows.map(([id, path], index) => ({ id, path, stage: artifactStages[index] }))), supportIds: Object.freeze(supportIds), supportStatuses, supportReasons, unknownReasons, findingTypes, findingEvidenceLevel: 'candidate', collectionKeys: ['baselineSession', 'explanation', 'candidateSession'], fixed: Object.freeze({ branch: 'agent/sidproj-106-run-report', packageVersion: '0.5.0', sessionLimits, sessionDropped, explanationLimits, explanationDropped }), emptyDropCounts: Object.freeze({ baselineSession: {}, explanation: {}, candidateSession: {} }) });

export function createRunState() { return { runStages: RUN_STAGE_IDS.map(id => ({ id, status: 'incomplete', reason: 'not-started' })), browserSupport: null, artifacts: new Set(), findings: [], unknownReasons: [] }; }

function validateSupport(rows) {
  if (!Array.isArray(rows) || rows.length !== supportIds.length) throw new Error('browser support changed');
  for (const [index, row] of rows.entries()) {
    if (!exact(row, ['id', 'status', 'reason']) || row.id !== supportIds[index] || !supportStatuses.includes(row.status)) throw new Error('browser support changed');
    if (row.status === 'supported' ? row.reason !== null : !supportReasons.includes(row.reason)) throw new Error('browser support changed');
  }
}

function assertEvent(event) {
  const shapes = { 'stage-complete': ['type', 'id'], 'stage-unavailable': ['type', 'id', 'reason'], 'stage-failed': ['type', 'id', 'reason'], 'browser-support': ['type', 'rows'], 'artifact-recorded': ['type', 'id'], 'finding-recorded': ['type', 'row'], 'unknown-recorded': ['type', 'row'], 'verification-result': ['type', 'status', 'reason'] };
  if (!event || typeof event !== 'object' || Array.isArray(event) || !shapes[event.type] || !exact(event, shapes[event.type])) throw new Error('run event changed');
}

export function reduceRunState(state, event) {
  assertEvent(event);
  if (!state || !Array.isArray(state.runStages) || state.runStages.length !== RUN_STAGE_IDS.length) throw new Error('run state changed');
  if (event.type === 'browser-support') { if (state.browserSupport !== null) throw new Error('browser support transition changed'); validateSupport(event.rows); state.browserSupport = structuredClone(event.rows); return state; }
  if (event.type === 'artifact-recorded') { if (!artifactRows.some(([id]) => id === event.id) || state.artifacts.has(event.id)) throw new Error('artifact event changed'); state.artifacts.add(event.id); return state; }
  if (event.type === 'finding-recorded') { if (!exact(event.row, ['session', 'findingIndex', 'type', 'evidenceLevel']) || !['baseline', 'candidate'].includes(event.row.session) || !Number.isInteger(event.row.findingIndex) || event.row.findingIndex < 0 || !findingTypes.includes(event.row.type) || event.row.evidenceLevel !== RUN_REPORT_CONTRACT.findingEvidenceLevel || state.findings.some(row => row.session === event.row.session && row.findingIndex === event.row.findingIndex)) throw new Error('finding event changed'); state.findings.push(structuredClone(event.row)); return state; }
  if (event.type === 'unknown-recorded') { if (!exact(event.row, ['scope', 'reason', 'count']) || !unknownReasons[event.row.scope]?.includes(event.row.reason) || !Number.isInteger(event.row.count) || event.row.count < 1 || state.unknownReasons.some(row => row.scope === event.row.scope && row.reason === event.row.reason)) throw new Error('unknown event changed'); state.unknownReasons.push(structuredClone(event.row)); return state; }
  const id = event.type === 'verification-result' ? 'verify-run' : event.id;
  const row = state.runStages.find(value => value.id === id);
  if (!row || terminal(row)) throw new Error('run stage transition changed');
  if (event.type === 'stage-complete' && RUN_REPORT_CONTRACT.stageDependencies[id].some(dependency => state.runStages.find(row => row.id === dependency).status !== 'complete')) throw new Error('run stage order changed');
  const status = event.type === 'stage-complete' ? 'complete' : event.type === 'stage-unavailable' ? 'unavailable' : event.type === 'stage-failed' ? 'failed' : event.status;
  const reason = status === 'complete' ? null : event.reason;
  if (!stageStatuses.filter(value => value !== 'incomplete').includes(status) || (status !== 'complete' && !stageReasons[id][status].includes(reason))) throw new Error('run stage reason changed');
  if (id === 'verify-run' && status === 'complete' && state.runStages.slice(0, -1).some(value => value.status !== 'complete')) throw new Error('verification completed before ritual');
  row.status = status; row.reason = reason;
  if (status !== 'complete') for (const later of state.runStages.slice(RUN_STAGE_IDS.indexOf(id) + 1)) if (!terminal(later)) later.reason = 'blocked-by-prior-stage';
  return state;
}

export function checkRunStages(runStages, context = {}) {
  if (!Array.isArray(runStages) || runStages.length !== RUN_STAGE_IDS.length) throw new Error('run stages changed');
  for (const [index, row] of runStages.entries()) {
    if (!exact(row, ['id', 'status', 'reason']) || row.id !== RUN_STAGE_IDS[index] || !stageStatuses.includes(row.status)) throw new Error('run stage changed');
    if (row.status === 'complete' ? row.reason !== null : row.status === 'incomplete' ? !['not-started', 'blocked-by-prior-stage'].includes(row.reason) : !stageReasons[row.id][row.status].includes(row.reason)) throw new Error('run stage reason changed');
    if (index && runStages.slice(0, index).some(previous => previous.status !== 'complete') && row.status === 'complete') throw new Error('blocked run stage completed');
  }
  if (context.requireComplete && runStages.some(row => row.status !== 'complete')) throw new Error('run is incomplete');
  return true;
}

function derivedSupport(raw, stages) {
  if (stages[0]?.status !== 'complete') return supportIds.map(id => ({ id, status: 'unavailable', reason: 'browser-not-run' }));
  const baseline = raw?.artifacts?.baselineSession?.browserFeatures;
  const candidate = raw?.artifacts?.candidateSession?.browserFeatures;
  const feature = name => baseline?.[name] === true && candidate?.[name] === true;
  return [{ id: 'canvas-2d', status: 'supported', reason: null }, { id: 'monotonic-time', status: 'supported', reason: null }, { id: 'event-timing', status: feature('eventTiming') ? 'supported' : 'unavailable', reason: feature('eventTiming') ? null : 'browser-feature-unavailable' }, { id: 'long-animation-frames', status: feature('longAnimationFrames') ? 'supported' : 'unavailable', reason: feature('longAnimationFrames') ? null : 'browser-feature-unavailable' }];
}
function derivedFindings(raw) { return ['baselineSession', 'candidateSession'].flatMap((key, index) => (raw?.artifacts?.[key]?.findings ?? []).map((finding, findingIndex) => ({ session: index ? 'candidate' : 'baseline', findingIndex, type: finding.type, evidenceLevel: finding.evidenceLevel }))); }
function increment(rows, scope, reason) { if (typeof reason !== 'string' || !reason) return; const row = rows.find(value => value.scope === scope && value.reason === reason); if (row) row.count++; else rows.push({ scope, reason, count: 1 }); }
function derivedUnknowns(raw, support) {
  const rows = [];
  for (const row of support.filter(row => row.status === 'unavailable' && row.reason === 'browser-feature-unavailable')) increment(rows, 'browser', row.id);
  for (const [key, scope] of [['baselineSession', 'baseline-session'], ['candidateSession', 'candidate-session']]) for (const window of raw?.artifacts?.[key]?.windows ?? []) increment(rows, scope, window.unknownReason);
  for (const window of raw?.artifacts?.copiedExplanation?.windows ?? []) { increment(rows, 'explanation-command', window.unknownReason); for (const command of window.commands ?? []) increment(rows, 'explanation-command', command.unknownReason); }
  for (const comparison of raw?.artifacts?.copiedExplanation?.comparisons ?? []) increment(rows, 'explanation-command', comparison.unknownReason);
  for (const stack of raw?.artifacts?.copiedExplanation?.stacks ?? []) for (const frame of stack.frames ?? []) increment(rows, 'explanation-callsite', frame.unresolvedReason);
  for (const reason of raw?.artifacts?.copiedComparison?.incomparableReasons ?? []) increment(rows, 'comparison', reason);
  return rows.sort((left, right) => `${left.scope}\0${left.reason}`.localeCompare(`${right.scope}\0${right.reason}`));
}
export function investigationArtifactBytes(raw) { return Object.fromEntries(artifactRows.map(([, file, rawKey]) => [file, rawKey && raw?.artifacts?.[rawKey] ? Buffer.from(stable(raw.artifacts[rawKey])) : file === 'evidence.json' && raw ? Buffer.from(stable(raw)) : null])); }
function artifactBytes(input, raw) { const supplied = input.files !== undefined; const files = input.files ?? {}; return Object.fromEntries(artifactRows.map(([, file, rawKey]) => [file, supplied ? files[file] ?? null : rawKey && raw?.artifacts?.[rawKey] ? Buffer.from(stable(raw.artifacts[rawKey])) : file === 'evidence.json' && raw ? Buffer.from(stable(raw)) : null])); }
function reportCollections(raw, files) { const present = file => Boolean(files[file]); return { collectionLimits: { baselineSession: present('artifacts/baseline-session.json') ? raw?.artifacts?.baselineSession?.collectionLimits ?? {} : {}, explanation: present('artifacts/explanation.json') ? raw?.artifacts?.copiedExplanation?.collectionLimits ?? {} : {}, candidateSession: present('artifacts/candidate-session.json') ? raw?.artifacts?.candidateSession?.collectionLimits ?? {} : {} }, dropCounts: { baselineSession: present('artifacts/baseline-session.json') ? raw?.artifacts?.baselineSession?.droppedEntryCounts ?? {} : {}, explanation: present('artifacts/explanation.json') ? raw?.artifacts?.copiedExplanation?.droppedEntryCounts ?? {} : {}, candidateSession: present('artifacts/candidate-session.json') ? raw?.artifacts?.candidateSession?.droppedEntryCounts ?? {} : {} } }; }

export function finalizeRunReport(state, input) {
  const raw = input.rawEvidence ?? input.evidence ?? null;
  const runStages = structuredClone(state.runStages); checkRunStages(runStages);
  const files = artifactBytes(input, raw);
  const artifacts = artifactRows.map(([id, file]) => ({ id, path: file, sha256: files[file] ? digest(files[file]) : null }));
  const missingFiles = [...artifacts.filter(row => row.sha256 === null).map(row => row.path), ...(input.manifestBytes ? [] : ['evidence-sha256.txt'])].sort();
  if (runStages[0].status === 'complete' && state.browserSupport === null) throw new Error('browser support was not recorded');
  const browserSupport = state.browserSupport ?? derivedSupport(raw, runStages);
  const findings = derivedFindings(raw); const unknownReasons = derivedUnknowns(raw, browserSupport); const status = runStages.every(row => row.status === 'complete') ? 'complete' : 'incomplete';
  return { schemaVersion: 1, issue: 'SIDPROJ-106', status, outcome: status === 'incomplete' ? 'incomplete' : findings.length ? 'findings' : unknownReasons.length ? 'unknown' : 'clean', gitSha: input.candidate?.gitSha ?? null, branch: input.candidate?.branch ?? null, packageVersion: input.candidate?.packageVersion ?? null, browserVersion: /^\d+\.\d+\.\d+\.\d+$/.test(raw?.browserVersion ?? '') ? raw.browserVersion : null, runStages, browserSupport, ...reportCollections(raw, files), unknownReasons, findings, artifacts, missingFiles };
}
function validateRows(rows, expected, label, emptyRequired = false) { if (emptyRequired ? !exact(rows, []) : !exact(rows, Object.keys(expected)) || Object.values(rows).some(value => !nonNegative(value)) || !same(rows, expected)) throw new Error(`${label} changed`); }
function checkArtifactBytes(report, context) { const files = context.files; if (!files) return; for (const row of report.artifacts) { const bytes = files[row.path]; if ((bytes !== undefined && bytes !== null) !== (row.sha256 !== null) || (bytes && digest(bytes) !== row.sha256)) throw new Error('report artifact hash changed'); } const raw = context.rawEvidence; if (raw && files['evidence.json'] && !Buffer.from(files['evidence.json']).equals(Buffer.from(stable(raw)))) throw new Error('evidence bytes changed'); for (const [, file, rawKey] of artifactRows) if (rawKey && files[file] && !Buffer.from(files[file]).equals(Buffer.from(stable(raw?.artifacts?.[rawKey])))) throw new Error('extracted artifact changed'); }

export function checkInvestigationRunReport(report, context = {}) {
  if (!exact(report, rootKeys) || report.schemaVersion !== RUN_REPORT_CONTRACT.schemaVersion || report.issue !== RUN_REPORT_CONTRACT.issue) throw new Error('run report root changed');
  checkRunStages(report.runStages); const complete = report.runStages.every(row => row.status === 'complete');
  if (report.runStages.some(row => row.status === 'incomplete' && row.reason === 'not-started')) throw new Error('run report has an unterminated stage');
  if (report.status !== (complete ? 'complete' : 'incomplete') || report.outcome !== (!complete ? 'incomplete' : report.findings.length ? 'findings' : report.unknownReasons.length ? 'unknown' : 'clean')) throw new Error('run report terminal state changed');
  if ((report.gitSha !== null && !/^[0-9a-f]{40}$/.test(report.gitSha)) || ![null, RUN_REPORT_CONTRACT.fixed.branch].includes(report.branch) || ![null, RUN_REPORT_CONTRACT.fixed.packageVersion].includes(report.packageVersion) || (complete && (report.gitSha === null || report.branch === null || report.packageVersion === null))) throw new Error('run report identity changed');
  if (context.candidate && !same({ gitSha: report.gitSha, branch: report.branch, packageVersion: report.packageVersion }, context.candidate)) throw new Error('run report candidate changed');
  if (report.browserVersion !== null && !/^\d+\.\d+\.\d+\.\d+$/.test(report.browserVersion) || complete && report.browserVersion === null) throw new Error('browser version changed'); validateSupport(report.browserSupport);
  if (report.runStages[0].status !== 'complete' && (report.browserVersion !== null || report.browserSupport.some(row => row.status !== 'unavailable' || row.reason !== 'browser-not-run'))) throw new Error('browser support state changed');
  if (report.runStages[0].status === 'complete' && (report.browserSupport.slice(0, 2).some(row => row.status !== 'supported' || row.reason !== null) || report.browserSupport.slice(2).some(row => row.reason === 'browser-not-run'))) throw new Error('browser support state changed');
  if (!Array.isArray(report.artifacts) || report.artifacts.length !== artifactRows.length) throw new Error('report artifacts changed');
  for (const [index, row] of report.artifacts.entries()) if (!exact(row, ['id', 'path', 'sha256']) || row.id !== artifactRows[index][0] || row.path !== artifactRows[index][1] || (row.sha256 !== null && !/^[0-9a-f]{64}$/.test(row.sha256))) throw new Error('report artifact changed');
  if (!Array.isArray(report.missingFiles) || !same(report.missingFiles, [...new Set(report.missingFiles)].sort()) || report.missingFiles.some(file => !allowedMissing.includes(file))) throw new Error('report missing files changed');
  for (const row of report.artifacts) if ((row.sha256 === null) !== report.missingFiles.includes(row.path)) throw new Error('report artifact presence changed');
  for (const [index, stageId] of artifactStages.entries()) if (stageId && report.runStages.find(row => row.id === stageId).status !== 'complete' && report.artifacts[index].sha256 !== null) throw new Error('report artifact stage changed');
  if (complete && report.missingFiles.length) throw new Error('complete report has missing files');
  if (Object.hasOwn(context, 'manifestBytes') && (context.manifestBytes !== null) === report.missingFiles.includes('evidence-sha256.txt')) throw new Error('report manifest presence changed');
  if (!exact(report.collectionLimits, RUN_REPORT_CONTRACT.collectionKeys) || !exact(report.dropCounts, RUN_REPORT_CONTRACT.collectionKeys)) throw new Error('report collection roots changed');
  validateRows(report.collectionLimits.baselineSession, sessionLimits, 'baseline limits', report.artifacts[1].sha256 === null); validateRows(report.collectionLimits.candidateSession, sessionLimits, 'candidate limits', report.artifacts[3].sha256 === null); validateRows(report.collectionLimits.explanation, explanationLimits, 'explanation limits', report.artifacts[2].sha256 === null); validateRows(report.dropCounts.baselineSession, sessionDropped, 'baseline drops', report.artifacts[1].sha256 === null); validateRows(report.dropCounts.candidateSession, sessionDropped, 'candidate drops', report.artifacts[3].sha256 === null); validateRows(report.dropCounts.explanation, explanationDropped, 'explanation drops', report.artifacts[2].sha256 === null);
  if (!Array.isArray(report.unknownReasons) || !same(report.unknownReasons, [...report.unknownReasons].sort((left, right) => `${left.scope}\0${left.reason}`.localeCompare(`${right.scope}\0${right.reason}`)))) throw new Error('unknown reasons changed');
  for (const row of report.unknownReasons) if (!exact(row, ['scope', 'reason', 'count']) || !unknownReasons[row.scope]?.includes(row.reason) || !Number.isInteger(row.count) || row.count < 1) throw new Error('unknown reason changed');
  if (new Set(report.unknownReasons.map(row => `${row.scope}\0${row.reason}`)).size !== report.unknownReasons.length) throw new Error('duplicate unknown reason');
  if (!Array.isArray(report.findings)) throw new Error('report findings changed'); const findingIndexes = { baseline: 0, candidate: 0 }; let candidateStarted = false; for (const row of report.findings) { if (!exact(row, ['session', 'findingIndex', 'type', 'evidenceLevel']) || !['baseline', 'candidate'].includes(row.session) || row.findingIndex !== findingIndexes[row.session]++ || candidateStarted && row.session === 'baseline' || !findingTypes.includes(row.type) || row.evidenceLevel !== RUN_REPORT_CONTRACT.findingEvidenceLevel) throw new Error('report finding changed'); if (row.session === 'candidate') candidateStarted = true; }
  const raw = context.rawEvidence;
  if (raw) { if (!same(report.browserSupport, derivedSupport(raw, report.runStages)) || !same(report.findings, derivedFindings(raw)) || !same(report.unknownReasons, derivedUnknowns(raw, report.browserSupport))) throw new Error('run report raw evidence changed'); const collectionFiles = Object.fromEntries(report.artifacts.map(row => [row.path, row.sha256 === null ? null : context.files?.[row.path] ?? true])); const collections = reportCollections(raw, collectionFiles); if (!same(report.collectionLimits, collections.collectionLimits) || !same(report.dropCounts, collections.dropCounts)) throw new Error('run report collections changed'); const sessions = [raw.artifacts?.baselineSession, raw.artifacts?.candidateSession]; if (report.runStages[0].status === 'complete' && sessions.some(session => session?.browserFeatures?.monotonicTime !== true || session?.browserFeatures?.eventTiming !== (report.browserSupport[2].status === 'supported') || session?.browserFeatures?.longAnimationFrames !== (report.browserSupport[3].status === 'supported'))) throw new Error('browser feature support changed'); const browserRows = sessions.flatMap(session => [...(session?.browserEntries ?? []), ...(session?.episodeAssociations ?? []).map(row => ({ kind: row.entryKind }))]); if (report.browserSupport[2].status === 'unavailable' && browserRows.some(row => row.kind === 'event-timing')) throw new Error('event timing support changed'); if (report.browserSupport[3].status === 'unavailable' && browserRows.some(row => row.kind === 'long-animation-frame')) throw new Error('long animation support changed'); }
  checkArtifactBytes(report, context); return true;
}

export function investigationManifestBytes(files, reportBytes) {
  const rows = Object.entries(files).filter(([, bytes]) => bytes !== null && bytes !== undefined).map(([file, bytes]) => [file, bytes]);
  rows.push(['run-report.json', reportBytes]);
  return Buffer.from(`${rows.sort(([left], [right]) => left.localeCompare(right)).map(([file, bytes]) => `${digest(bytes)}  ${file}`).join('\n')}\n`);
}

export function checkInvestigationSnapshot(report, context) {
  const paths = artifactRows.map(([, file]) => file);
  if (!context || !exact(context.files, paths) || !context.manifestBytes) throw new Error('candidate snapshot files changed');
  for (const file of paths) {
    const bytes = context.files[file];
    if (bytes === null) continue;
    let value;
    try { value = JSON.parse(Buffer.from(bytes)); }
    catch { throw new Error('candidate snapshot JSON changed'); }
    if (!Buffer.from(bytes).equals(Buffer.from(stable(value)))) throw new Error('candidate snapshot JSON changed');
  }
  checkInvestigationRunReport(report, context);
  const expectedManifest = investigationManifestBytes(context.files, Buffer.from(stable(report)));
  if (!Buffer.from(context.manifestBytes).equals(expectedManifest)) throw new Error('candidate snapshot manifest changed');
  return true;
}

async function writeAtomic(directory, file, bytes, writeBytes = writeFile, renameFile = rename, removeFile = rm, makeDirectory = mkdir) {
  const target = path.join(directory, file); const temporary = `${target}.tmp`;
  await makeDirectory(path.dirname(target), { recursive: true });
  try { await writeBytes(temporary, bytes); await renameFile(temporary, target); }
  catch (error) { try { await removeFile(temporary, { force: true }); } catch {} throw error; }
}

export async function preflightInvestigationRunReport({ directory, writeBytes = writeFile, removeFile = rm, makeDirectory = mkdir }) {
  const temporary = path.join(directory, 'run-report.json.preflight');
  try { await makeDirectory(directory, { recursive: true }); if ((await readdir(directory)).length) throw new Error('output directory is not empty'); await writeBytes(temporary, ''); await removeFile(temporary, { force: true }); }
  catch { try { await removeFile(temporary, { force: true }); } catch {} throw new Error(RUN_REPORT_WRITE_ERROR); }
}

export async function writeInvestigationRunReport({ directory, report, writeBytes = writeFile, renameFile = rename, removeFile = rm, makeDirectory = mkdir, checkSnapshot = checkInvestigationRunReport }) {
  const target = path.join(directory, 'run-report.json'); const temporary = `${target}.tmp`;
  checkSnapshot(report);
  try { await makeDirectory(directory, { recursive: true }); await writeBytes(temporary, stable(report)); await renameFile(temporary, target); return target; }
  catch { try { await removeFile(temporary, { force: true }); } catch {} throw new Error(RUN_REPORT_WRITE_ERROR); }
}

function verificationEvent(reason) { return { type: 'verification-result', status: reason ? 'failed' : 'complete', reason }; }
function terminalReport(state, reason, input) { reduceRunState(state, verificationEvent(reason)); return finalizeRunReport(state, input); }

export async function finalizeInvestigationRun({ directory, state, candidate, rawEvidence, files = investigationArtifactBytes(rawEvidence), verificationReason = null, checkSnapshot = checkInvestigationSnapshot, writeArtifact = (file, bytes) => writeAtomic(directory, file, bytes), writeManifest = bytes => writeAtomic(directory, 'evidence-sha256.txt', bytes), writeReport = report => writeInvestigationRunReport({ directory, report }) }) {
  const projected = structuredClone(state);
  reduceRunState(projected, verificationEvent(verificationReason));
  const proposed = finalizeRunReport(projected, { candidate, rawEvidence, files, manifestBytes: Buffer.from('planned') });
  const proposedBytes = Buffer.from(stable(proposed));
  const manifestBytes = investigationManifestBytes(files, proposedBytes);
  try { checkSnapshot(proposed, { candidate, rawEvidence, files, manifestBytes }); }
  catch {
    const report = terminalReport(state, 'candidate-snapshot-invalid', { candidate, rawEvidence: null, files: {}, manifestBytes: null });
    const reportPath = await writeReport(report);
    return { report, reportPath, writtenFiles: ['run-report.json'] };
  }

  const written = {};
  const writtenFiles = [];
  for (const [, file] of artifactRows) {
    if (!files[file]) continue;
    try { await writeArtifact(file, files[file]); written[file] = files[file]; writtenFiles.push(file); }
    catch {
      const persistedRaw = written['evidence.json'] ? rawEvidence : null;
      const report = terminalReport(state, 'artifact-write-failed', { candidate, rawEvidence: persistedRaw, files: written, manifestBytes: null });
      const reportPath = await writeReport(report); writtenFiles.push('run-report.json');
      return { report, reportPath, writtenFiles };
    }
  }

  try { await writeManifest(manifestBytes); writtenFiles.push('evidence-sha256.txt'); }
  catch {
    const report = terminalReport(state, 'manifest-write-failed', { candidate, rawEvidence, files: written, manifestBytes: null });
    const reportPath = await writeReport(report); writtenFiles.push('run-report.json');
    return { report, reportPath, writtenFiles };
  }

  const report = terminalReport(state, verificationReason, { candidate, rawEvidence, files: written, manifestBytes });
  if (!same(report, proposed)) throw new Error('candidate report changed');
  const reportPath = await writeReport(report); writtenFiles.push('run-report.json');
  return { report, reportPath, writtenFiles };
}

export function terminalRunOutput(directory, report, reportWriteFailed = false, diskCheckFailed = false) {
  if (reportWriteFailed) return { exitCode: 1, stdout: '', stderr: `${RUN_REPORT_WRITE_ERROR}\n` };
  if (diskCheckFailed) return { exitCode: 1, stdout: '', stderr: `${RUN_DISK_CHECK_ERROR}\n` };
  checkInvestigationRunReport(report);
  const result = report.status === 'complete' ? 'PASS' : 'INCOMPLETE';
  return { exitCode: report.status === 'complete' ? 0 : 1, stdout: `SIDPROJ_106_READINESS_EVIDENCE: ${directory}\nSIDPROJ_106_READINESS: ${result}\n`, stderr: '' };
}

export function checkTerminalRunOutput(output, directory, report, reportWriteFailed = false, diskCheckFailed = false) {
  if (!exact(output, ['exitCode', 'stdout', 'stderr']) || !same(output, terminalRunOutput(directory, report, reportWriteFailed, diskCheckFailed))) throw new Error('terminal output changed');
  return true;
}
