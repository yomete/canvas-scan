import { afterEach, describe, expect, it } from 'vitest';
import { compareSessions } from '../src/comparison';
import { emitReport, getCurrentWindowIndex } from '../src/frame-loop';
import { getLastExplanation, getLastSession, getRecordingState, resetRecordingForTests, startExplanation, startRecording, stopExplanation, stopRecording } from '../src/recording';
import type { CanvasMethodEvidence, DrawBatchReport, InvestigationSessionV1 } from '../src/types';
import { records, type CanvasRecord } from '../src/wrap-context';

function session(type: InvestigationSessionV1['findings'][number]['type'], candidate = false): InvestigationSessionV1 {
  const canvasId = candidate ? 'candidate' : 'baseline';
  const methods: Record<string, CanvasMethodEvidence> = candidate ? { fillRect: { count: 10, canvasApiSelfTimeMs: 3 }, lineTo: { count: 4, canvasApiSelfTimeMs: null }, stroke: { count: 4, canvasApiSelfTimeMs: 1.25 } } : { fillRect: { count: 12, canvasApiSelfTimeMs: 4 }, stroke: { count: 8, canvasApiSelfTimeMs: 2.5 } };
  const common = { evidenceLevel: 'candidate' as const, canvasId, claimBoundary: { observation: '', explanation: '', nonEstablishedFacts: '' }, nextCheck: '' };
  const finding = type === 'heavy-canvas-work' ? { ...common, type, episodeId: 'episode', rasterOperationCount: candidate ? 12 : 18, canvasApiSelfTimeMs: candidate ? 4 : 6, topMethods: Object.entries(methods).map(([method, value]) => ({ method, ...value })), maximumWindow: { windowIndex: 0, timestampMs: 0, rasterOperationCount: 1, canvasApiSelfTimeMs: 1, methodEvidence: methods } }
    : type === 'repeated-draw-work' ? { ...common, type, episodeId: 'episode', repeatedWindowCount: candidate ? 2 : 3, rasterOperationCount: candidate ? 6 : 12, canvasApiSelfTimeMs: 1, repeatedWindows: (candidate ? [1, 2] : [1, 3, 2]).map((comparisonGap, windowIndex) => ({ windowIndex, timestampMs: windowIndex, rasterOperationCount: 1, canvasApiSelfTimeMs: 1, comparisonGap })), unknownCoverage: { unknownWindowCount: candidate ? 1 : 2, activeWindowCount: candidate ? 4 : 5 } }
      : type === 'resize-churn' ? { ...common, type, observedResetCount: candidate ? 3 : 5, activeResetCount: candidate ? 2 : 4, resetEvents: Array.from({ length: candidate ? 2 : 4 }, (_, windowIndex) => ({ source: 'width-setter' as const, width: 1, height: 1, windowIndex, timestampMs: windowIndex })), affectedEpisodeIds: candidate ? ['episode'] : ['episode', 'episode-two'], commandStatuses: candidate ? { same: 1, changed: 0, unknown: 1 } : { same: 1, changed: 1, unknown: 2 }, unknownReasons: {}, canvasApiSelfTimeMs: 1, rasterOperationCount: 1 }
        : { ...common, type, affectedWindowCount: candidate ? 2 : 3, affectedWindows: (candidate ? [2, 2.1] : [2, 2.5, 2.25]).map((actualToExpectedAreaRatio, windowIndex) => ({ windowIndex, timestampMs: windowIndex, rasterOperationCount: 1, canvasApiSelfTimeMs: 1, backingWidth: 1, backingHeight: 1, expectedBackingWidth: 1, expectedBackingHeight: 1, expectedPixelArea: 1, actualToExpectedAreaRatio })), affectedEpisodeIds: ['episode'], rasterOperationCount: 1, canvasApiSelfTimeMs: 1 };
  const activeWindowCount = candidate ? 4 : 5;
  return { schemaVersion: 1, sessionId: candidate ? 'candidate session' : 'baseline/session', startedAt: '2026-08-11T10:00:00.000Z', endedAt: candidate ? '2026-08-11T10:01:00.000Z' : '2026-08-11T10:00:30.000Z', durationMs: 1, stopReason: 'manual', canvasScanVersion: '0.4.0', browserFeatures: { monotonicTime: true, eventTiming: false, longAnimationFrames: false }, canvases: [{ canvasId, nearestReactOwner: null, attributionKind: 'unattributed', sourceLocation: null, activeWindowCount, rasterOperationCount: candidate ? 14 : 20, canvasApiSelfTimeMs: candidate ? 4.25 : 6.5, maxWindowSelfTimeMs: candidate ? 1.5 : 2, evidenceLevel: 'measured', methodEvidence: methods, commandStatuses: candidate ? { same: 2, changed: 1, unknown: 1 } : { same: 2, changed: 1, unknown: 2 } }], windows: [], resetEvents: [], lifecycleEvents: [], episodes: [], browserEntries: [], episodeAssociations: [], findings: [finding], collectionLimits: {} as InvestigationSessionV1['collectionLimits'], droppedEntryCounts: { canvasWindowReports: 0, canvasLifetimes: 0, resetEvents: 0, lifecycleEvents: 0, documentEvents: 0, eventTiming: 0, userMarks: 0, longAnimationFrames: 0 } };
}

