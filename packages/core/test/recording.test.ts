import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emitLifecycleEvent, emitReport, emitResetEvent, getCurrentWindowIndex } from '../src/frame-loop';
import { getLastSession, getRecordingState, resetRecordingForTests, startRecording, stopRecording } from '../src/recording';
import type { DrawBatchReport } from '../src/types';
import { getResetEvents, records, type CanvasRecord } from '../src/wrap-context';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/v04-02-session-v1.json', import.meta.url), 'utf8'));
const makeReport = (canvasId = 'canvas-a', status: DrawBatchReport['signatureStatus'] = 'same', overrides: Partial<DrawBatchReport> = {}): DrawBatchReport => ({
  canvasId, nearestReactOwner: canvasId === 'canvas-a' ? 'Chart' : null,
  attributionKind: canvasId === 'canvas-a' ? 'jsx-owner' : 'unattributed',
  sourceLocation: canvasId === 'canvas-a' ? { file: '/src/Chart.tsx', line: 4, column: 2 } : null,
  rasterOperationCount: 1, canvasApiSelfTimeMs: 0.5, signatureStatus: status,
  unknownReason: status === 'unknown' ? 'first-window' : null, sampled: false,
  comparisonGap: status === 'unknown' ? null : 1, methodEvidence: {}, ...overrides,
});
const publish = (report: DrawBatchReport, index: number) => emitReport(report, {}, { windowIndex: index, timestampMs: index * 100 });
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

  it('reads geometry only for reports during recording and deep-copies it', () => {
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' })); vi.stubGlobal('devicePixelRatio', 2);
    const rect = vi.fn(() => ({ width: 240, height: 120 }));
    const canvas = { isConnected: true, width: 480, height: 240, getBoundingClientRect: rect };
    publish(makeReport('geometry'), 1);
    expect(rect).not.toHaveBeenCalled();
    startRecording();
    emitReport(makeReport('geometry'), canvas, { windowIndex: 3, timestampMs: 300 });
    const stopped = stopRecording()!;
    expect(rect).toHaveBeenCalledTimes(1);
    stopped.windows[0].geometry.backingWidth = 1;
    expect(getLastSession()!.windows[0].geometry.backingWidth).toBe(480);
    emitReport(makeReport('geometry'), canvas, { windowIndex: 4, timestampMs: 400 });
    expect(rect).toHaveBeenCalledTimes(1);
  });

  it('keeps reset-only events and deep-copies them from stopped sessions', () => {
    startRecording();
    const firstWindowIndex = getCurrentWindowIndex() + 1;
    publish(makeReport('reset', 'unknown', { rasterOperationCount: 2, unknownReason: 'canvas-reset' }), firstWindowIndex);
    emitResetEvent({ canvasId: 'reset', windowIndex: firstWindowIndex, timestampMs: 10, source: 'width-setter', width: 300, height: 150, rasterOperationCount: 2, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset' });
    emitResetEvent({ canvasId: 'reset', windowIndex: firstWindowIndex, timestampMs: 10, source: 'height-setter', width: 300, height: 150, rasterOperationCount: 2, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset' });
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
    expect(storedFinding?.commandStatuses.unknown).toBe(1);
    expect(storedFinding?.unknownReasons['canvas-reset']).toBe(1);
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
    emitResetEvent({ canvasId: 'outside', windowIndex: nextWindowIndex, timestampMs: 5, source: 'width-setter', width: 10, height: 10, rasterOperationCount: 0, activeRasterOverlap: false, commandStatus: 'unknown', unknownReason: 'canvas-reset' });
    startRecording();
    emitResetEvent({ canvasId: 'inside', windowIndex: nextWindowIndex, timestampMs: 10, source: 'height-setter', width: 10, height: 20, rasterOperationCount: 0, activeRasterOverlap: false, commandStatus: 'unknown', unknownReason: 'canvas-reset' });
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
      for (const source of ['width-setter', 'height-setter'] as const) emitResetEvent({ canvasId: 'partial-reset', windowIndex: firstWindowIndex, timestampMs: 10, source, width: 300, height: 150, rasterOperationCount: 3, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset' });
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
    startRecording(); for (let index = 1; index <= 10001; index++) publish(makeReport('one'), index);
    const session = stopRecording()!;
    expect(session.windows).toHaveLength(10000); expect(session.windows[0].windowIndex).toBe(2);
    expect(session.windows.at(-1)?.timestampMs).toBe(1000100);
    expect(session.droppedEntryCounts.canvasWindowReports).toBe(1);
  });

  it('keeps 10000 reset events in FIFO order and counts the removed event', () => {
    startRecording();
    const windowIndex = getCurrentWindowIndex() + 1;
    for (let index = 0; index <= 10000; index++) emitResetEvent({ canvasId: 'reset-fifo', windowIndex, timestampMs: index, source: 'width-setter', width: index, height: 10, rasterOperationCount: 0, activeRasterOverlap: false, commandStatus: 'unknown', unknownReason: 'canvas-reset' });
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
    for (let index = 0; index <= 128; index++) emitResetEvent({ canvasId: `reset-${index}`, windowIndex, timestampMs: index, source: 'width-setter', width: index, height: 10, rasterOperationCount: 0, activeRasterOverlap: false, commandStatus: 'unknown', unknownReason: 'canvas-reset' });
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
    const emit = (canvasId: string, timestampMs: number) => emitResetEvent({ canvasId, windowIndex, timestampMs, source: 'width-setter', width: 10, height: 10, rasterOperationCount: 0, activeRasterOverlap: false, commandStatus: 'unknown', unknownReason: 'canvas-reset' });
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
      getResetEvents(record).push({ source: 'width-setter', width: 300, height: 150 });
      getResetEvents(record).push({ source: 'height-setter', width: 300, height: 150 });
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

  it('evicts whole canvas lifetimes and treats re-entry as new', () => {
    startRecording(); for (let index = 0; index < 129; index++) publish(makeReport(`canvas-${index}`), index);
    publish(makeReport('canvas-0'), 130); const session = stopRecording()!;
    expect(session.canvases).toHaveLength(128); expect(session.canvases[0].canvasId).toBe('canvas-0');
    expect(session.windows.every(window => session.canvases.some(canvas => canvas.canvasId === window.canvasId))).toBe(true);
    expect(session.droppedEntryCounts.canvasLifetimes).toBe(2);
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

  it('preserves command evidence from publication without mutation', () => {
    startRecording(); const reports = [makeReport('a', 'same'), makeReport('b', 'changed', { sampled: true, comparisonGap: 2 }), makeReport('c', 'unknown', { unknownReason: 'canvas-reset' })];
    reports.forEach((report, index) => publish(report, index + 1)); const session = stopRecording()!;
    expect(session.windows.map(({ signatureStatus, unknownReason, sampled, comparisonGap }) => ({ signatureStatus, unknownReason, sampled, comparisonGap }))).toEqual(reports.map(({ signatureStatus, unknownReason, sampled, comparisonGap }) => ({ signatureStatus, unknownReason, sampled, comparisonGap })));
  });
});
