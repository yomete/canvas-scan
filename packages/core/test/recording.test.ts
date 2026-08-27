import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emitLifecycleEvent, emitReport, emitResetEvent, getCurrentWindowIndex, latestReports, startFrameLoop, subscribeToReports } from '../src/frame-loop';
import { getLastSession, getRecordingState, mark, resetRecordingForTests, startRecording, stopRecording } from '../src/recording';
import type { DrawBatchReport } from '../src/types';
import { getResetEvents, records, type CanvasRecord } from '../src/wrap-context';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/v04-02-session-v1.json', import.meta.url), 'utf8'));
const makeReport = (canvasId = 'canvas-a', status: DrawBatchReport['signatureStatus'] = 'same', overrides: Partial<DrawBatchReport> = {}): DrawBatchReport => ({
  canvasId, nearestReactOwner: canvasId === 'canvas-a' ? 'Chart' : null,
  attributionKind: canvasId === 'canvas-a' ? 'jsx-owner' : 'unattributed',
  sourceLocation: canvasId === 'canvas-a' ? { file: '/src/Chart.tsx', line: 4, column: 2 } : null,
  rasterOperationCount: 1, canvasApiSelfTimeMs: 0.5, signatureStatus: status,
  unknownReason: status === 'unknown' ? 'first-window' : null, sampled: false, coveredWindowCount: 1,
  comparisonGap: status === 'unknown' ? null : 1, followsCanvasReset: false, methodEvidence: {}, ...overrides,
});
const publish = (report: DrawBatchReport, index: number) => emitReport(report, {}, { windowIndex: getCurrentWindowIndex() + index, timestampMs: index * 100 });
const makeLoopRecord = (): CanvasRecord => ({
  canvas: {}, creationSite: null, contentDirty: false, contentSig: { hash: 0x811c9dc5, unknown: false, opCount: 0, unknownReason: null }, contentVersion: 0,
  id: 'recording-range', serial: 1, sig: { hash: 0x1234, unknown: false, opCount: 3, unknownReason: null }, rasterOps: 2, selfTimeMs: 0.5,
  carriedRasterOps: 0, carriedSelfTimeMs: 0, carriedWindows: 0,
  activeInWindow: true, prev: null, attribution: { nearestReactOwner: 'Fake', attributionKind: 'jsx-owner' }, lastStatus: null, props: new Map(),
  matrix: [1, 0, 0, 1, 0, 0], matrixUnknown: false, matrixHash: 0, pathHash: 0x811c9dc5, pathUnknown: false, clipHash: 0x811c9dc5,
  clipUnknown: false, resetPendingReason: null, modelUntrusted: false, resetVersion: 0, continuityLost: false, sourceResetVersions: new Map(),
  attributeObservationUnavailable: false, contextActivityInWindow: false, exactResetDepth: 0, inactiveBoundaries: 0, retired: false,
  lastConnected: false, activeLifecycleRecorded: false, pendingLifecycleEvents: [], stateStack: [],
});
const publishLifecycle = (
  canvasId: string,
  timestampMs: number,
  type: 'first-observed' | 'active' | 'detached' | 'retired' | 'reactivated' = 'first-observed',
) => emitLifecycleEvent({
  canvasId,
  type,
  windowIndex: getCurrentWindowIndex() + 1,
  timestampMs,
  connected: false,
  activeRegistrySize: 1,
  evidenceLevel: 'measured',
});
function installPerformanceEntries(entriesByType: Record<string, Array<Record<string, unknown>>>): void {
  class FakePerformanceObserver {
    static supportedEntryTypes = ['event', 'long-animation-frame'];
    type = '';
    observe(options: { type: string }): void { this.type = options.type; }
    takeRecords(): Array<Record<string, unknown>> { return entriesByType[this.type] ?? []; }
    disconnect(): void {}
  }
  vi.stubGlobal('PerformanceObserver', FakePerformanceObserver);
}

