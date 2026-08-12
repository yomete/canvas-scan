import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expectedMatrix, sessionFor } from './session-comparison-fixture.mjs';

const artifactKeys = ['schemaVersion', 'comparisonId', 'createdAt', 'canvasScanVersion', 'pairingMethod', 'baseline', 'candidate', 'status', 'incomparableReasons', 'measures', 'improvementEstablished'];
const refKeys = ['sessionId', 'findingIndex', 'findingType', 'canvasId'];
const measureKeys = ['id', 'unit', 'baseline', 'candidate', 'delta', 'direction', 'interpretation'];
const findingTypes = new Set(['heavy-canvas-work', 'repeated-draw-work', 'resize-churn', 'backing-store-mismatch']);
const rows = expectedMatrix.rows;
const rowIds = ['heavy-work', 'repeated-work', 'resize-churn', 'backing-store-mismatch', 'session-identities', 'canvas-creation-order', 'unrelated-canvas-work', 'finding-type-mismatch'];
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const stable = value => `${JSON.stringify(value, null, 2)}\n`;
const sha = value => createHash('sha256').update(value).digest('hex');

function fail(message) { throw new Error(`session comparison evidence failed: ${message}`); }
function exactKeys(value, keys, label) { if (!value || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail(`${label} has wrong keys`); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined; }
function text(value) { return typeof value === 'string' && value.length > 0; }
function index(value) { return Number.isInteger(value) && value >= 0; }
function count(value) { return Number.isInteger(value) && value >= 0; }
function number(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function date(value) { return text(value) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)); }
function selected(session, findingIndex) { return index(findingIndex) && Array.isArray(session?.findings) ? record(session.findings[findingIndex]) : undefined; }
function ref(session, findingIndex) {
  const finding = selected(session, findingIndex);
  return {
    sessionId: text(session?.sessionId) ? session.sessionId : '',
    findingIndex: typeof findingIndex === 'number' ? findingIndex : -1,
    findingType: finding && findingTypes.has(finding.type) ? finding.type : null,
    canvasId: text(finding?.canvasId) ? finding.canvasId : null,
  };
}
function metadata(baseline, candidate, row) {
  const left = record(baseline); const right = record(candidate);
  const leftId = text(left?.sessionId) ? left.sessionId : ''; const rightId = text(right?.sessionId) ? right.sessionId : '';
  const leftEnded = date(left?.endedAt) ? left.endedAt : ''; const rightEnded = date(right?.endedAt) ? right.endedAt : '';
  return {
    schemaVersion: 1,
    comparisonId: `canvas-scan-comparison-${encodeURIComponent(leftId)}-${typeof row.baselineFindingIndex === 'number' ? row.baselineFindingIndex : -1}-${encodeURIComponent(rightId)}-${typeof row.candidateFindingIndex === 'number' ? row.candidateFindingIndex : -1}`,
    createdAt: leftEnded && rightEnded ? (Date.parse(leftEnded) >= Date.parse(rightEnded) ? leftEnded : rightEnded) : leftEnded || rightEnded,
    canvasScanVersion: text(right?.canvasScanVersion) ? right.canvasScanVersion : '',
    pairingMethod: 'user-selected',
    baseline: ref(left, row.baselineFindingIndex),
    candidate: ref(right, row.candidateFindingIndex),
  };
}
function incomparable(baseline, candidate, row, reason) { return { ...metadata(baseline, candidate, row), status: 'incomparable', incomparableReasons: [reason], measures: [], improvementEstablished: false }; }
function statuses(value) {
  const result = record(value);
  return result && count(result.same) && count(result.changed) && count(result.unknown) ? result : undefined;
}
function methods(value) {
  const result = new Map();
  const entries = Array.isArray(value)
    ? value.map(item => { const method = record(item); return [method?.method, method]; })
    : record(value) ? Object.entries(value) : undefined;
  if (!entries) return undefined;
  for (const [name, raw] of entries) {
    const item = record(raw);
    if (!text(name) || result.has(name) || !item || !count(item.count) || (item.canvasApiSelfTimeMs !== null && !number(item.canvasApiSelfTimeMs))) return undefined;
    result.set(name, { count: item.count, time: item.canvasApiSelfTimeMs });
  }
  return result;
}
function canvas(session, finding) {
  if (!text(finding.canvasId)) return undefined;
  const matches = Array.isArray(session.canvases) ? session.canvases.filter(item => record(item)?.canvasId === finding.canvasId) : [];
  return matches.length === 1 ? record(matches[0]) : undefined;
}
function validCanvas(value) {
  const commandStatuses = statuses(value?.commandStatuses);
  return !!value && text(value.canvasId) && count(value.activeWindowCount) && count(value.rasterOperationCount) && number(value.canvasApiSelfTimeMs) && number(value.maxWindowSelfTimeMs)
    && !!commandStatuses && commandStatuses.same + commandStatuses.changed + commandStatuses.unknown === value.activeWindowCount && !!methods(value.methodEvidence);
}
function validSession(value) {
  const dropped = record(value.droppedEntryCounts);
  return text(value.sessionId) && date(value.endedAt) && text(value.canvasScanVersion) && Array.isArray(value.findings) && Array.isArray(value.canvases)
    && !!dropped && count(dropped.canvasWindowReports) && count(dropped.canvasLifetimes) && count(dropped.resetEvents)
    && dropped.canvasWindowReports === 0 && dropped.canvasLifetimes === 0;
}
function validHeavy(finding) {
  const maximum = record(finding.maximumWindow); const topMethods = Array.isArray(finding.topMethods) ? finding.topMethods : undefined;
  return text(finding.episodeId) && count(finding.rasterOperationCount) && number(finding.canvasApiSelfTimeMs) && !!topMethods && topMethods.length > 0 && !!methods(topMethods)
    && !!maximum && count(maximum.windowIndex) && number(maximum.timestampMs) && number(maximum.canvasApiSelfTimeMs) && count(maximum.rasterOperationCount) && !!methods(maximum.methodEvidence);
}
function validRepeated(finding) {
  const windows = Array.isArray(finding.repeatedWindows) ? finding.repeatedWindows : undefined; const coverage = record(finding.unknownCoverage);
  return text(finding.episodeId) && count(finding.repeatedWindowCount) && count(finding.rasterOperationCount) && number(finding.canvasApiSelfTimeMs) && !!windows && finding.repeatedWindowCount === windows.length
    && windows.every(item => { const window = record(item); return !!window && count(window.windowIndex) && number(window.timestampMs) && count(window.rasterOperationCount) && number(window.canvasApiSelfTimeMs) && count(window.comparisonGap) && window.comparisonGap >= 1; })
    && !!coverage && count(coverage.unknownWindowCount) && count(coverage.activeWindowCount) && coverage.unknownWindowCount <= coverage.activeWindowCount;
}
function validResize(finding, session) {
  const events = Array.isArray(finding.resetEvents) ? finding.resetEvents : undefined; const episodes = Array.isArray(finding.affectedEpisodeIds) ? finding.affectedEpisodeIds : undefined; const commandStatuses = statuses(finding.commandStatuses); const dropped = record(session.droppedEntryCounts);
  return !!dropped && dropped.resetEvents === 0 && count(finding.activeResetCount) && count(finding.observedResetCount) && !!events && !!episodes && !!commandStatuses
    && finding.activeResetCount === events.length && finding.activeResetCount <= finding.observedResetCount
    && events.every(item => { const event = record(item); return !!event && text(event.source) && number(event.width) && number(event.height) && count(event.windowIndex) && number(event.timestampMs); }) && episodes.every(text)
    && commandStatuses.same + commandStatuses.changed + commandStatuses.unknown === new Set(events.map(item => item.windowIndex)).size;
}
function validBacking(finding) {
  const windows = Array.isArray(finding.affectedWindows) ? finding.affectedWindows : undefined; const episodes = Array.isArray(finding.affectedEpisodeIds) ? finding.affectedEpisodeIds : undefined;
  return count(finding.affectedWindowCount) && count(finding.rasterOperationCount) && number(finding.canvasApiSelfTimeMs) && !!windows && !!episodes && finding.affectedWindowCount === windows.length && windows.length > 0
    && episodes.every(text) && windows.every(item => { const window = record(item); return !!window && count(window.windowIndex) && number(window.timestampMs) && count(window.rasterOperationCount) && number(window.canvasApiSelfTimeMs) && number(window.backingWidth) && number(window.backingHeight) && number(window.expectedBackingWidth) && number(window.expectedBackingHeight) && number(window.expectedPixelArea) && number(window.actualToExpectedAreaRatio); });
}
function validFinding(finding, session) {
  if (!findingTypes.has(finding.type) || !text(finding.canvasId)) return false;
  if (finding.type === 'heavy-canvas-work') return validHeavy(finding);
  if (finding.type === 'repeated-draw-work') return validRepeated(finding);
  if (finding.type === 'resize-churn') return validResize(finding, session);
  return validBacking(finding);
}
function measure(id, unit, baseline, candidate) {
  const delta = baseline === null || candidate === null ? null : unit === 'count' ? candidate - baseline : Math.round((candidate - baseline) * 1000) / 1000;
  return { id, unit, baseline, candidate, delta, direction: delta === null ? 'unknown' : delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'unchanged', interpretation: unit === 'ms' ? 'observed-timing-pair' : 'structural' };
}
function unknown(finding, summary) { return finding.type === 'repeated-draw-work' ? finding.unknownCoverage.unknownWindowCount : finding.type === 'resize-churn' ? finding.commandStatuses.unknown : summary.commandStatuses.unknown; }
function findingMeasures(baseline, candidate) {
  if (baseline.type === 'heavy-canvas-work') return [measure('heavy-episode-operation-count', 'count', baseline.rasterOperationCount, candidate.rasterOperationCount), measure('heavy-episode-self-time-ms', 'ms', baseline.canvasApiSelfTimeMs, candidate.canvasApiSelfTimeMs)];
  if (baseline.type === 'repeated-draw-work') return [measure('repeated-window-count', 'count', baseline.repeatedWindowCount, candidate.repeatedWindowCount), measure('repeated-raster-operation-count', 'count', baseline.rasterOperationCount, candidate.rasterOperationCount), measure('comparison-gap-count', 'count', baseline.repeatedWindows.reduce((total, item) => total + item.comparisonGap - 1, 0), candidate.repeatedWindows.reduce((total, item) => total + item.comparisonGap - 1, 0))];
  if (baseline.type === 'resize-churn') return [measure('active-reset-count', 'count', baseline.activeResetCount, candidate.activeResetCount), measure('observed-reset-count', 'count', baseline.observedResetCount, candidate.observedResetCount), measure('affected-episode-count', 'count', new Set(baseline.affectedEpisodeIds).size, new Set(candidate.affectedEpisodeIds).size), measure('same-command-window-count', 'count', baseline.commandStatuses.same, candidate.commandStatuses.same), measure('changed-command-window-count', 'count', baseline.commandStatuses.changed, candidate.commandStatuses.changed)];
  return [measure('affected-backing-window-count', 'count', baseline.affectedWindowCount, candidate.affectedWindowCount), measure('maximum-backing-area-ratio', 'ratio', Math.max(...baseline.affectedWindows.map(item => item.actualToExpectedAreaRatio)), Math.max(...candidate.affectedWindows.map(item => item.actualToExpectedAreaRatio)))];
}

