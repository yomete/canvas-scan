import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recompute } from './session-comparison-truth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const EXCALIDRAW_REVISION = '219571a7187651c79648de08c9a98a3b2f7f607a';
export const EXTERNAL_COMMANDS = [
  'git clone --no-checkout https://github.com/excalidraw/excalidraw.git <repo>',
  `git -C <repo> fetch --depth 1 origin ${EXCALIDRAW_REVISION}`,
  `git -C <repo> checkout --detach ${EXCALIDRAW_REVISION}`,
  'yarn install --frozen-lockfile --ignore-scripts --network-timeout 600000',
  'yarn --cwd excalidraw-app vite --host 127.0.0.1 --port 4385 --strictPort',
];
export const INTERACTION_FACTS = {
  baseline: ['start-recording', 'draw-rectangle', 'draw-rectangle', 'pan', 'stop-recording'],
  explanation: ['start-selected-explanation', 'pan', 'stop-explanation'],
  candidate: ['start-recording', 'draw-rectangle', 'draw-rectangle', 'pan', 'stop-recording'],
  selection: { findingType: 'repeated-draw-work', owner: 'StaticCanvas' },
};
const rawArtifacts = ['baseline.json', 'candidate.json', 'explanation.json', 'comparison.json', 'diagnostics.json', 'screenshot.png'];
const allowedFiles = [...rawArtifacts, 'evidence.json', 'manifest-sha256.txt'].sort();
const evidenceKeys = ['schemaVersion', 'excalidrawRevision', 'gitSha', 'iifeSha256', 'packageSha256', 'harnessSha256', 'chromeRevision', 'v04ReferenceSha256', 'commands', 'interaction', 'instrumentation', 'baseline', 'candidate', 'comparison', 'explanation', 'diagnostics', 'dropCounts', 'improvementEstablished', 'report', 'rawArtifacts'];
const findingKeys = ['type', 'owner', 'findingIndex', 'canvasId', 'sessionId'];
const comparisonKeys = ['baselineFindingIndex', 'candidateFindingIndex', 'status', 'raw'];
const explanationKeys = ['status', 'unknownReason', 'firstGap', 'firstDifference', 'mappingStatus', 'unresolvedReason', 'mapped', 'raw'];
const explanationArtifactKeys = ['schemaVersion', 'explanationId', 'startedAt', 'endedAt', 'durationMs', 'stopReason', 'canvasScanVersion', 'source', 'followUp', 'windows', 'comparisons', 'firstDifference', 'stacks', 'collectionLimits', 'droppedEntryCounts', 'limitResults', 'callsiteCoverage', 'firstGap'];
const dropKeys = ['durationStops', 'selectedCanvasRejections', 'activeWindows', 'commandEntries', 'commandArguments', 'valueTokens', 'stackSamples', 'stackFrames', 'sourceMapLookups', 'sourceMapResponses'];
const diagnosticKeys = ['warnings', 'consoleErrors', 'pageErrors', 'failedRequests', 'serverErrors'];
const unknownReasons = new Set(['unsupported-value', 'argument-limit', 'value-token-limit', 'command-limit', 'window-limit', 'sampling-gap', 'missing-reference', 'instrumentation-disabled']);
const differenceReasons = new Set(['operation-kind', 'operation-name', 'argument-count', 'argument-kind', 'argument-token', 'command-added', 'command-removed']);
const unresolvedReasons = new Set(['no-source-map', 'cross-origin-source-map', 'source-map-lookup-limit', 'source-map-too-large', 'source-map-load-failed', 'source-map-parse-failed', 'mapping-missing']);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const stable = value => JSON.stringify(value);
const integer = value => Number.isInteger(value) && value >= 0;
const location = value => exactKeys(value, ['file', 'line', 'column']) && typeof value.file === 'string' && value.file.length > 0 && integer(value.line) && integer(value.column);
const publicLocation = value => ({ file: value.file.split(/[?#]/, 1)[0], line: value.line, column: value.column });
const installedChromeRevision = () => execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--version'], { encoding: 'utf8' }).match(/\d+\.\d+\.\d+\.\d+/)?.[0] ?? null;

function selectedSummary(session, findingIndex) {
  const finding = session?.findings?.[findingIndex];
  const canvases = session?.canvases?.filter(value => value?.canvasId === finding?.canvasId) ?? [];
  if (finding?.type !== 'repeated-draw-work' || canvases.length !== 1 || canvases[0].nearestReactOwner !== 'StaticCanvas') throw new Error('explicit StaticCanvas repeated finding required');
  return { type: finding.type, owner: canvases[0].nearestReactOwner, findingIndex, canvasId: finding.canvasId, sessionId: session.sessionId };
}

function differenceSummary(value) {
  if (value === null) return null;
  if (!exactKeys(value, ['referenceWindowIndex', 'targetWindowIndex', 'ordinal', 'reason', 'reference', 'target']) || !integer(value.referenceWindowIndex) || !integer(value.targetWindowIndex) || !integer(value.ordinal) || !differenceReasons.has(value.reason)) throw new Error('invalid first difference');
  return { referenceWindowIndex: value.referenceWindowIndex, targetWindowIndex: value.targetWindowIndex, ordinal: value.ordinal, reason: value.reason };
}

function gapSummary(value) {
  if (value === null) return null;
  if (!exactKeys(value, ['windowIndex', 'commandOrdinal', 'reason']) || !integer(value.windowIndex) || (value.commandOrdinal !== null && !integer(value.commandOrdinal)) || !unknownReasons.has(value.reason)) throw new Error('invalid first gap');
  return { ...value };
}

export function summarizeExplanation(artifact) {
  if (!exactKeys(artifact, explanationArtifactKeys) || artifact.schemaVersion !== 1 || !Array.isArray(artifact.comparisons) || !Array.isArray(artifact.stacks) || !exactKeys(artifact.droppedEntryCounts, dropKeys)) throw new Error('invalid explanation artifact');
  const comparisons = artifact.comparisons;
  for (const item of comparisons) if (!exactKeys(item, ['referenceWindowIndex', 'targetWindowIndex', 'status', 'difference', 'unknownReason']) || !['same', 'changed', 'unknown'].includes(item.status) || (item.unknownReason !== null && !unknownReasons.has(item.unknownReason))) throw new Error('invalid explanation comparison');
  const status = comparisons.some(item => item.status === 'unknown') ? 'unknown' : comparisons.some(item => item.status === 'changed') ? 'changed' : comparisons.length ? 'same' : 'unknown';
  const firstGap = gapSummary(artifact.firstGap);
  const unknownReason = status === 'unknown' ? comparisons.find(item => item.status === 'unknown')?.unknownReason ?? firstGap?.reason ?? 'missing-reference' : null;
  const frames = artifact.stacks.flatMap(sample => Array.isArray(sample?.frames) ? sample.frames : []);
  for (const frame of frames) {
    if (!exactKeys(frame, ['functionName', 'generated', 'mapped', 'mappingStatus', 'unresolvedReason']) || !['mapped', 'unresolved'].includes(frame.mappingStatus) || (frame.mapped !== null && !location(frame.mapped)) || (frame.unresolvedReason !== null && !unresolvedReasons.has(frame.unresolvedReason))) throw new Error('invalid explanation stack frame');
    if (frame.mappingStatus === 'mapped' && (!frame.mapped || frame.unresolvedReason !== null)) throw new Error('dishonest mapped frame');
    if (frame.mappingStatus === 'unresolved' && frame.mapped !== null) throw new Error('dishonest unresolved frame');
  }
  const mappedFrame = frames.find(frame => frame.mappingStatus === 'mapped');
  const unresolvedFrame = frames.find(frame => frame.mappingStatus === 'unresolved' && frame.unresolvedReason);
  const mappingStatus = mappedFrame ? 'mapped' : frames.length ? 'unresolved' : 'not-sampled';
  return {
    status,
    unknownReason,
    firstGap,
    firstDifference: differenceSummary(artifact.firstDifference),
    mappingStatus,
    unresolvedReason: mappingStatus === 'unresolved' ? unresolvedFrame?.unresolvedReason ?? 'mapping-missing' : null,
    mapped: mappedFrame ? publicLocation(mappedFrame.mapped) : null,
    raw: 'explanation.json',
  };
}

export function createEvidence({ baseline, baselineFindingIndex, candidate, candidateFindingIndex, explanation, comparison, diagnostics, instrumentation, identity }) {
  const pair = { baselineFindingIndex, candidateFindingIndex };
  return {
    schemaVersion: 1,
    excalidrawRevision: EXCALIDRAW_REVISION,
    ...identity,
    commands: [...EXTERNAL_COMMANDS],
    interaction: structuredClone(INTERACTION_FACTS),
    instrumentation: { ...instrumentation },
    baseline: selectedSummary(baseline, baselineFindingIndex),
    candidate: selectedSummary(candidate, candidateFindingIndex),
    comparison: { ...pair, status: comparison.status, raw: 'comparison.json' },
    explanation: summarizeExplanation(explanation),
    diagnostics: { ...diagnostics },
    dropCounts: { ...explanation.droppedEntryCounts },
    improvementEstablished: false,
    report: { claim: 'measured-pair-only' },
    rawArtifacts: [...rawArtifacts],
  };
}

export function checkEvidence(value, raw, expected = {}) {
  const failures = [];
  const fail = reason => failures.push(reason);
  if (!exactKeys(value, evidenceKeys)) return ['schema keys changed'];
  if (value.schemaVersion !== 1 || value.excalidrawRevision !== EXCALIDRAW_REVISION) fail('revision or schema changed');
  if (!/^[0-9a-f]{40}$/.test(value.gitSha ?? '') || ![value.iifeSha256, value.packageSha256, value.harnessSha256, value.v04ReferenceSha256].every(item => /^[0-9a-f]{64}$/.test(item ?? '')) || !/^\d+\.\d+\.\d+\.\d+$/.test(value.chromeRevision ?? '')) fail('identity shape changed');
  for (const [key, expectedValue] of Object.entries(expected)) if (value[key] !== expectedValue) fail(`${key} changed`);
  if (stable(value.commands) !== stable(EXTERNAL_COMMANDS) || stable(value.interaction) !== stable(INTERACTION_FACTS)) fail('command or interaction facts changed');
  if (!exactKeys(value.instrumentation, ['scanLoaded']) || value.instrumentation.scanLoaded !== true) fail('early instrumentation changed');
  if (!exactKeys(value.baseline, findingKeys) || !exactKeys(value.candidate, findingKeys) || !exactKeys(value.comparison, comparisonKeys) || !exactKeys(value.explanation, explanationKeys)) fail('nested evidence schema changed');
  if (!exactKeys(value.diagnostics, diagnosticKeys) || Object.values(value.diagnostics ?? {}).some(item => !integer(item) || item !== 0)) fail('diagnostics changed');
  if (!exactKeys(value.dropCounts, dropKeys) || Object.values(value.dropCounts ?? {}).some(item => !integer(item))) fail('drop counts changed');
  if (value.improvementEstablished !== false || !exactKeys(value.report, ['claim']) || value.report.claim !== 'measured-pair-only') fail('unsupported product claim');
  if (stable(value.rawArtifacts) !== stable(rawArtifacts)) fail('raw artifacts changed');
  try {
    if (!raw) throw new Error('raw artifacts missing');
    const baselineSummary = selectedSummary(raw.baseline, value.baseline.findingIndex);
    const candidateSummary = selectedSummary(raw.candidate, value.candidate.findingIndex);
    if (stable(value.baseline) !== stable(baselineSummary) || stable(value.candidate) !== stable(candidateSummary)) throw new Error('finding summaries changed');
    if (raw.explanation?.source?.sessionId !== raw.baseline.sessionId || raw.explanation?.source?.findingIndex !== value.baseline.findingIndex || raw.explanation?.source?.canvasId !== value.baseline.canvasId) throw new Error('explanation selection changed');
    const expectedExplanation = summarizeExplanation(raw.explanation);
    if (stable(value.explanation) !== stable(expectedExplanation) || stable(value.dropCounts) !== stable(raw.explanation.droppedEntryCounts)) throw new Error('explanation summary changed');
    const pair = { baselineFindingIndex: value.baseline.findingIndex, candidateFindingIndex: value.candidate.findingIndex };
    const expectedComparison = recompute(pair, raw.baseline, raw.candidate);
    if (stable(raw.comparison) !== stable(expectedComparison) || value.comparison.status !== expectedComparison.status || value.comparison.baselineFindingIndex !== pair.baselineFindingIndex || value.comparison.candidateFindingIndex !== pair.candidateFindingIndex) throw new Error('comparison changed');
    if (stable(raw.diagnostics) !== stable(value.diagnostics)) throw new Error('diagnostics summary changed');
  } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
  return failures;
}

export function checkDirectory(directory) {
  const files = readdirSync(directory).sort();
  if (stable(files) !== stable(allowedFiles)) throw new Error('external evidence files changed');
  for (const file of files) { const info = lstatSync(path.join(directory, file)); if (!info.isFile() || info.isSymbolicLink()) throw new Error('unsafe external evidence file'); }
  const readJson = file => JSON.parse(readFileSync(path.join(directory, file), 'utf8'));
  const evidence = readJson('evidence.json');
  const raw = { baseline: readJson('baseline.json'), candidate: readJson('candidate.json'), explanation: readJson('explanation.json'), comparison: readJson('comparison.json'), diagnostics: readJson('diagnostics.json') };
  const rows = readFileSync(path.join(directory, 'manifest-sha256.txt'), 'utf8').trim().split('\n').filter(Boolean);
  const covered = files.filter(file => file !== 'manifest-sha256.txt');
  const expectedRows = covered.map(file => `${sha256(readFileSync(path.join(directory, file)))}  ${file}`);
  if (stable(rows) !== stable(expectedRows)) throw new Error('external evidence hash manifest changed');
  const expected = {
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    iifeSha256: sha256(readFileSync(path.join(root, 'packages/core/dist/canvas-scan.iife.js'))),
    packageSha256: sha256(readFileSync(path.join(root, 'packages/core/package.json'))),
    harnessSha256: sha256(readFileSync(path.join(root, 'packages/dogfood/excalidraw-v05.mjs'))),
    chromeRevision: installedChromeRevision(),
    v04ReferenceSha256: sha256(readFileSync(path.join(root, 'packages/dogfood/results/2026-08-07-excalidraw-v04-post-release.json'))),
  };
  const failures = checkEvidence(evidence, raw, expected);
  if (failures.length) throw new Error(failures.join('; '));
  return true;
}

if (process.argv[2] === '--check-evidence') { checkDirectory(process.argv[3]); console.log('EXCALIDRAW_V05_EVIDENCE: PASS'); }