const report = (canvasId: string): DrawBatchReport => ({ canvasId, nearestReactOwner: null, attributionKind: 'unattributed', sourceLocation: null, rasterOperationCount: 2, canvasApiSelfTimeMs: 1, signatureStatus: 'same', unknownReason: null, sampled: false, comparisonGap: 1, methodEvidence: {} });
const canvasRecord = (id: string): CanvasRecord => ({
  canvas: {}, contentDirty: false, contentSig: { hash: 0, unknown: false, opCount: 0, unknownReason: null }, contentVersion: 0,
  id, serial: 1, sig: { hash: 0, unknown: false, opCount: 0, unknownReason: null }, rasterOps: 0, selfTimeMs: 0,
  activeInWindow: false, prev: null, attribution: { nearestReactOwner: null, attributionKind: 'unattributed' }, lastStatus: null, props: new Map(),
  matrix: [1, 0, 0, 1, 0, 0], matrixUnknown: false, matrixHash: 0, pathHash: 0, pathUnknown: false, clipHash: 0,
  clipUnknown: false, resetPendingReason: null, modelUntrusted: false, resetVersion: 0, continuityLost: false, sourceResetVersions: new Map(),
  attributeObservationUnavailable: false, contextActivityInWindow: false, exactResetDepth: 0, inactiveBoundaries: 0, retired: false,
  lastConnected: false, activeLifecycleRecorded: false, pendingLifecycleEvents: [], stateStack: [],
});
function completeSource(canvasId = 'comparison-source') {
  startRecording();
  emitReport(report(canvasId), {}, { windowIndex: getCurrentWindowIndex() + 1, timestampMs: 1 });
  emitReport(report(canvasId), {}, { windowIndex: getCurrentWindowIndex() + 2, timestampMs: 2 });
  return stopRecording()!;
}

afterEach(() => { resetRecordingForTests(); records.clear(); });