export function recompute(row, baseline, candidate) {
  const leftSession = record(baseline); const rightSession = record(candidate);
  if (!leftSession || !rightSession || leftSession.schemaVersion !== 1 || rightSession.schemaVersion !== 1) return incomparable(baseline, candidate, row, 'unsupported-schema');
  if (!Array.isArray(leftSession.findings) || !Array.isArray(rightSession.findings)) return incomparable(baseline, candidate, row, 'incomplete-evidence');
  const left = selected(leftSession, row.baselineFindingIndex); const right = selected(rightSession, row.candidateFindingIndex);
  if (!left || !right) return incomparable(baseline, candidate, row, 'finding-not-found');
  if (left.type !== right.type) return incomparable(baseline, candidate, row, 'finding-type-mismatch');
  const leftCanvas = canvas(leftSession, left); const rightCanvas = canvas(rightSession, right);
  if (!validSession(leftSession) || !validSession(rightSession) || !validCanvas(leftCanvas) || !validCanvas(rightCanvas) || !validFinding(left, leftSession) || !validFinding(right, rightSession)) return incomparable(baseline, candidate, row, 'incomplete-evidence');
  const leftMethods = methods(left.type === 'heavy-canvas-work' ? left.topMethods : leftCanvas.methodEvidence); const rightMethods = methods(right.type === 'heavy-canvas-work' ? right.topMethods : rightCanvas.methodEvidence);
  if (!leftMethods || !rightMethods) return incomparable(baseline, candidate, row, 'incomplete-evidence');
  const measures = [measure('active-window-count', 'count', leftCanvas.activeWindowCount, rightCanvas.activeWindowCount), measure('raster-operation-count', 'count', leftCanvas.rasterOperationCount, rightCanvas.rasterOperationCount), measure('canvas-api-self-time-ms', 'ms', leftCanvas.canvasApiSelfTimeMs, rightCanvas.canvasApiSelfTimeMs), measure('maximum-window-self-time-ms', 'ms', leftCanvas.maxWindowSelfTimeMs, rightCanvas.maxWindowSelfTimeMs)];
  for (const name of [...new Set([...leftMethods.keys(), ...rightMethods.keys()])].sort()) { const a = leftMethods.get(name); const b = rightMethods.get(name); measures.push(measure(`method:${name}:operation-count`, 'count', a?.count ?? 0, b?.count ?? 0), measure(`method:${name}:self-time-ms`, 'ms', a ? a.time : 0, b ? b.time : 0)); }
  measures.push(measure('unknown-command-window-count', 'count', unknown(left, leftCanvas), unknown(right, rightCanvas)), ...findingMeasures(left, right));
  return { ...metadata(baseline, candidate, row), status: 'comparable', incomparableReasons: [], measures, improvementEstablished: false };
}

