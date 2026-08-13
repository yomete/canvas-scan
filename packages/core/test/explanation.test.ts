import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emitReport, getCurrentWindowIndex } from '../src/frame-loop';
import { getLastExplanation, getLastSession, getRecordingState, resetRecordingForTests, startExplanation, startRecording, stopExplanation, stopRecording } from '../src/recording';
import type { DrawBatchReport } from '../src/types';
import { getRecord, installCanvasPatch, notifySelectedCommandBoundary, records, type CanvasRecord } from '../src/wrap-context';
import * as wrapContext from '../src/wrap-context';

class ExplanationContext {
  canvas: ExplanationCanvas;
  private fillStyleValue = '#000000';

  constructor(canvas: ExplanationCanvas) { this.canvas = canvas; }
  get fillStyle() { return this.fillStyleValue; }
  set fillStyle(value: string) { this.fillStyleValue = value; }
  save(..._args: unknown[]) {}
  restore(..._args: unknown[]) {}
  fillRect(..._args: unknown[]) {}
}

class ExplanationCanvas {
  id = 'explanation-selected';
  isConnected = true;
  private context: ExplanationContext | null = null;
  get width() { return 300; }
  set width(_value: number) {}
  get height() { return 150; }
  set height(_value: number) {}
  getAttribute(name: string) { return name === 'id' ? this.id : null; }
  getContext(type: string) {
    if (type !== '2d') return null;
    this.context ??= new ExplanationContext(this);
    return this.context;
  }
}

installCanvasPatch({
  canvasProto: ExplanationCanvas.prototype,
  contextProto: ExplanationContext.prototype,
  attributeObserver: { observe() {}, takeRecords: () => [] },
});

const fixture = JSON.parse(readFileSync(new URL('./fixtures/v05-02-explanation-v1.json', import.meta.url), 'utf8'));

const report = (canvasId: string): DrawBatchReport => ({
  canvasId,
  nearestReactOwner: null,
  attributionKind: 'unattributed',
  sourceLocation: null,
  rasterOperationCount: 2,
  canvasApiSelfTimeMs: 1,
  signatureStatus: 'same',
  unknownReason: null,
  sampled: false,
  comparisonGap: 1,
  methodEvidence: {},
});

const record = (id: string): CanvasRecord => ({
  canvas: { isConnected: true }, contentDirty: false, contentSig: { hash: 0, unknown: false, opCount: 0, unknownReason: null }, contentVersion: 0,
  id, serial: 1, sig: { hash: 0, unknown: false, opCount: 0, unknownReason: null }, rasterOps: 0, selfTimeMs: 0,
  activeInWindow: false, prev: null, attribution: { nearestReactOwner: null, attributionKind: 'unattributed' }, lastStatus: null, props: new Map(),
  matrix: [1, 0, 0, 1, 0, 0], matrixUnknown: false, matrixHash: 0, pathHash: 0, pathUnknown: false, clipHash: 0,
  clipUnknown: false, resetPendingReason: null, modelUntrusted: false, resetVersion: 0, continuityLost: false, sourceResetVersions: new Map(),
  attributeObservationUnavailable: false, contextActivityInWindow: false, exactResetDepth: 0, inactiveBoundaries: 0, retired: false,
  lastConnected: false, activeLifecycleRecorded: false, pendingLifecycleEvents: [], stateStack: [],
});

function completeSource(canvasId = 'source-canvas') {
  startRecording();
  emitReport(report(canvasId), {}, { windowIndex: getCurrentWindowIndex() + 1, timestampMs: 1 });
  emitReport(report(canvasId), {}, { windowIndex: getCurrentWindowIndex() + 2, timestampMs: 2 });
  return stopRecording()!;
}