describe('compareSessions', () => {
  it('returns the exact version 1 public artifact and sorted method union for heavy work', () => {
    const artifact = compareSessions(session('heavy-canvas-work'), session('heavy-canvas-work', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 });
    expect(Object.keys(artifact)).toEqual(['schemaVersion', 'comparisonId', 'createdAt', 'canvasScanVersion', 'pairingMethod', 'baseline', 'candidate', 'status', 'incomparableReasons', 'measures', 'improvementEstablished']);
    expect(artifact.measures.map(item => item.id)).toEqual(['active-window-count', 'raster-operation-count', 'canvas-api-self-time-ms', 'maximum-window-self-time-ms', 'method:fillRect:operation-count', 'method:fillRect:self-time-ms', 'method:lineTo:operation-count', 'method:lineTo:self-time-ms', 'method:stroke:operation-count', 'method:stroke:self-time-ms', 'unknown-command-window-count', 'heavy-episode-operation-count', 'heavy-episode-self-time-ms']);
    expect(artifact.measures.find(item => item.id === 'method:lineTo:self-time-ms')).toMatchObject({ baseline: 0, candidate: null, delta: null, direction: 'unknown' });
    expect(artifact.improvementEstablished).toBe(false);
  });

  it.each(['repeated-draw-work', 'resize-churn', 'backing-store-mismatch'] as const)('returns comparable %s evidence', type => {
    const artifact = compareSessions(session(type), session(type, true), { baselineFindingIndex: 0, candidateFindingIndex: 0 });
    expect(artifact.status).toBe('comparable');
    expect(artifact.measures.every(item => item.unit === 'ms' ? item.interpretation === 'observed-timing-pair' : item.interpretation === 'structural')).toBe(true);
  });

  it('uses explicit pairing and exact reason precedence without retaining input references', () => {
    const baseline = session('heavy-canvas-work'); const candidate = session('repeated-draw-work', true);
    expect(compareSessions({ ...baseline, schemaVersion: 2 } as never, candidate, { baselineFindingIndex: -1, candidateFindingIndex: 9 }).incomparableReasons).toEqual(['unsupported-schema']);
    expect(compareSessions(baseline, candidate, { baselineFindingIndex: 9, candidateFindingIndex: 0 }).incomparableReasons).toEqual(['finding-not-found']);
    expect(compareSessions(baseline, candidate, { baselineFindingIndex: 0, candidateFindingIndex: 0 }).incomparableReasons).toEqual(['finding-type-mismatch']);
    const artifact = compareSessions(session('heavy-canvas-work'), session('heavy-canvas-work', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 });
    const before = JSON.stringify(artifact); baseline.sessionId = 'changed'; artifact.baseline.sessionId = 'changed';
    expect(JSON.stringify(artifact)).not.toBe(before); expect(compareSessions(session('heavy-canvas-work'), session('heavy-canvas-work', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 }).baseline.sessionId).toBe('baseline/session');
  });

  it.each([
    ['method evidence', (value: any) => { value.canvases[0].methodEvidence = null; }],
    ['top methods', (value: any) => { value.findings[0].topMethods = null; }],
    ['maximum window', (value: any) => { value.findings[0].maximumWindow = null; }],
    ['canvases', (value: any) => { value.canvases = null; }],
    ['findings', (value: any) => { value.findings = null; }],
    ['command statuses', (value: any) => { value.canvases[0].commandStatuses = null; }],
  ])('fails closed for malformed %s without throwing', (_, change) => {
    const baseline = session('heavy-canvas-work') as any; const candidate = session('heavy-canvas-work', true) as any;
    change(baseline);
    expect(() => compareSessions(baseline, candidate, { baselineFindingIndex: 0, candidateFindingIndex: 0 })).not.toThrow();
    expect(compareSessions(baseline, candidate, { baselineFindingIndex: 0, candidateFindingIndex: 0 })).toMatchObject({ status: 'incomparable', incomparableReasons: ['incomplete-evidence'], measures: [] });
  });

  it.each([
    ['repeated windows', (value: any) => { value.findings[0].repeatedWindows = null; }],
    ['unknown coverage', (value: any) => { value.findings[0].unknownCoverage = null; }],
    ['reset events', (value: any) => { value.findings[0].resetEvents = null; }],
    ['affected episodes', (value: any) => { value.findings[0].affectedEpisodeIds = null; }],
    ['affected windows', (value: any) => { value.findings[0].affectedWindows = null; }],
  ])('fails closed for malformed selected finding %s', (_, change) => {
    const types: any = { 'repeated windows': 'repeated-draw-work', 'unknown coverage': 'repeated-draw-work', 'reset events': 'resize-churn', 'affected episodes': 'resize-churn', 'affected windows': 'backing-store-mismatch' };
    const baseline = session(types[_]) as any; const candidate = session(types[_], true) as any;
    change(baseline);
    expect(compareSessions(baseline, candidate, { baselineFindingIndex: 0, candidateFindingIndex: 0 })).toMatchObject({ status: 'incomparable', incomparableReasons: ['incomplete-evidence'], measures: [] });
  });

  it('copies the selected evidence and stays deterministic after input and output mutation', () => {
    const baseline = session('heavy-canvas-work'); const candidate = session('heavy-canvas-work', true);
    const first = compareSessions(baseline, candidate, { baselineFindingIndex: 0, candidateFindingIndex: 0 }); const snapshot = JSON.stringify(first);
    baseline.findings[0].canvasId = 'mutated'; candidate.canvases[0].methodEvidence.fillRect.count = 999; first.measures[0].candidate = 999; first.baseline.canvasId = 'mutated';
    expect(JSON.stringify(first)).not.toBe(snapshot);
    const fresh = compareSessions(session('heavy-canvas-work'), session('heavy-canvas-work', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 });
    expect(JSON.stringify(fresh)).toBe(snapshot);
    expect(JSON.parse(snapshot)).toEqual(JSON.parse(JSON.stringify(fresh)));
  });

  it('returns the exact repeated, resize, and backing-store measures', () => {
    const repeated = compareSessions(session('repeated-draw-work'), session('repeated-draw-work', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 });
    expect(repeated.measures.slice(-4)).toEqual([
      { id: 'unknown-command-window-count', unit: 'count', baseline: 2, candidate: 1, delta: -1, direction: 'decreased', interpretation: 'structural' },
      { id: 'repeated-window-count', unit: 'count', baseline: 3, candidate: 2, delta: -1, direction: 'decreased', interpretation: 'structural' },
      { id: 'repeated-raster-operation-count', unit: 'count', baseline: 12, candidate: 6, delta: -6, direction: 'decreased', interpretation: 'structural' },
      { id: 'comparison-gap-count', unit: 'count', baseline: 3, candidate: 1, delta: -2, direction: 'decreased', interpretation: 'structural' },
    ]);
    const resize = compareSessions(session('resize-churn'), session('resize-churn', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 });
    expect(resize.measures.slice(-6)).toEqual([
      { id: 'unknown-command-window-count', unit: 'count', baseline: 2, candidate: 1, delta: -1, direction: 'decreased', interpretation: 'structural' },
      { id: 'active-reset-count', unit: 'count', baseline: 4, candidate: 2, delta: -2, direction: 'decreased', interpretation: 'structural' },
      { id: 'observed-reset-count', unit: 'count', baseline: 5, candidate: 3, delta: -2, direction: 'decreased', interpretation: 'structural' },
      { id: 'affected-episode-count', unit: 'count', baseline: 2, candidate: 1, delta: -1, direction: 'decreased', interpretation: 'structural' },
      { id: 'same-command-window-count', unit: 'count', baseline: 1, candidate: 1, delta: 0, direction: 'unchanged', interpretation: 'structural' },
      { id: 'changed-command-window-count', unit: 'count', baseline: 1, candidate: 0, delta: -1, direction: 'decreased', interpretation: 'structural' },
    ]);
    const backing = compareSessions(session('backing-store-mismatch'), session('backing-store-mismatch', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 });
    expect(backing.measures.slice(-3)).toEqual([
      { id: 'unknown-command-window-count', unit: 'count', baseline: 2, candidate: 1, delta: -1, direction: 'decreased', interpretation: 'structural' },
      { id: 'affected-backing-window-count', unit: 'count', baseline: 3, candidate: 2, delta: -1, direction: 'decreased', interpretation: 'structural' },
      { id: 'maximum-backing-area-ratio', unit: 'ratio', baseline: 2.5, candidate: 2.1, delta: -0.4, direction: 'decreased', interpretation: 'structural' },
    ]);
  });

  it('covers increased, decreased, unchanged, and unknown directions', () => {
    const artifact = compareSessions(session('heavy-canvas-work'), session('heavy-canvas-work', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 });
    expect(artifact.measures.find(value => value.id === 'method:lineTo:operation-count')?.direction).toBe('increased');
    expect(artifact.measures.find(value => value.id === 'active-window-count')?.direction).toBe('decreased');
    expect(compareSessions(session('resize-churn'), session('resize-churn', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 }).measures.find(value => value.id === 'same-command-window-count')?.direction).toBe('unchanged');
    expect(artifact.measures.find(value => value.id === 'method:lineTo:self-time-ms')?.direction).toBe('unknown');
  });

  it('fails closed for required drops and ignores unrelated collection drops', () => {
    for (const key of ['canvasWindowReports', 'canvasLifetimes'] as const) {
      const baseline = session('heavy-canvas-work'); baseline.droppedEntryCounts[key] = 1;
      expect(compareSessions(baseline, session('heavy-canvas-work', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 }).incomparableReasons).toEqual(['incomplete-evidence']);
    }
    const resize = session('resize-churn'); resize.droppedEntryCounts.resetEvents = 1;
    expect(compareSessions(resize, session('resize-churn', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 }).incomparableReasons).toEqual(['incomplete-evidence']);
    const ignored = session('heavy-canvas-work'); Object.assign(ignored.droppedEntryCounts, { resetEvents: 2, lifecycleEvents: 1, documentEvents: 1, eventTiming: 1, userMarks: 1, longAnimationFrames: 1 });
    expect(compareSessions(ignored, session('heavy-canvas-work', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 }).status).toBe('comparable');
  });

  it('uses only the explicit indexes and never auto-matches a nearby finding', () => {
    const baseline = session('heavy-canvas-work'); const candidate = session('repeated-draw-work', true);
    candidate.findings.push(session('heavy-canvas-work', true).findings[0]);
    expect(compareSessions(baseline, candidate, { baselineFindingIndex: 0, candidateFindingIndex: 0 }).incomparableReasons).toEqual(['finding-type-mismatch']);
    expect(compareSessions(baseline, candidate, { baselineFindingIndex: 0, candidateFindingIndex: 1 }).status).toBe('comparable');
  });

  it('keeps structural results invariant across identities, order, metadata, and unrelated work', () => {
    const baseline = session('repeated-draw-work'); const candidate = session('repeated-draw-work', true);
    const expected = compareSessions(baseline, candidate, { baselineFindingIndex: 0, candidateFindingIndex: 0 }).measures;
    const identities = [structuredClone(baseline), structuredClone(candidate)];
    identities.forEach((value, side) => { const id = `other-${side}`; value.sessionId = id; value.canvases[0].canvasId = `${id}-canvas`; value.findings[0].canvasId = `${id}-canvas`; (value.findings[0] as { episodeId: string }).episodeId = `${id}-episode`; value.canvases[0].nearestReactOwner = 'OtherOwner'; value.canvases[0].sourceLocation = { file: 'other.ts', line: 9, column: 2 }; });
    expect(compareSessions(identities[0], identities[1], { baselineFindingIndex: 0, candidateFindingIndex: 0 }).measures).toEqual(expected);
    const ordered = identities.map(value => structuredClone(value));
    ordered.forEach((value, side) => { value.canvases.unshift(session('heavy-canvas-work', side === 1).canvases[0]); value.findings.unshift(session('heavy-canvas-work', side === 1).findings[0]); value.windows.push({ unrelated: true } as never); });
    expect(compareSessions(ordered[0], ordered[1], { baselineFindingIndex: 1, candidateFindingIndex: 1 }).measures).toEqual(expected);
  });

  it('does not share mutable references with either input or later results', () => {
    const baseline = session('heavy-canvas-work'); const candidate = session('heavy-canvas-work', true);
    const baselineSnapshot = structuredClone(baseline); const candidateSnapshot = structuredClone(candidate);
    const artifact = compareSessions(baseline, candidate, { baselineFindingIndex: 0, candidateFindingIndex: 0 }); const artifactSnapshot = structuredClone(artifact);
    baseline.findings[0].canvasId = 'input-change'; candidate.canvases[0].methodEvidence.fillRect.count = 999;
    expect(artifact).toEqual(artifactSnapshot);
    artifact.baseline.canvasId = 'output-change'; artifact.measures[0].candidate = 999;
    expect(baseline).not.toEqual(baselineSnapshot); expect(candidate).not.toEqual(candidateSnapshot);
    expect(compareSessions(baselineSnapshot, candidateSnapshot, { baselineFindingIndex: 0, candidateFindingIndex: 0 })).toEqual(artifactSnapshot);
    expect(baselineSnapshot.findings[0].canvasId).toBe('baseline'); expect(candidateSnapshot.canvases[0].methodEvidence.fillRect.count).toBe(10);
  });

  it('accepts valid ISO timestamps with offsets and keeps deterministic metadata', () => {
    const baseline = session('heavy-canvas-work'); const candidate = session('heavy-canvas-work', true);
    baseline.endedAt = '2026-08-11T12:00:30+02:00'; candidate.endedAt = '2026-08-11T12:01:00+02:00';
    const first = compareSessions(baseline, candidate, { baselineFindingIndex: 0, candidateFindingIndex: 0 });
    expect(first.status).toBe('comparable'); expect(first.createdAt).toBe(candidate.endedAt);
    expect(compareSessions(baseline, candidate, { baselineFindingIndex: 0, candidateFindingIndex: 0 })).toEqual(first);
  });

  it.each(['timestampMs', 'rasterOperationCount', 'canvasApiSelfTimeMs', 'backingWidth', 'backingHeight', 'expectedBackingWidth', 'expectedBackingHeight', 'expectedPixelArea', 'actualToExpectedAreaRatio'])('fails closed for an invalid backing-window %s', field => {
    const baseline = session('backing-store-mismatch') as any; baseline.findings[0].affectedWindows[0][field] = field === 'rasterOperationCount' ? 1.5 : Number.NaN;
    expect(compareSessions(baseline, session('backing-store-mismatch', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 })).toMatchObject({ status: 'incomparable', incomparableReasons: ['incomplete-evidence'], measures: [] });
  });

  it('does not change normal recording state or the stopped session', () => {
    startRecording(); expect(getRecordingState()).toBe('recording');
    compareSessions(session('heavy-canvas-work'), session('heavy-canvas-work', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 });
    expect(getRecordingState()).toBe('recording'); const stopped = stopRecording()!; const snapshot = structuredClone(stopped);
    compareSessions(session('heavy-canvas-work'), session('heavy-canvas-work', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 });
    expect(getRecordingState()).toBe('complete'); expect(getLastSession()).toEqual(snapshot);
  });

  it('does not create, replace, clear, start, or stop explanation state', () => {
    expect(getLastExplanation()).toBeUndefined();
    compareSessions(session('heavy-canvas-work'), session('heavy-canvas-work', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 });
    expect(getLastExplanation()).toBeUndefined();
    const source = completeSource(); const selectedRecord = canvasRecord(source.findings[0].canvasId); records.add(selectedRecord);
    expect(startExplanation({ sessionId: source.sessionId, findingIndex: 0 })).toEqual({ status: 'started' });
    compareSessions(session('heavy-canvas-work'), session('heavy-canvas-work', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 });
    expect(getRecordingState()).toBe('recording'); const completed = stopExplanation()!; const snapshot = structuredClone(completed);
    compareSessions(session('heavy-canvas-work'), session('heavy-canvas-work', true), { baselineFindingIndex: 0, candidateFindingIndex: 0 });
    expect(getLastExplanation()).toEqual(snapshot); expect(getRecordingState()).toBe('complete');
  });
});