afterEach(() => { resetRecordingForTests(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('recording', () => {
  it('starts idle and has no session or no-op stop', () => {
    expect(getRecordingState()).toBe('idle');
    expect(getLastSession()).toBeUndefined();
    expect(stopRecording()).toBeUndefined();
  });

  it('creates the exact deterministic fixture session', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-04T10:00:00.000Z'));
    const now = vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(1000);
    startRecording();
    publish(makeReport('canvas-a', 'same'), 1);
    publish(makeReport('canvas-b', 'unknown', { sampled: true, canvasApiSelfTimeMs: 0.25 }), 2);
    publish(makeReport('canvas-a', 'changed', { rasterOperationCount: 2, canvasApiSelfTimeMs: 1 }), 3);
    vi.setSystemTime(new Date('2026-08-04T10:00:01.000Z'));
    expect(stopRecording()).toEqual(fixture);
    now.mockRestore();
  });

  it('makes active start idempotent and clears a complete session only on a new start', () => {
    vi.useFakeTimers(); startRecording(); publish(makeReport(), 1); const first = stopRecording()!;
    expect(getLastSession()?.sessionId).toBe(first.sessionId);
    startRecording(); const active = getLastSession(); startRecording();
    expect(active).toBeUndefined(); publish(makeReport('new'), 2);
    expect(stopRecording()?.windows.map(window => window.canvasId)).toEqual(['new']);
  });

  it('stops at 30 seconds and manual stop wins before the timer', () => {
    vi.useFakeTimers(); startRecording(); vi.advanceTimersByTime(29999);
    expect(stopRecording()?.stopReason).toBe('manual'); vi.advanceTimersByTime(1);
    expect(getLastSession()?.stopReason).toBe('manual');
    startRecording(); vi.advanceTimersByTime(30000);
    expect(getLastSession()?.stopReason).toBe('max-duration'); expect(stopRecording()).toBeUndefined();
  });

  it('does not collect outside a recording and gives each session a new id', () => {
    publish(makeReport('outside'), 1); startRecording(); publish(makeReport('one'), 2);
    const first = stopRecording()!; publish(makeReport('outside'), 3); startRecording(); publish(makeReport('two'), 4);
    const second = stopRecording()!;
    expect(first.windows).toHaveLength(1); expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.windows.map(window => window.canvasId)).toEqual(['two']);
  });

  it('keeps browser evidence in one session, deep-copies nested scripts, and produces JSON-only output', () => {
    installPerformanceEntries({ 'long-animation-frame': [{ startTime: 5, duration: 10, blockingDuration: 3, scripts: [{ invoker: 'handler', sourceURL: 'https://x.test/app.js?q=private', duration: 7 }] }] });
    let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock);
    mark('outside'); startRecording(); clock = 10; mark(' inside '); clock = 20; const first = stopRecording()!;
    const firstLoaf = first.browserEntries.find(entry => entry.kind === 'long-animation-frame');
    if (!firstLoaf || firstLoaf.kind !== 'long-animation-frame') throw new Error('missing long frame');
    firstLoaf.scripts[0].invoker = 'changed';
    const storedLoaf = getLastSession()!.browserEntries.find(entry => entry.kind === 'long-animation-frame');
    if (!storedLoaf || storedLoaf.kind !== 'long-animation-frame') throw new Error('missing stored long frame');
    expect(storedLoaf.scripts[0].invoker).toBe('handler');
    startRecording(); const second = stopRecording()!;
    expect(first.browserEntries.find(entry => entry.kind === 'user-mark')).toMatchObject({ kind: 'user-mark', label: 'inside' });
    expect(second.browserEntries).toEqual([]);
    expect(getLastSession()!.browserEntries).toEqual([]);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });

  it('associates one inclusive entry with every overlap without changing it or a nearby entry', () => {
    installPerformanceEntries({ event: [
      { name: 'pointerdown', startTime: 20, duration: 10, interactionId: 77, target: { tagName: 'BUTTON' } },
      { name: 'wheel', startTime: 20.1, duration: 9.8, interactionId: 0, target: { tagName: 'DIV' } },
      { name: 'keyup', startTime: -20, duration: 5, interactionId: 0 },
    ] });
    let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock);
    startRecording(); const firstWindow = getCurrentWindowIndex() + 1;
    emitReport(makeReport('episode-a'), {}, { windowIndex: firstWindow, timestampMs: 20, startedAtTimestampMs: 10, endedAtTimestampMs: 20 });
    emitReport(makeReport('episode-b'), {}, { windowIndex: firstWindow + 3, timestampMs: 40, startedAtTimestampMs: 30, endedAtTimestampMs: 40 });
    clock = 50;
    const session = stopRecording()!;
    const exact = session.browserEntries.find(entry => entry.kind === 'event-timing' && entry.eventType === 'pointerdown');
    const nearby = session.browserEntries.find(entry => entry.kind === 'event-timing' && entry.eventType === 'wheel');
    expect(exact).toMatchObject({ startedAtTimestampMs: 20, endedAtTimestampMs: 30, durationMs: 10, interactionId: 77, targetTagName: 'button' });
    expect(nearby?.startedAtTimestampMs).toBeCloseTo(20.1); expect(nearby?.endedAtTimestampMs).toBeCloseTo(29.9);
    expect(session.browserEntries.some(entry => entry.kind === 'event-timing' && entry.eventType === 'keyup')).toBe(false);
    expect(session.episodeAssociations.filter(item => item.entryId === exact?.entryId)).toMatchObject([
      { episodeId: session.episodes[0].episodeId, startedAtTimestampMs: 20, endedAtTimestampMs: 20, evidenceLevel: 'associated' },
      { episodeId: session.episodes[1].episodeId, startedAtTimestampMs: 30, endedAtTimestampMs: 30, evidenceLevel: 'associated' },
    ]);
    expect(session.episodeAssociations.some(item => item.entryId === nearby?.entryId)).toBe(false);
    expect(exact).toMatchObject({ startedAtTimestampMs: 20, endedAtTimestampMs: 30 });
  });

  it('clears frame-loop range tracking for stops, resets, and later sessions', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; } });
    let clock = 1; vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const record = makeLoopRecord(); records.add(record);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      startRecording(); startFrameLoop({}); clock = 10; callbacks.shift()!(1);
      expect(stopRecording()!.windows[0]).toMatchObject({ startedAtTimestampMs: 1, endedAtTimestampMs: 10 });
      clock = 20; record.activeInWindow = true; callbacks.shift()!(2);
      clock = 30; startRecording(); clock = 40; record.activeInWindow = true; callbacks.shift()!(3);
      expect(stopRecording()!.windows[0]).toMatchObject({ startedAtTimestampMs: 30, endedAtTimestampMs: 40 });
      clock = 50; startRecording(); resetRecordingForTests(); clock = 60; record.activeInWindow = true; callbacks.shift()!(4);
      clock = 70; startRecording(); clock = 80; record.activeInWindow = true; callbacks.shift()!(5);
      expect(stopRecording()!.windows[0]).toMatchObject({ startedAtTimestampMs: 70, endedAtTimestampMs: 80 });
      vi.useFakeTimers(); vi.spyOn(performance, 'now').mockImplementation(() => clock);
      clock = 90; startRecording(); vi.advanceTimersByTime(30000);
      expect(getLastSession()?.stopReason).toBe('max-duration');
      clock = 100; record.activeInWindow = true; callbacks.shift()!(6);
      clock = 110; startRecording(); clock = 120; record.activeInWindow = true; callbacks.shift()!(7);
      expect(stopRecording()!.windows[0]).toMatchObject({ startedAtTimestampMs: 110, endedAtTimestampMs: 120 });
    } finally {
      records.delete(record);
      latestReports.delete(record.id);
      debug.mockRestore();
    }
  });

  it('ends a recorded window when the frame loop observes it, not at an older animation-frame timestamp', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; } });
    let clock = 100; vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const record = makeLoopRecord(); record.id = 'observation-time'; record.activeInWindow = false; records.add(record);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      startRecording(); startFrameLoop({});
      const interactionStartedAt = 110;
      clock = interactionStartedAt; record.activeInWindow = true; record.rasterOps = 1;
      clock = 120; callbacks.shift()!(90);
      const window = stopRecording()!.windows[0];
      expect(window).toMatchObject({ startedAtTimestampMs: 100, endedAtTimestampMs: 120 });
      expect(window.endedAtTimestampMs).toBeGreaterThanOrEqual(interactionStartedAt);
    } finally {
      records.delete(record);
      latestReports.delete(record.id);
      debug.mockRestore();
    }
  });

  it('reads geometry only for reports during recording and deep-copies it', () => {
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' })); vi.stubGlobal('devicePixelRatio', 2);
    const rect = vi.fn(() => ({ width: 240, height: 120 }));
    const canvas = { isConnected: true, width: 480, height: 240, getBoundingClientRect: rect };
    publish(makeReport('geometry'), 1);
    expect(rect).not.toHaveBeenCalled();
    startRecording();
    emitReport(makeReport('geometry'), canvas, { windowIndex: getCurrentWindowIndex() + 1, timestampMs: 300 });
    const stopped = stopRecording()!;
    expect(rect).toHaveBeenCalledTimes(1);
    stopped.windows[0].geometry.backingWidth = 1;
    expect(getLastSession()!.windows[0].geometry.backingWidth).toBe(480);
    emitReport(makeReport('geometry'), canvas, { windowIndex: getCurrentWindowIndex() + 2, timestampMs: 400 });
    expect(rect).toHaveBeenCalledTimes(1);
  });

  it('rejects a report that starts a restarted recording', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; } });
    const getStyle = vi.fn(() => ({ display: 'block', visibility: 'visible' }));
    vi.stubGlobal('getComputedStyle', getStyle); vi.stubGlobal('devicePixelRatio', 2);
    const canvas = { isConnected: true, width: 200, height: 100, getBoundingClientRect: () => ({ width: 100, height: 50 }) };
    const record = makeLoopRecord(); record.id = 'restart'; record.canvas = canvas; record.activeInWindow = false;
    let first: ReturnType<typeof stopRecording>; let runs = 0; let unsubscribeRestart = () => {};
    records.add(record);
    try {
      startFrameLoop({}); callbacks.shift()!(1);
      startRecording();
      unsubscribeRestart = subscribeToReports(() => {
        runs++; unsubscribeRestart(); first = stopRecording(); startRecording();
      });
      callbacks.shift()!(2);
      record.activeInWindow = true; record.rasterOps = 5; record.selfTimeMs = 1.5;
      emitReport(makeReport('restart', 'same', { rasterOperationCount: 5, canvasApiSelfTimeMs: 1.5 }), canvas, { windowIndex: getCurrentWindowIndex(), timestampMs: 2 });
      expect(runs).toBe(1); expect(first?.windows).toHaveLength(1); expect(getStyle).toHaveBeenCalledTimes(1);
      record.rasterOps = 8; record.selfTimeMs = 2.5;
      callbacks.shift()!(3);
      const second = stopRecording()!;
      expect(second.windows).toHaveLength(1);
      expect(second.windows[0]).toMatchObject({ canvasId: 'restart', windowIndex: getCurrentWindowIndex(), rasterOperationCount: 3, canvasApiSelfTimeMs: 1 });
      expect(getStyle).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribeRestart(); records.delete(record); latestReports.delete(record.id);
    }
  });

  it('keeps reset-only events and deep-copies them from stopped sessions', () => {
    startRecording();
    const firstWindowIndex = getCurrentWindowIndex() + 1;
    publish(makeReport('reset', 'unknown', { rasterOperationCount: 2, unknownReason: 'canvas-reset' }), firstWindowIndex);
    publish(makeReport('reset', 'unknown', { rasterOperationCount: 2, unknownReason: 'canvas-reset' }), firstWindowIndex + 1);
    emitResetEvent({ canvasId: 'reset', windowIndex: firstWindowIndex, timestampMs: 10, source: 'width-setter', dimensionChange: 'unchanged', width: 300, height: 150, rasterOperationCount: 2, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    emitResetEvent({ canvasId: 'reset', windowIndex: firstWindowIndex + 1, timestampMs: 20, source: 'height-setter', dimensionChange: 'changed', width: 300, height: 150, rasterOperationCount: 2, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    const stopped = stopRecording()!;
    stopped.resetEvents[0].width = 1;
    const finding = stopped.findings.find(item => item.type === 'resize-churn');
    if (!finding || finding.type !== 'resize-churn') throw new Error('missing resize finding');
    finding.resetEvents[0].width = 1;
    finding.affectedEpisodeIds[0] = 'changed';
    finding.commandStatuses.unknown = 99;
    finding.unknownReasons['canvas-reset'] = 99;
    const stored = getLastSession()!;
    expect(stored.resetEvents[0].width).toBe(300);
    const storedFinding = stored.findings.find(item => item.type === 'resize-churn');
    expect(storedFinding?.resetEvents[0].width).toBe(300);
    expect(storedFinding?.affectedEpisodeIds[0]).not.toBe('changed');
    expect(storedFinding?.commandStatuses.unknown).toBe(2);
    expect(storedFinding?.unknownReasons['canvas-reset']).toBe(2);
  });

  it('keeps measured lifecycle history without creating a finding', () => {
    startRecording();
    publishLifecycle('cache', 1, 'first-observed');
    publishLifecycle('cache', 2, 'active');
    publishLifecycle('cache', 3, 'retired');
    const stopped = stopRecording()!;

    expect(stopped.lifecycleEvents.map(event => event.type)).toEqual([
      'first-observed',
      'active',
      'retired',
    ]);
    expect(stopped.lifecycleEvents.every(event => event.evidenceLevel === 'measured')).toBe(true);
    expect(stopped.findings).toEqual([]);
    stopped.lifecycleEvents[0].type = 'reactivated';
    expect(getLastSession()!.lifecycleEvents[0].type).toBe('first-observed');
  });

  it('does not carry reset evidence from outside recording or before a same-window start', () => {
    const nextWindowIndex = getCurrentWindowIndex() + 1;
    emitResetEvent({ canvasId: 'outside', windowIndex: nextWindowIndex, timestampMs: 5, source: 'width-setter', dimensionChange: 'unchanged', width: 10, height: 10, rasterOperationCount: 0, activeRasterOverlap: false, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    startRecording();
    emitResetEvent({ canvasId: 'inside', windowIndex: nextWindowIndex, timestampMs: 10, source: 'height-setter', dimensionChange: 'changed', width: 10, height: 20, rasterOperationCount: 0, activeRasterOverlap: false, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    expect(stopRecording()!.resetEvents.map(event => event.canvasId)).toEqual(['inside']);
  });

  it('subtracts pre-start totals from the first partial window only', () => {
    const canvas = {};
    const record = { canvas, id: 'partial', rasterOps: 3, selfTimeMs: 1.25 } as CanvasRecord;
    records.add(record);
    try {
      const startWindowIndex = getCurrentWindowIndex();
      startRecording();
      emitReport(makeReport('partial', 'same', { rasterOperationCount: 5, canvasApiSelfTimeMs: 2, methodEvidence: { fillRect: { count: 2, canvasApiSelfTimeMs: 0.75 } } }), canvas, { windowIndex: startWindowIndex + 1, timestampMs: 10 });
      emitReport(makeReport('partial', 'same', { rasterOperationCount: 1, canvasApiSelfTimeMs: 0.5, methodEvidence: { fillRect: { count: 1, canvasApiSelfTimeMs: 0.5 } } }), canvas, { windowIndex: startWindowIndex + 2, timestampMs: 20 });
      expect(stopRecording()!.windows.map(window => ({ rasterOperationCount: window.rasterOperationCount, canvasApiSelfTimeMs: window.canvasApiSelfTimeMs, methodEvidence: window.methodEvidence }))).toEqual([
        { rasterOperationCount: 2, canvasApiSelfTimeMs: 0.75, methodEvidence: { fillRect: { count: 2, canvasApiSelfTimeMs: 0.75 } } },
        { rasterOperationCount: 1, canvasApiSelfTimeMs: 0.5, methodEvidence: { fillRect: { count: 1, canvasApiSelfTimeMs: 0.5 } } },
      ]);
    } finally {
      records.delete(record);
    }
  });

  it('does not count pre-start raster work as active reset overlap', () => {
    const canvas = {};
    const record = { canvas, id: 'partial-reset', rasterOps: 3, selfTimeMs: 1.25 } as CanvasRecord;
    records.add(record);
    try {
      const firstWindowIndex = getCurrentWindowIndex() + 1;
      startRecording();
      for (const source of ['width-setter', 'height-setter'] as const) emitResetEvent({ canvasId: 'partial-reset', windowIndex: firstWindowIndex, timestampMs: 10, source, dimensionChange: 'unchanged', width: 300, height: 150, rasterOperationCount: 3, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
      emitReport(makeReport('partial-reset', 'unknown', { rasterOperationCount: 3, canvasApiSelfTimeMs: 1.25, unknownReason: 'canvas-reset' }), canvas, { windowIndex: firstWindowIndex, timestampMs: 10 });
      const session = stopRecording()!;
      expect(session.windows[0].rasterOperationCount).toBe(0);
      expect(session.resetEvents).toMatchObject([
        { rasterOperationCount: 0, activeRasterOverlap: false },
        { rasterOperationCount: 0, activeRasterOverlap: false },
      ]);
      expect(session.findings.some(finding => finding.type === 'resize-churn')).toBe(false);
    } finally {
      records.delete(record);
    }
  });

  it('keeps FIFO published metadata and evicts whole reports at 10000', () => {
    const startWindowIndex = getCurrentWindowIndex(); startRecording(); for (let index = 1; index <= 10001; index++) publish(makeReport('one'), index);
    const session = stopRecording()!;
    expect(session.windows).toHaveLength(10000); expect(session.windows[0].windowIndex).toBe(startWindowIndex + 2);
    expect(session.windows.at(-1)?.timestampMs).toBe(1000100);
    expect(session.droppedEntryCounts.canvasWindowReports).toBe(1);
  });

  it('keeps 10000 reset events in FIFO order and counts the removed event', () => {
    startRecording();
    const windowIndex = getCurrentWindowIndex() + 1;
    for (let index = 0; index <= 10000; index++) emitResetEvent({ canvasId: 'reset-fifo', windowIndex, timestampMs: index, source: 'width-setter', dimensionChange: 'changed', width: index, height: 10, rasterOperationCount: 0, activeRasterOverlap: false, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    const session = stopRecording()!;
    expect(session.resetEvents).toHaveLength(10000);
    expect(session.resetEvents[0].width).toBe(1);
    expect(session.droppedEntryCounts.resetEvents).toBe(1);
    expect(session.collectionLimits.maxResetEvents).toBe(10000);
  });

  it('keeps 10000 lifecycle events in FIFO order and counts the removed event', () => {
    startRecording();
    for (let index = 0; index <= 10000; index++) {
      publishLifecycle('lifecycle-fifo', index);
    }
    const session = stopRecording()!;

    expect(session.lifecycleEvents).toHaveLength(10000);
    expect(session.lifecycleEvents[0].timestampMs).toBe(1);
    expect(session.droppedEntryCounts.lifecycleEvents).toBe(1);
    expect(session.collectionLimits.maxLifecycleEvents).toBe(10000);
  });

  it('counts reset events removed with an evicted canvas lifetime', () => {
    startRecording();
    const windowIndex = getCurrentWindowIndex() + 1;
    for (let index = 0; index <= 128; index++) emitResetEvent({ canvasId: `reset-${index}`, windowIndex, timestampMs: index, source: 'width-setter', dimensionChange: 'changed', width: index, height: 10, rasterOperationCount: 0, activeRasterOverlap: false, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    const session = stopRecording()!;
    expect(session.resetEvents.map(event => event.canvasId)).not.toContain('reset-0');
    expect(session.droppedEntryCounts).toMatchObject({ canvasLifetimes: 1, resetEvents: 1 });
  });

  it('counts lifecycle events removed with an evicted canvas lifetime', () => {
    startRecording();
    for (let index = 0; index <= 128; index++) {
      publishLifecycle(`lifecycle-${index}`, index);
    }
    const session = stopRecording()!;

    expect(session.lifecycleEvents.map(event => event.canvasId)).not.toContain('lifecycle-0');
    expect(new Set(session.lifecycleEvents.map(event => event.canvasId))).toHaveLength(128);
    expect(session.droppedEntryCounts).toMatchObject({
      canvasLifetimes: 1,
      lifecycleEvents: 1,
    });
  });

  it('keeps reset-event FIFO replacement within 128 canvas lifetimes', () => {
    startRecording();
    const windowIndex = getCurrentWindowIndex() + 1;
    const emit = (canvasId: string, timestampMs: number) => emitResetEvent({ canvasId, windowIndex, timestampMs, source: 'width-setter', dimensionChange: 'unchanged', width: 10, height: 10, rasterOperationCount: 0, activeRasterOverlap: false, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    emit('single', 0);
    for (let index = 1; index < 10000; index++) emit(`retained-${index % 127}`, index);
    emit('single', 10000);
    emit('new', 10001);
    const session = stopRecording()!;
    expect(new Set(session.resetEvents.map(event => event.canvasId)).size).toBe(128);
    expect(session.droppedEntryCounts.canvasLifetimes).toBe(1);
  });

  it('flushes post-start pending resets and removes pre-start raster work', () => {
    const canvas = {};
    const record = { canvas, id: 'pending', rasterOps: 3, selfTimeMs: 0, resetPendingReason: 'canvas-reset' } as CanvasRecord;
    records.add(record);
    try {
      startRecording();
      record.rasterOps = 5;
      getResetEvents(record).push({ source: 'width-setter', width: 300, height: 150, dimensionChange: 'unchanged' });
      getResetEvents(record).push({ source: 'height-setter', width: 300, height: 150, dimensionChange: 'unchanged' });
      const session = stopRecording()!;
      expect(session.resetEvents).toMatchObject([
        { canvasId: 'pending', rasterOperationCount: 2, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset' },
        { canvasId: 'pending', rasterOperationCount: 2, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset' },
      ]);
      expect(new Set(session.resetEvents.map(event => event.timestampMs))).toHaveLength(1);
      expect(record.resetPendingReason).toBe('canvas-reset');
    } finally {
      records.delete(record);
    }
  });

  it('keeps a valid session when a canvas loses its only window to report eviction', () => {
    startRecording(); publish(makeReport('aged-out'), 1);
    for (let index = 2; index <= 10000; index++) publish(makeReport('kept'), index);
    publish(makeReport('aged-out'), 10001);
    const session = stopRecording()!;
    expect(session.windows.every(window => session.canvases.some(canvas => canvas.canvasId === window.canvasId))).toBe(true);
    expect(session.canvases.find(canvas => canvas.canvasId === 'aged-out')?.activeWindowCount).toBe(1);
  });

  it('keeps the summary of an evicted canvas and drops only its windows', () => {
    startRecording(); for (let index = 1; index <= 129; index++) publish(makeReport(`canvas-${index}`), index);
    publish(makeReport('canvas-0'), 130); const session = stopRecording()!;
    // Two evictions, and both canvases still say something true about
    // themselves. Before this they were forgotten, taking 43% of a real
    // Excalidraw recording with them.
    expect(session.canvases).toHaveLength(130);
    expect(session.canvases.filter(canvas => canvas.windowDetailDropped).map(canvas => canvas.canvasId).sort()).toEqual(['canvas-1', 'canvas-2']);
    expect(session.canvases.find(canvas => canvas.canvasId === 'canvas-1')).toMatchObject({ activeWindowCount: 1, rasterOperationCount: 1, canvasApiSelfTimeMs: 0.5, maxWindowSelfTimeMs: 0.5, commandStatuses: { same: 1, changed: 0, unknown: 0 } });
    // The windows themselves are gone, so nothing derived per window mentions
    // those canvases and the dropped count says how many frames went.
    expect(session.windows.some(window => window.canvasId === 'canvas-1' || window.canvasId === 'canvas-2')).toBe(false);
    expect(session.windows.every(window => session.canvases.some(canvas => canvas.canvasId === window.canvasId))).toBe(true);
    expect(session.findings.some(finding => finding.canvasId === 'canvas-1' || finding.canvasId === 'canvas-2')).toBe(false);
    expect(session.droppedEntryCounts).toMatchObject({ canvasWindowReports: 2, canvasLifetimes: 0 });
  });

  it('counts an evicted canvas with no window to summarize as a dropped lifetime', () => {
    startRecording();
    const windowIndex = getCurrentWindowIndex() + 1;
    // Reset events only: there is no window to fold into totals, so a summary
    // would be a promise with nothing behind it. The lifetime is dropped, and
    // counted, exactly as it was before summaries were retained.
    for (let index = 0; index <= 128; index++) emitResetEvent({ canvasId: `reset-only-${index}`, windowIndex, timestampMs: index, source: 'width-setter', dimensionChange: 'changed', width: index, height: 10, rasterOperationCount: 0, activeRasterOverlap: false, commandStatus: 'unknown', unknownReason: 'canvas-reset', flushedAtStop: false });
    const session = stopRecording()!;
    expect(session.canvases.some(canvas => canvas.canvasId === 'reset-only-0')).toBe(false);
    expect(session.droppedEntryCounts).toMatchObject({ canvasLifetimes: 1, resetEvents: 1 });
  });

  it('merges an evicted canvas with the windows it draws after eviction', () => {
    startRecording();
    publish(makeReport('returning'), 1);
    for (let index = 2; index <= 129; index++) publish(makeReport(`filler-${index}`), index);
    publish(makeReport('returning'), 130);
    const session = stopRecording()!;
    const returning = session.canvases.find(canvas => canvas.canvasId === 'returning')!;
    // One entry, not two: the evicted half and the live half are added
    // together, and the entry still says its frame detail is incomplete.
    expect(session.canvases.filter(canvas => canvas.canvasId === 'returning')).toHaveLength(1);
    expect(returning).toMatchObject({ activeWindowCount: 2, rasterOperationCount: 2, canvasApiSelfTimeMs: 1, windowDetailDropped: true });
    expect(session.windows.filter(window => window.canvasId === 'returning')).toHaveLength(1);
  });

  it('returns deep copies, JSON-only values, and JSON round trips', () => {
    startRecording(); publish(makeReport('canvas-a', 'same', { canvasApiSelfTimeMs: 8, methodEvidence: { fillRect: { count: 2, canvasApiSelfTimeMs: 8 } } }), 1); const stopped = stopRecording()!;
    stopped.windows[0].sourceLocation!.file = 'changed'; stopped.canvases[0].sourceLocation!.line = 99;
    stopped.canvases[0].commandStatuses.same = 99; stopped.browserFeatures.monotonicTime = false;
    stopped.windows[0].methodEvidence.fillRect.count = 99;
    stopped.canvases[0].methodEvidence.fillRect.count = 99;
    stopped.episodes[0].methodEvidence.fillRect.count = 99;
    stopped.episodes[0].canvases[0].methodEvidence.fillRect.count = 99;
    const stoppedFinding = stopped.findings.find(finding => finding.type === 'heavy-canvas-work')!;
    stoppedFinding.topMethods[0].count = 99;
    stoppedFinding.maximumWindow.methodEvidence.fillRect.count = 99;
    stoppedFinding.claimBoundary.observation = 'changed';
    (stopped.collectionLimits as { maxDurationMs: number }).maxDurationMs = 99;
    stopped.droppedEntryCounts.canvasWindowReports = 99;
    stopped.lifecycleEvents.push({ canvasId: 'changed', type: 'retired', windowIndex: 1, timestampMs: 1, connected: false, activeRegistrySize: 0, evidenceLevel: 'measured' });
    const one = getLastSession()!; const two = getLastSession()!;
    one.windows[0].sourceLocation!.file = 'changed again'; one.canvases[0].commandStatuses.same = 98; one.findings.find(finding => finding.type === 'heavy-canvas-work')!.topMethods[0].count = 98;
    expect(two.windows[0].canvasId).toBe('canvas-a'); expect(two.windows[0].sourceLocation?.file).toBe('/src/Chart.tsx');
    expect(two.canvases[0].sourceLocation?.line).toBe(4); expect(two.canvases[0].commandStatuses.same).toBe(1);
    expect(two.windows[0].methodEvidence.fillRect.count).toBe(2); expect(two.canvases[0].methodEvidence.fillRect.count).toBe(2);
    expect(two.episodes[0].methodEvidence.fillRect.count).toBe(2); expect(two.episodes[0].canvases[0].methodEvidence.fillRect.count).toBe(2);
    const copiedFinding = two.findings.find(finding => finding.type === 'heavy-canvas-work')!;
    expect(copiedFinding.topMethods[0].count).toBe(2); expect(copiedFinding.maximumWindow.methodEvidence.fillRect.count).toBe(2);
    expect(copiedFinding.claimBoundary.observation).toMatch(/measured Canvas2D API self-time/);
    expect(two.browserFeatures.monotonicTime).toBe(true); expect(two.collectionLimits.maxDurationMs).toBe(30000);
    expect(two.droppedEntryCounts.canvasWindowReports).toBe(0);
    expect(two.lifecycleEvents).toEqual([]);
    expect(JSON.parse(JSON.stringify(two))).toEqual(two);
    const plain = (value: unknown): boolean => value === null || ['string', 'number', 'boolean'].includes(typeof value) || (Array.isArray(value) && value.every(plain)) || (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(plain));
    expect(plain(two)).toBe(true);
  });

  it('deep-copies repeated-work evidence', () => {
    startRecording();
    publish(makeReport('repeated', 'same', { rasterOperationCount: 2, canvasApiSelfTimeMs: 1 }), 1);
    const session = stopRecording()!;
    const finding = session.findings.find(finding => finding.type === 'repeated-draw-work')!;
    finding.repeatedWindows[0].rasterOperationCount = 99;
    finding.unknownCoverage.activeWindowCount = 99;
    finding.claimBoundary.observation = 'changed';
    const copied = getLastSession()!.findings.find(finding => finding.type === 'repeated-draw-work')!;
    expect(copied.repeatedWindows[0].rasterOperationCount).toBe(2);
    expect(copied.unknownCoverage.activeWindowCount).toBe(1);
    expect(copied.claimBoundary.observation).toContain('repeated commands');
  });

  it('derives canvas and episode sums only from retained windows', () => {
    startRecording();
    publish(makeReport('a', 'same', { rasterOperationCount: 2, canvasApiSelfTimeMs: 1.25, methodEvidence: { fillRect: { count: 2, canvasApiSelfTimeMs: 1.25 } } }), 1);
    publish(makeReport('b', 'same', { rasterOperationCount: 3, canvasApiSelfTimeMs: 2, methodEvidence: { stroke: { count: 1, canvasApiSelfTimeMs: 2 } } }), 1);
    publish(makeReport('a', 'same', { rasterOperationCount: 1, canvasApiSelfTimeMs: 0.75, methodEvidence: { fillRect: { count: 1, canvasApiSelfTimeMs: 0.75 } } }), 3);
    const session = stopRecording()!;
    const canvasA = session.canvases.find(canvas => canvas.canvasId === 'a')!;
    expect(canvasA).toMatchObject({ activeWindowCount: 2, rasterOperationCount: 3, canvasApiSelfTimeMs: 2, maxWindowSelfTimeMs: 1.25, methodEvidence: { fillRect: { count: 3, canvasApiSelfTimeMs: 2 } } });
    expect(session.episodes).toHaveLength(1);
    expect(session.episodes[0]).toMatchObject({ activeWindowCount: 2, rasterOperationCount: 6, canvasApiSelfTimeMs: 4, methodEvidence: { fillRect: { count: 3, canvasApiSelfTimeMs: 2 }, stroke: { count: 1, canvasApiSelfTimeMs: 2 } } });
    expect(session.episodes[0].canvases.find(canvas => canvas.canvasId === 'a')).toEqual({ canvasId: 'a', activeWindowCount: 2, rasterOperationCount: 3, canvasApiSelfTimeMs: 2, maxWindowSelfTimeMs: 1.25, methodEvidence: { fillRect: { count: 3, canvasApiSelfTimeMs: 2 } }, resetEventCount: 0 });
  });

  it('ranks canvases by total, maximum window, raster operations, and stable id', () => {
    startRecording();
    publish(makeReport('beta', 'same', { canvasApiSelfTimeMs: 2 }), 1); publish(makeReport('beta', 'same', { canvasApiSelfTimeMs: 2 }), 2);
    publish(makeReport('alpha', 'same', { canvasApiSelfTimeMs: 2 }), 3); publish(makeReport('alpha', 'same', { canvasApiSelfTimeMs: 2 }), 4);
    publish(makeReport('raster', 'same', { canvasApiSelfTimeMs: 2, rasterOperationCount: 9 }), 5); publish(makeReport('raster', 'same', { canvasApiSelfTimeMs: 2, rasterOperationCount: 0 }), 6);
    publish(makeReport('max', 'same', { canvasApiSelfTimeMs: 3 }), 7); publish(makeReport('max', 'same', { canvasApiSelfTimeMs: 1 }), 8);
    publish(makeReport('total', 'same', { canvasApiSelfTimeMs: 5 }), 9);
    expect(stopRecording()!.canvases.map(canvas => canvas.canvasId)).toEqual(['total', 'max', 'raster', 'alpha', 'beta']);
  });

  it('preserves source order when every canvas-summary sort key compares equal', () => {
    startRecording();
    publish(makeReport('é', 'same', { canvasApiSelfTimeMs: 2, rasterOperationCount: 2 }), 1);
    publish(makeReport('é', 'same', { canvasApiSelfTimeMs: 2, rasterOperationCount: 2 }), 2);
    expect('é'.localeCompare('é')).toBe(0);
    expect(stopRecording()!.canvases.map(canvas => canvas.canvasId)).toEqual(['é', 'é']);
  });

  it('preserves command evidence from publication without mutation', () => {
    startRecording(); const reports = [makeReport('a', 'same'), makeReport('b', 'changed', { sampled: true, comparisonGap: 2 }), makeReport('c', 'unknown', { unknownReason: 'canvas-reset' })];
    reports.forEach((report, index) => publish(report, index + 1)); const session = stopRecording()!;
    expect(session.windows.map(({ signatureStatus, unknownReason, sampled, comparisonGap }) => ({ signatureStatus, unknownReason, sampled, comparisonGap }))).toEqual(reports.map(({ signatureStatus, unknownReason, sampled, comparisonGap }) => ({ signatureStatus, unknownReason, sampled, comparisonGap })));
  });
});
