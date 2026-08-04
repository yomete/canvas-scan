import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emitReport } from '../src/frame-loop';
import { getLastSession, getRecordingState, resetRecordingForTests, startRecording, stopRecording } from '../src/recording';
import type { DrawBatchReport } from '../src/types';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/v04-02-session-v1.json', import.meta.url), 'utf8'));
const makeReport = (canvasId = 'canvas-a', status: DrawBatchReport['signatureStatus'] = 'same', overrides: Partial<DrawBatchReport> = {}): DrawBatchReport => ({
  canvasId, nearestReactOwner: canvasId === 'canvas-a' ? 'Chart' : null,
  attributionKind: canvasId === 'canvas-a' ? 'jsx-owner' : 'unattributed',
  sourceLocation: canvasId === 'canvas-a' ? { file: '/src/Chart.tsx', line: 4, column: 2 } : null,
  rasterOperationCount: 1, canvasApiSelfTimeMs: 0.5, signatureStatus: status,
  unknownReason: status === 'unknown' ? 'first-window' : null, sampled: false,
  comparisonGap: status === 'unknown' ? null : 1, ...overrides,
});
const publish = (report: DrawBatchReport, index: number) => emitReport(report, {}, { windowIndex: index, timestampMs: index * 100 });

afterEach(() => { resetRecordingForTests(); vi.useRealTimers(); vi.restoreAllMocks(); });

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

  it('keeps FIFO published metadata and evicts whole reports at 10000', () => {
    startRecording(); for (let index = 1; index <= 10001; index++) publish(makeReport('one'), index);
    const session = stopRecording()!;
    expect(session.windows).toHaveLength(10000); expect(session.windows[0].windowIndex).toBe(2);
    expect(session.windows.at(-1)?.timestampMs).toBe(1000100);
    expect(session.droppedEntryCounts.canvasWindowReports).toBe(1);
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
    expect(session.canvases).toHaveLength(128); expect(session.canvases[0].canvasId).toBe('canvas-2');
    expect(session.canvases.at(-1)?.canvasId).toBe('canvas-0');
    expect(session.windows.every(window => session.canvases.some(canvas => canvas.canvasId === window.canvasId))).toBe(true);
    expect(session.droppedEntryCounts.canvasLifetimes).toBe(2);
  });

  it('returns deep copies, JSON-only values, and JSON round trips', () => {
    startRecording(); publish(makeReport(), 1); const stopped = stopRecording()!;
    stopped.windows[0].sourceLocation!.file = 'changed'; stopped.canvases[0].sourceLocation!.line = 99;
    stopped.canvases[0].commandStatuses.same = 99; stopped.browserFeatures.monotonicTime = false;
    (stopped.collectionLimits as { maxDurationMs: number }).maxDurationMs = 99;
    stopped.droppedEntryCounts.canvasWindowReports = 99;
    const one = getLastSession()!; const two = getLastSession()!;
    one.windows[0].sourceLocation!.file = 'changed again'; one.canvases[0].commandStatuses.same = 98;
    expect(two.windows[0].canvasId).toBe('canvas-a'); expect(two.windows[0].sourceLocation?.file).toBe('/src/Chart.tsx');
    expect(two.canvases[0].sourceLocation?.line).toBe(4); expect(two.canvases[0].commandStatuses.same).toBe(1);
    expect(two.browserFeatures.monotonicTime).toBe(true); expect(two.collectionLimits.maxDurationMs).toBe(30000);
    expect(two.droppedEntryCounts.canvasWindowReports).toBe(0);
    expect(JSON.parse(JSON.stringify(two))).toEqual(two);
    const plain = (value: unknown): boolean => value === null || ['string', 'number', 'boolean'].includes(typeof value) || (Array.isArray(value) && value.every(plain)) || (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(plain));
    expect(plain(two)).toBe(true);
  });

  it('preserves command evidence from publication without mutation', () => {
    startRecording(); const reports = [makeReport('a', 'same'), makeReport('b', 'changed', { sampled: true, comparisonGap: 2 }), makeReport('c', 'unknown', { unknownReason: 'canvas-reset' })];
    reports.forEach((report, index) => publish(report, index + 1)); const session = stopRecording()!;
    expect(session.windows.map(({ signatureStatus, unknownReason, sampled, comparisonGap }) => ({ signatureStatus, unknownReason, sampled, comparisonGap }))).toEqual(reports.map(({ signatureStatus, unknownReason, sampled, comparisonGap }) => ({ signatureStatus, unknownReason, sampled, comparisonGap })));
  });
});
