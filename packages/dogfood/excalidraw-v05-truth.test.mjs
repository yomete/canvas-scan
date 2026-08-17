import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvidence, checkEvidence, summarizeExplanation } from './excalidraw-v05-truth.mjs';
import { expectedMatrix, sessionFor } from './session-comparison-fixture.mjs';
import { recompute } from './session-comparison-truth.mjs';

const dropCounts = () => ({ durationStops: 0, selectedCanvasRejections: 0, activeWindows: 0, commandEntries: 0, commandArguments: 0, valueTokens: 0, stackSamples: 0, stackFrames: 0, sourceMapLookups: 0, sourceMapResponses: 0 });
const diagnostics = () => ({ warnings: 0, consoleErrors: 0, pageErrors: 0, failedRequests: 0, serverErrors: 0 });
function fixture() {
  const row = expectedMatrix.rows.find(value => value.id === 'repeated-work');
  const baseline = structuredClone(sessionFor(row, 0)); const candidate = structuredClone(sessionFor(row, 1));
  baseline.canvases[0].nearestReactOwner = 'StaticCanvas'; candidate.canvases[0].nearestReactOwner = 'StaticCanvas';
  const explanation = {
    schemaVersion: 1, explanationId: 'explanation', startedAt: baseline.endedAt, endedAt: candidate.endedAt, durationMs: 1, stopReason: 'manual', canvasScanVersion: '0.5.0',
    source: { sessionId: baseline.sessionId, findingIndex: 0, findingType: 'repeated-draw-work', canvasId: baseline.findings[0].canvasId }, followUp: { sessionId: 'follow-up', canvasId: baseline.findings[0].canvasId },
    windows: [], comparisons: [{ referenceWindowIndex: 1, targetWindowIndex: 2, status: 'unknown', difference: null, unknownReason: 'sampling-gap' }], firstDifference: null,
    stacks: [{ windowIndex: 2, commandOrdinal: 0, reason: 'first-raster', frames: [{ functionName: 'privateFunction', generated: { file: 'http://127.0.0.1/app.js?private-query#fragment', line: 1, column: 2 }, mapped: null, mappingStatus: 'unresolved', unresolvedReason: 'no-source-map' }], droppedFrameCount: 0 }],
    collectionLimits: {}, droppedEntryCounts: dropCounts(), limitResults: [], callsiteCoverage: { status: 'complete', incompleteReasons: [] }, firstGap: { windowIndex: 2, commandOrdinal: 0, reason: 'sampling-gap' },
  };
  const comparison = recompute({ baselineFindingIndex: 0, candidateFindingIndex: 0 }, baseline, candidate);
  const raw = { baseline, candidate, explanation, comparison, diagnostics: diagnostics() };
  const identity = { gitSha: 'a'.repeat(40), iifeSha256: 'b'.repeat(64), packageSha256: 'c'.repeat(64), harnessSha256: 'd'.repeat(64), chromeRevision: '151.0.7922.137', v04ReferenceSha256: 'e'.repeat(64) };
  const evidence = createEvidence({ baseline, baselineFindingIndex: 0, candidate, candidateFindingIndex: 0, explanation, comparison, diagnostics: raw.diagnostics, instrumentation: { scanLoaded: true }, identity });
  return { evidence, raw, identity };
}

test('binds summaries to the raw sessions, explanation, comparison, and diagnostics', () => { const value = fixture(); assert.deepEqual(checkEvidence(value.evidence, value.raw, value.identity), []); });

test('derives command and map status from product fields', () => {
  const value = fixture();
  value.raw.explanation.comparisons[0] = { referenceWindowIndex: 1, targetWindowIndex: 2, status: 'changed', difference: { referenceWindowIndex: 1, targetWindowIndex: 2, ordinal: 0, reason: 'argument-token', reference: null, target: null }, unknownReason: null };
  value.raw.explanation.firstDifference = value.raw.explanation.comparisons[0].difference;
  value.raw.explanation.stacks[0].frames[0] = { functionName: 'privateFunction', generated: { file: 'generated.js', line: 1, column: 1 }, mapped: { file: 'source.ts?private-query#fragment', line: 3, column: 4 }, mappingStatus: 'mapped', unresolvedReason: null };
  const summary = summarizeExplanation(value.raw.explanation);
  assert.equal(summary.status, 'changed'); assert.equal(summary.mappingStatus, 'mapped'); assert.deepEqual(summary.mapped, { file: 'source.ts', line: 3, column: 4 }); assert.equal(JSON.stringify(summary).includes('privateFunction'), false);
});

test('rejects every raw-binding mutation', () => {
  for (const [index, mutate] of [
    value => { value.raw.baseline.findings[0].canvasId = 'other'; },
    value => { value.raw.explanation.source.findingIndex = 1; },
    value => { value.raw.comparison.measures[0].delta = 999; },
    value => { value.raw.diagnostics.warnings = 1; },
    value => { value.evidence.explanation.status = 'same'; },
    value => { value.evidence.dropCounts.commandEntries = 1; },
  ].entries()) { const value = fixture(); mutate(value); assert.notDeepEqual(checkEvidence(value.evidence, value.raw, value.identity), [], `raw binding mutation ${index}`); }
});

test('rejects extra nested fields, arbitrary reasons, dishonest maps, and stale identity', () => {
  for (const mutate of [
    value => { value.evidence.explanation.extra = true; },
    value => { value.raw.explanation.comparisons[0].unknownReason = 'arbitrary'; },
    value => { value.raw.explanation.stacks[0].frames[0].unresolvedReason = 'arbitrary'; },
    value => { value.raw.explanation.stacks[0].frames[0].mappingStatus = 'mapped'; },
    value => { value.evidence.gitSha = 'f'.repeat(40); },
  ]) { const value = fixture(); mutate(value); assert.notDeepEqual(checkEvidence(value.evidence, value.raw, value.identity), []); }
});

test('rejects false product claims and nonzero diagnostics', () => {
  for (const mutate of [value => { value.evidence.improvementEstablished = true; }, value => { value.evidence.report.claim = 'improved'; }, value => { value.evidence.diagnostics.pageErrors = 1; value.raw.diagnostics.pageErrors = 1; }]) { const value = fixture(); mutate(value); assert.notDeepEqual(checkEvidence(value.evidence, value.raw, value.identity), []); }
});