function completeSourceForCanvas(canvas: ExplanationCanvas, sourceRecord: CanvasRecord) {
  startRecording();
  emitReport(report(sourceRecord.id), canvas, { windowIndex: getCurrentWindowIndex() + 1, timestampMs: 1 });
  emitReport(report(sourceRecord.id), canvas, { windowIndex: getCurrentWindowIndex() + 2, timestampMs: 2 });
  return stopRecording()!;
}

function completeTwoSources() {
  startRecording();
  for (const windowIndex of [getCurrentWindowIndex() + 1, getCurrentWindowIndex() + 2]) {
    emitReport(report('source-a'), {}, { windowIndex, timestampMs: windowIndex });
    emitReport(report('source-b'), {}, { windowIndex, timestampMs: windowIndex });
  }
  return stopRecording()!;
}

function completeTwoCanvasSources(first: ExplanationCanvas, firstRecord: CanvasRecord, second: ExplanationCanvas, secondRecord: CanvasRecord) {
  startRecording();
  for (const windowIndex of [getCurrentWindowIndex() + 1, getCurrentWindowIndex() + 2]) {
    emitReport(report(firstRecord.id), first, { windowIndex, timestampMs: windowIndex });
    emitReport(report(secondRecord.id), second, { windowIndex, timestampMs: windowIndex });
  }
  return stopRecording()!;
}