function files(directory) {
  const result = []; const walk = relative => { for (const item of readdirSync(join(directory, relative), { withFileTypes: true })) { const path = `${relative}${item.name}`; if (item.isDirectory()) walk(`${path}/`); else result.push(path); } }; walk(''); return result.sort();
}
function validateArtifactShape(artifact, label) {
  exactKeys(artifact, artifactKeys, label); exactKeys(artifact.baseline, refKeys, `${label} baseline`); exactKeys(artifact.candidate, refKeys, `${label} candidate`);
  if (!Array.isArray(artifact.incomparableReasons) || !Array.isArray(artifact.measures)) fail(`${label} collections are invalid`);
  artifact.measures.forEach((item, indexValue) => exactKeys(item, measureKeys, `${label} measure ${indexValue}`));
}
export function checkEvidence(directory, { requireCommandOutputs = false } = {}) {
  if (rows.map(row => row.id).join(',') !== rowIds.join(',')) fail('expected row set is wrong');
  const commandOutputs = ['focused-test-output.txt', 'checker-test-output.txt', 'core-test-output.txt', 'typecheck-output.txt', 'build-output.txt', 'matrix-output.txt', 'evidence-check-output.txt'];
  const required = new Set(['expected-results.json', 'actual-results.json', 'run-metadata.json', 'evidence-sha256.txt', ...rows.flatMap(row => [`inputs/${row.id}-baseline.json`, `inputs/${row.id}-candidate.json`, `artifacts/${row.id}.json`]), ...(requireCommandOutputs ? commandOutputs : [])]);
  const allowed = new Set([...required, ...(!requireCommandOutputs ? commandOutputs : [])]);
  const present = files(directory); if (present.some(path => !allowed.has(path)) || required.size > present.length || [...required].some(path => !present.includes(path)) || (requireCommandOutputs && present.length !== required.size)) fail('evidence file set is not exact');
  if (requireCommandOutputs && commandOutputs.some(path => readFileSync(join(directory, path), 'utf8').length === 0)) fail('command output is empty');
  const copied = json(join(directory, 'expected-results.json')); if (stable(copied) !== stable(expectedMatrix)) fail('expected matrix differs from repository truth');
  const actual = json(join(directory, 'actual-results.json')); if (!Array.isArray(actual) || actual.length !== rows.length) fail('actual result rows are wrong');
  for (const [rowIndex, row] of rows.entries()) {
    const baseline = json(join(directory, `inputs/${row.id}-baseline.json`)); const candidate = json(join(directory, `inputs/${row.id}-candidate.json`));
    if (stable(baseline) !== stable(sessionFor(row, 0)) || stable(candidate) !== stable(sessionFor(row, 1))) fail(`${row.id} raw input differs from controlled facts`);
    const artifact = json(join(directory, `artifacts/${row.id}.json`)); validateArtifactShape(artifact, `${row.id} artifact`);
    const expected = recompute(row, baseline, candidate);
    if (stable(artifact) !== stable(expected) || stable(actual[rowIndex]) !== stable(expected)) fail(`${row.id} artifact mismatch`);
    if (row.status !== expected.status || row.reason !== (expected.incomparableReasons[0] ?? null) || stable(row.measureIds) !== stable(expected.measures.map(item => item.id)) || stable(row.deltas) !== stable(expected.measures.map(item => item.delta))) fail(`${row.id} expected result metadata mismatch`);
    if (artifact.improvementEstablished !== false || artifact.pairingMethod !== 'user-selected') fail(`${row.id} claim boundary is wrong`);
  }
  const variants = rows.filter(row => row.variant).map(row => json(join(directory, `artifacts/${row.id}.json`)).measures);
  if (!variants.every(value => stable(value) === stable(variants[0]))) fail('irrelevant variants differ');
  const mismatch = json(join(directory, 'artifacts/finding-type-mismatch.json')); if (mismatch.status !== 'incomparable' || stable(mismatch.incomparableReasons) !== stable(['finding-type-mismatch']) || mismatch.measures.length) fail('mismatch row is not fail closed');
  const runMetadata = json(join(directory, 'run-metadata.json'));
  exactKeys(runMetadata, ['gitCommit', 'initialStatus', 'finalStatus', 'bundleSha256', 'nodeVersion', 'command'], 'run metadata');
  const currentStatus = execFileSync('git', ['status', '--short'], { encoding: 'utf8' });
  if (!/^[0-9a-f]{40}$/.test(runMetadata.gitCommit) || !/^[0-9a-f]{64}$/.test(runMetadata.bundleSha256) || typeof runMetadata.nodeVersion !== 'string' || runMetadata.nodeVersion.length === 0 || runMetadata.command !== 'pnpm --filter dogfood run probe:session-comparison' || runMetadata.initialStatus !== currentStatus || runMetadata.finalStatus !== currentStatus) fail('run metadata is incomplete');
  if (runMetadata.gitCommit !== execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()) fail('Git commit changed');
  if (runMetadata.bundleSha256 !== sha(readFileSync(new URL('../core/dist/index.js', import.meta.url)))) fail('bundle hash changed');
  const manifest = readFileSync(join(directory, 'evidence-sha256.txt'), 'utf8').trim().split('\n'); const expectedManifest = present.filter(path => path.endsWith('.json')).sort().map(path => `${sha(readFileSync(join(directory, path)))}  ${path}`);
  if (stable(manifest) !== stable(expectedManifest)) fail('hash manifest mismatch');
  return true;
}