afterEach(() => {
  resetRecordingForTests();
  records.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('explanation state', () => {
  it('returns exact unavailable results without changing completed state', () => {
    expect(startExplanation({ sessionId: 'none', findingIndex: 0 })).toEqual({ status: 'unavailable', reason: 'no-session' });
    const session = completeSource();
    expect(startExplanation({ sessionId: 'other', findingIndex: 0 })).toEqual({ status: 'unavailable', reason: 'session-mismatch' });
    expect(startExplanation({ sessionId: session.sessionId, findingIndex: 99 })).toEqual({ status: 'unavailable', reason: 'finding-not-found' });
    expect(startExplanation({ sessionId: session.sessionId, findingIndex: 0 })).toEqual({ status: 'unavailable', reason: 'canvas-unavailable' });
    expect(getLastSession()?.sessionId).toBe(session.sessionId);
  });

  it('shares a manual stop and deep-copies the stored artifact', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T10:00:00.000Z'));
    const source = completeSource();
    const sourceRecord = record(source.findings[0].canvasId);
    records.add(sourceRecord);
    expect(startExplanation({ sessionId: source.sessionId, findingIndex: 0 })).toEqual({ status: 'started' });
    expect(startExplanation({ sessionId: source.sessionId, findingIndex: 0 })).toEqual({ status: 'already-active' });
    expect(getLastExplanation()).toBeUndefined();
    vi.advanceTimersByTime(1000);
    const artifact = stopExplanation()!;
    expect(artifact).toEqual(fixture);
    expect(artifact.collectionLimits).toEqual({ maxDurationMs: 10000, maxSelectedCanvases: 1, maxActiveWindows: 120, maxCommandEntries: 5000, maxArgumentsPerCommand: 20, maxValueTokens: 1024, maxStackSamples: 8, maxFramesPerStack: 20, maxSourceMapLookups: 8, maxSourceMapResponseBytes: 2097152 });
    expect(artifact.droppedEntryCounts).toEqual({ durationStops: 0, selectedCanvasRejections: 0, activeWindows: 0, commandEntries: 0, commandArguments: 0, valueTokens: 0, stackSamples: 0, stackFrames: 0, sourceMapLookups: 0, sourceMapResponses: 0 });
    expect(getLastSession()?.sessionId).toBe(artifact.followUp.sessionId);
    artifact.source.canvasId = 'changed-stop-result';
    artifact.followUp.canvasId = 'changed-stop-result';
    (artifact.collectionLimits as { maxDurationMs: number }).maxDurationMs = 1;
    artifact.droppedEntryCounts.commandEntries = 1;
    expect(getLastExplanation()).toMatchObject({
      source: { canvasId: sourceRecord.id },
      followUp: { canvasId: sourceRecord.id },
      collectionLimits: { maxDurationMs: 10000 },
      droppedEntryCounts: { commandEntries: 0 },
    });
    const firstRead = getLastExplanation()!;
    firstRead.source.canvasId = 'changed';
    firstRead.followUp.canvasId = 'changed';
    (firstRead.collectionLimits as { maxDurationMs: number }).maxDurationMs = 1;
    firstRead.droppedEntryCounts.commandEntries = 1;
    const secondRead = getLastExplanation()!;
    expect(secondRead.source.canvasId).toBe(sourceRecord.id);
    expect(secondRead.followUp.canvasId).toBe(sourceRecord.id);
    expect(secondRead.collectionLimits.maxDurationMs).toBe(10000);
    expect(secondRead.droppedEntryCounts.commandEntries).toBe(0);
    expect(stopExplanation()).toBeUndefined();
  });

  it('starts a completed finding from its connected retired record', () => {
    const canvas = new ExplanationCanvas();
    canvas.getContext('2d');
    const sourceRecord = getRecord(canvas)!;
    const source = completeSourceForCanvas(canvas, sourceRecord);
    records.delete(sourceRecord);
    sourceRecord.retired = true;

    expect(startExplanation({ sessionId: source.sessionId, findingIndex: 0 })).toEqual({ status: 'started' });
    expect(records.has(sourceRecord)).toBe(true);
    expect(getRecord(canvas)).toBe(sourceRecord);
    expect(records.size).toBe(1);

    const artifact = stopExplanation()!;
    expect(artifact).toMatchObject({
      source: { sessionId: source.sessionId, findingIndex: 0, findingType: source.findings[0].type, canvasId: sourceRecord.id },
      followUp: { canvasId: sourceRecord.id },
      collectionLimits: { maxDurationMs: 10000 },
    });
  });

  it('rejects disconnected and replacement canvases for a completed finding', () => {
    const canvas = new ExplanationCanvas();
    canvas.getContext('2d');
    const sourceRecord = getRecord(canvas)!;
    const source = completeSourceForCanvas(canvas, sourceRecord);
    records.delete(sourceRecord);
    sourceRecord.retired = true;
    canvas.isConnected = false;

    expect(startExplanation({ sessionId: source.sessionId, findingIndex: 0 })).toEqual({ status: 'unavailable', reason: 'canvas-unavailable' });
    expect(getRecordingState()).toBe('complete');
    expect(getLastExplanation()).toBeUndefined();

    const replacement = new ExplanationCanvas();
    replacement.id = canvas.id;
    replacement.getContext('2d');
    expect(startExplanation({ sessionId: source.sessionId, findingIndex: 0 })).toEqual({ status: 'unavailable', reason: 'canvas-unavailable' });
    expect(getRecordingState()).toBe('complete');
    expect(getLastExplanation()).toBeUndefined();
  });

  it('rejects a disconnected active fallback record without reactivating it', () => {
    const source = completeSource();
    const detached = record(source.findings[0].canvasId);
    detached.canvas = { isConnected: false };
    detached.retired = true;
    records.add(detached);

    expect(startExplanation({ sessionId: source.sessionId, findingIndex: 0 })).toEqual({ status: 'unavailable', reason: 'canvas-unavailable' });
    expect(records.has(detached)).toBe(true);
    expect(detached.retired).toBe(true);
  });

  it('rejects an active fallback record without connected canvas evidence', () => {
    const source = completeSource();
    const unavailable = record(source.findings[0].canvasId);
    unavailable.canvas = {};
    records.add(unavailable);

    expect(startExplanation({ sessionId: source.sessionId, findingIndex: 0 })).toEqual({ status: 'unavailable', reason: 'canvas-unavailable' });
    expect(getRecordingState()).toBe('complete');
  });

  it('does not count a detached mapped alternative against the selected canvas limit', () => {
    const first = new ExplanationCanvas(); first.getContext('2d');
    const second = new ExplanationCanvas(); second.getContext('2d');
    const firstRecord = getRecord(first)!;
    const secondRecord = getRecord(second)!;
    const source = completeTwoCanvasSources(first, firstRecord, second, secondRecord);
    records.delete(firstRecord); firstRecord.retired = true;
    records.delete(secondRecord); secondRecord.retired = true; second.isConnected = false;
    const firstIndex = source.findings.findIndex(finding => finding.canvasId === firstRecord.id);
    const secondIndex = source.findings.findIndex(finding => finding.canvasId === secondRecord.id);

    expect(startExplanation({ sessionId: source.sessionId, findingIndex: firstIndex })).toEqual({ status: 'started' });
    expect(startExplanation({ sessionId: source.sessionId, findingIndex: secondIndex })).toEqual({ status: 'already-active' });
    expect(stopExplanation()).toMatchObject({ droppedEntryCounts: { selectedCanvasRejections: 0 } });
  });

  it('keeps only retained canvas identities for a capped completed session', () => {
    const canvases = Array.from({ length: 129 }, () => new ExplanationCanvas());
    const canvasRecords = canvases.map(canvas => { canvas.getContext('2d'); return getRecord(canvas)!; });
    startRecording();
    for (const [index, canvas] of canvases.entries()) {
      const sourceRecord = canvasRecords[index];
      emitReport(report(sourceRecord.id), canvas, { windowIndex: getCurrentWindowIndex() + index + 1, timestampMs: index + 1 });
    }
    const retained = canvasRecords.at(-1)!;
    emitReport(report(retained.id), canvases.at(-1)!, { windowIndex: getCurrentWindowIndex() + 130, timestampMs: 130 });
    const source = stopRecording()!;
    const retainedIndex = source.findings.findIndex(finding => finding.canvasId === retained.id);

    expect(source.canvases.some(canvas => canvas.canvasId === canvasRecords[0].id)).toBe(false);
    expect(source.findings.some(finding => finding.canvasId === canvasRecords[0].id)).toBe(false);
    expect(retainedIndex).toBeGreaterThanOrEqual(0);
    records.delete(retained); retained.retired = true;
    expect(startExplanation({ sessionId: source.sessionId, findingIndex: retainedIndex })).toEqual({ status: 'started' });
    stopExplanation();
  });

  it('keeps a renewed canvas identity when window eviction removes its old window', () => {
    const renewedCanvas = new ExplanationCanvas(); renewedCanvas.getContext('2d');
    const otherCanvas = new ExplanationCanvas(); otherCanvas.getContext('2d');
    const renewedRecord = getRecord(renewedCanvas)!;
    const otherRecord = getRecord(otherCanvas)!;
    const firstWindowIndex = getCurrentWindowIndex() + 1;
    startRecording();
    emitReport(report(renewedRecord.id), renewedCanvas, { windowIndex: firstWindowIndex, timestampMs: 1 });
    for (let index = 0; index < 9999; index++) {
      emitReport(report(otherRecord.id), otherCanvas, { windowIndex: firstWindowIndex + index + 1, timestampMs: index + 2 });
    }
    emitReport(report(renewedRecord.id), renewedCanvas, { windowIndex: firstWindowIndex + 10000, timestampMs: 10001 });
    const source = stopRecording()!;
    const findingIndex = source.findings.findIndex(finding => finding.canvasId === renewedRecord.id);

    expect(findingIndex).toBeGreaterThanOrEqual(0);
    records.delete(renewedRecord); renewedRecord.retired = true;
    expect(startExplanation({ sessionId: source.sessionId, findingIndex })).toEqual({ status: 'started' });
    stopExplanation();
  });

  it('deep-copies nested command windows, comparisons, and first differences', () => {
    const canvas = new ExplanationCanvas();
    const context = canvas.getContext('2d')!;
    const sourceRecord = getRecord(canvas)!;
    const source = completeSource(sourceRecord.id);
    expect(startExplanation({ sessionId: source.sessionId, findingIndex: 0 })).toEqual({ status: 'started' });
    const privateObject = { privateKey: 'privateValue' };
    const draw = (value: number) => {
      context.save(privateObject);
      context.fillStyle = 'opaque-private-string';
      context.fillRect(value, 0, 10, 10);
      context.restore();
    };
    draw(1);
    notifySelectedCommandBoundary(sourceRecord, 10, 10, true, true);
    draw(1);
    notifySelectedCommandBoundary(sourceRecord, 11, 11, true, true);
    draw(2);
    notifySelectedCommandBoundary(sourceRecord, 12, 12, true, true);
    const artifact = stopExplanation()!;
    expect(artifact.windows).toHaveLength(3);
    expect(artifact.firstDifference).toMatchObject({ ordinal: 2, reason: 'argument-token' });
    expect(artifact.stacks.map(sample => sample.reason)).toEqual(['first-raster', 'first-difference']);
    expect(artifact.stacks[1]).toMatchObject({ windowIndex: 12, commandOrdinal: 2, reason: 'first-difference' });
    expect(artifact.stacks[0].frames.length).toBeGreaterThan(0);

    artifact.windows[0].commands[0].arguments[0].kind = 'image';
    artifact.comparisons[1].difference!.target!.arguments[0].kind = 'image';
    artifact.firstDifference!.reference!.arguments[0].kind = 'image';
    artifact.stacks[0].frames[0].functionName = 'changed-stack';
    artifact.stacks[0].frames[0].mappingStatus = 'mapped';
    const firstRead = getLastExplanation()!;
    expect(firstRead.windows[0].commands[0].arguments[0].kind).toBe('object');
    expect(firstRead.comparisons[1].difference!.target!.arguments[0].kind).toBe('number');
    expect(firstRead.firstDifference!.reference!.arguments[0].kind).toBe('number');
    expect(firstRead.stacks[0].frames[0].functionName).not.toBe('changed-stack');
    expect(firstRead.stacks[0].frames[0].mappingStatus).toBe('unresolved');

    firstRead.windows[2].commands[2].arguments[0].token = 'changed';
    firstRead.comparisons[1].difference!.reference!.arguments[0].token = 'changed';
    firstRead.firstDifference!.target!.arguments[0].token = 'changed';
    firstRead.stacks[1].frames.length = 0;
    const secondRead = getLastExplanation()!;
    expect(secondRead.windows[2].commands[2].arguments[0].token).not.toBe('changed');
    expect(secondRead.comparisons[1].difference!.reference!.arguments[0].token).not.toBe('changed');
    expect(secondRead.firstDifference!.target!.arguments[0].token).not.toBe('changed');
    expect(secondRead.stacks[1].frames.length).toBeGreaterThan(0);
  });

  it('uses the 10-second timer and does not stop a normal recording', () => {
    vi.useFakeTimers();
    startRecording();
    expect(stopExplanation()).toBeUndefined();
    expect(getRecordingState()).toBe('recording');
    expect(startExplanation({ sessionId: 'none', findingIndex: 0 })).toEqual({ status: 'unavailable', reason: 'recording-active' });
    stopRecording();
    const source = completeSource();
    const sourceRecord = record(source.findings[0].canvasId);
    records.add(sourceRecord);
    startExplanation({ sessionId: source.sessionId, findingIndex: 0 });
    vi.advanceTimersByTime(9999);
    expect(getLastExplanation()).toBeUndefined();
    vi.advanceTimersByTime(1);
    const timedOut = getLastExplanation()!;
    expect(timedOut).toMatchObject({
      stopReason: 'max-duration',
      droppedEntryCounts: { durationStops: 1 },
    });
    expect(timedOut.limitResults[0]).toEqual({ name: 'duration-ms', maximum: 10000, rejectedCount: 1, reason: 'max-duration', firstAffected: { scope: 'explanation', windowIndex: null, commandOrdinal: null } });
    expect(stopRecording()).toBeUndefined();
  });

  it('keeps completed artifacts on a failed start and rejects disabled instrumentation', () => {
    vi.useFakeTimers();
    const source = completeSource();
    const sourceRecord = record(source.findings[0].canvasId);
    records.add(sourceRecord);
    startExplanation({ sessionId: source.sessionId, findingIndex: 0 });
    stopExplanation();
    const prior = getLastExplanation();
    const nextSource = completeSource('next-source');
    expect(startExplanation({ sessionId: nextSource.sessionId, findingIndex: 99 })).toEqual({ status: 'unavailable', reason: 'finding-not-found' });
    expect(getLastExplanation()).toEqual(prior);
    const killed = vi.spyOn(wrapContext, 'isKilled').mockReturnValue(true);
    expect(startExplanation({ sessionId: nextSource.sessionId, findingIndex: 0 })).toEqual({ status: 'unavailable', reason: 'instrumentation-disabled' });
    killed.mockRestore();
  });

  it('lets stopRecording finish an explanation and store both artifacts', () => {
    const source = completeSource();
    const sourceRecord = record(source.findings[0].canvasId);
    records.add(sourceRecord);
    expect(startExplanation({ sessionId: source.sessionId, findingIndex: 0 })).toEqual({ status: 'started' });
    const followUp = stopRecording()!;
    expect(followUp.stopReason).toBe('manual');
    expect(getLastExplanation()).toMatchObject({ stopReason: 'manual', followUp: { sessionId: followUp.sessionId, canvasId: sourceRecord.id } });
  });

  it('clears the prior artifact only after a successful new explanation start', () => {
    const firstSource = completeSource('first-source');
    const firstRecord = record(firstSource.findings[0].canvasId);
    records.add(firstRecord);
    startExplanation({ sessionId: firstSource.sessionId, findingIndex: 0 });
    stopExplanation();
    expect(getLastExplanation()).toBeDefined();
    const nextSource = completeSource('next-source');
    const nextRecord = record(nextSource.findings[0].canvasId);
    records.add(nextRecord);
    expect(startExplanation({ sessionId: nextSource.sessionId, findingIndex: 0 })).toEqual({ status: 'started' });
    expect(getLastExplanation()).toBeUndefined();
  });

  it('keeps an active selection and counts only a different valid selection', () => {
    const source = completeTwoSources();
    records.add(record('source-a')); records.add(record('source-b'));
    const first = source.findings.findIndex(finding => finding.canvasId === 'source-a');
    const second = source.findings.findIndex(finding => finding.canvasId === 'source-b');
    expect(first).toBeGreaterThanOrEqual(0); expect(second).toBeGreaterThanOrEqual(0);
    expect(startExplanation({ sessionId: source.sessionId, findingIndex: first })).toEqual({ status: 'started' });
    expect(startExplanation({ sessionId: source.sessionId, findingIndex: first })).toEqual({ status: 'already-active' });
    expect(startExplanation({ sessionId: source.sessionId, findingIndex: 999 })).toEqual({ status: 'already-active' });
    expect(startExplanation({ sessionId: source.sessionId, findingIndex: second })).toEqual({ status: 'already-active' });
    expect(stopExplanation()).toMatchObject({
      source: { findingIndex: first, canvasId: 'source-a' },
      followUp: { canvasId: 'source-a' },
      droppedEntryCounts: { selectedCanvasRejections: 1 },
      limitResults: expect.arrayContaining([{ name: 'selected-canvases', maximum: 1, rejectedCount: 1, reason: 'selected-canvas-limit', firstAffected: { scope: 'explanation', windowIndex: null, commandOrdinal: null } }]),
    });
  });
});
