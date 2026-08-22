import { describe, expect, it, vi } from 'vitest';

import {
  emitReport,
  getCurrentWindowIndex,
  getHistory,
  INACTIVE_BOUNDARIES_BEFORE_RETIREMENT,
  latestReports,
  processRecord,
  processRecordWithResetEvents,
  setSourceLocation,
  startFrameLoop,
  subscribeToLifecycleEvents,
  subscribeToResetEvents,
  subscribeToReports,
} from '../src/frame-loop';
import { getReports } from '../src/index';
import { getLastSession, resetRecordingForTests, startRecording, stopRecording } from '../src/recording';
import type { DrawBatchReport } from '../src/types';
import {
  getMethodEvidence,
  getResetEvents,
  reactivateRecord,
  records,
  setMethodEvidenceCollectionEnabled,
  setResetEventCollectionEnabled,
  type CanvasRecord,
} from '../src/wrap-context';

let nextSerial = 0;

function makeRecord(overrides: Partial<CanvasRecord> = {}): CanvasRecord {
  return {
    canvas: {},
    contentDirty: false,
    contentSig: {
      hash: 0x811c9dc5,
      unknown: false,
      opCount: 0,
      unknownReason: null,
    },
    contentVersion: 0,
    id: 'test-canvas',
    serial: ++nextSerial,
    sig: {
      hash: 0x1234,
      unknown: false,
      opCount: 3,
      unknownReason: null,
    },
    rasterOps: 2,
    selfTimeMs: 0.5,
    activeInWindow: true,
    prev: null,
    attribution: {
      nearestReactOwner: 'Fake',
      attributionKind: 'jsx-owner',
    },
    lastStatus: null,
    props: new Map(),
    matrix: [1, 0, 0, 1, 0, 0],
    matrixUnknown: false,
    matrixHash: 0,
    pathHash: 0x811c9dc5,
    pathUnknown: false,
    clipHash: 0x811c9dc5,
    clipUnknown: false,
    resetPendingReason: null,
    modelUntrusted: false,
    resetVersion: 0,
    continuityLost: false,
    sourceResetVersions: new Map(),
    attributeObservationUnavailable: false,
    contextActivityInWindow: false,
    exactResetDepth: 0,
    inactiveBoundaries: 0,
    retired: false,
    lastConnected: false,
    activeLifecycleRecorded: false,
    pendingLifecycleEvents: [],
    stateStack: [],
    ...overrides,
  };
}

describe('processRecord', () => {
  it('leaves an inactive record completely untouched', () => {
    const record = makeRecord({ activeInWindow: false });
    const sig = record.sig;
    const prev = record.prev;
    const snapshot = { ...record };

    expect(processRecord(record, 1, 1)).toBeNull();
    expect(record).toEqual(snapshot);
    expect(record.sig).toBe(sig);
    expect(record.prev).toBe(prev);
  });

  it('processes the first captured window and resets accumulators', () => {
    const record = makeRecord();

    const processed = processRecord(record, 1, 1);

    expect(processed).toMatchObject({
      report: {
        signatureStatus: 'unknown',
        unknownReason: 'first-window',
        comparisonGap: null,
        sampled: false,
      },
      shouldLog: true,
    });
    expect(record.prev).toEqual({
      hash: 0x1234,
      unknown: false,
      windowIndex: 1,
    });
    expect(record.sig).toEqual({
      hash: 0x811c9dc5,
      unknown: false,
      opCount: 0,
      unknownReason: null,
    });
    expect(record.rasterOps).toBe(0);
    expect(record.selfTimeMs).toBe(0);
    expect(record.activeInWindow).toBe(false);
    expect(record.lastStatus).toBe('unknown');
  });

  it('publishes and clears method evidence but preserves it while inactive', () => {
    const record = makeRecord();
    setMethodEvidenceCollectionEnabled(true);
    try {
      getMethodEvidence(record).fillRect = { count: 2, canvasApiSelfTimeMs: 1.23456 };
      expect(processRecord(record, 1, 1)?.report.methodEvidence).toEqual({
        fillRect: { count: 2, canvasApiSelfTimeMs: 1.235 },
      });
      expect(getMethodEvidence(record)).toEqual({});

      getMethodEvidence(record).stroke = { count: 1, canvasApiSelfTimeMs: 0.5 };
      expect(processRecord(record, 2, 1)).toBeNull();
      expect(getMethodEvidence(record).stroke).toEqual({ count: 1, canvasApiSelfTimeMs: 0.5 });
    } finally {
      setMethodEvidenceCollectionEnabled(false);
    }
  });

  it('reuses frozen empty method evidence while collection is disabled', () => {
    setMethodEvidenceCollectionEnabled(false);
    const first = processRecord(makeRecord({ id: 'first' }), 1, 1)!.report.methodEvidence;
    const second = processRecord(makeRecord({ id: 'second' }), 1, 1)!.report.methodEvidence;

    expect(first).toBe(second);
    expect(first).toEqual({});
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('stamps captured and reset-only evidence without borrowing raster work from another window', () => {
    const record = makeRecord({ resetPendingReason: 'canvas-reset' });
    const events: import('../src/types').RecordedResetEvent[] = [];
    setResetEventCollectionEnabled(true);
    try {
      getResetEvents(record).push({ source: 'width-setter', width: 320, height: 150, dimensionChange: 'changed' });
      processRecordWithResetEvents(record, 4, 1, events);
      expect(events).toEqual([{
        canvasId: 'test-canvas', windowIndex: 4, timestampMs: 0,
        source: 'width-setter', width: 320, height: 150,
        rasterOperationCount: 2, activeRasterOverlap: true,
        commandStatus: 'unknown', unknownReason: 'canvas-reset',
        dimensionChange: 'changed',
      }]);

      record.activeInWindow = true;
      record.rasterOps = 0;
      record.resetPendingReason = 'canvas-reset';
      getResetEvents(record).push({ source: 'height-setter', width: 320, height: 180, dimensionChange: 'changed' });
      processRecordWithResetEvents(record, 5, 1, events);
      record.activeInWindow = true;
      record.rasterOps = 3;
      processRecordWithResetEvents(record, 6, 1, events);
      expect(events[1]).toMatchObject({
        windowIndex: 5, rasterOperationCount: 0, activeRasterOverlap: false,
      });
    } finally {
      setResetEventCollectionEnabled(false);
    }
  });

  it('keeps reset evidence from an uncaptured window while preserving the reset barrier', () => {
    const record = makeRecord({ rasterOps: 0, resetPendingReason: 'canvas-reset' });
    const events: import('../src/types').RecordedResetEvent[] = [];
    setResetEventCollectionEnabled(true);
    try {
      getResetEvents(record).push({ source: 'width-setter', width: 300, height: 150, dimensionChange: 'unchanged' });
      expect(processRecordWithResetEvents(record, 3, 2, events)).toBeNull();
      expect(events[0]).toMatchObject({
        windowIndex: 3, activeRasterOverlap: false,
        commandStatus: 'unknown', unknownReason: 'canvas-reset',
      });
      expect(record.resetPendingReason).toBe('canvas-reset');
    } finally {
      setResetEventCollectionEnabled(false);
    }
  });

  it("reports identical windows as 'same'", () => {
    const record = makeRecord({
      sig: {
        hash: 0x1234,
        unknown: false,
        opCount: 3,
        unknownReason: null,
      },
      prev: { hash: 0x1234, unknown: false, windowIndex: 5 },
    });

    const processed = processRecord(record, 6, 1);

    expect(processed?.report.signatureStatus).toBe('same');
    expect(processed?.report.unknownReason).toBeNull();
    expect(processed?.report.comparisonGap).toBe(1);
    expect(record.prev).toEqual({
      hash: 0x1234,
      unknown: false,
      windowIndex: 6,
    });
  });

  it("reports a different hash as 'changed'", () => {
    const record = makeRecord({
      prev: { hash: 0x5678, unknown: false, windowIndex: 5 },
    });

    const processed = processRecord(record, 6, 1);

    expect(processed?.report.signatureStatus).toBe('changed');
    expect(processed?.report.unknownReason).toBeNull();
    expect(record.lastStatus).toBe('changed');
  });

  it('widens comparisonGap across an idle gap', () => {
    const record = makeRecord({
      prev: { hash: 0x1234, unknown: false, windowIndex: 5 },
    });

    const processed = processRecord(record, 25, 1);

    expect(processed?.report.comparisonGap).toBe(20);
  });

  it("reports 'unknown' when the previous signature is unknown", () => {
    const record = makeRecord({
      prev: { hash: 0x1234, unknown: true, windowIndex: 5 },
    });

    const processed = processRecord(record, 6, 1);

    expect(processed?.report.signatureStatus).toBe('unknown');
    expect(processed?.report.unknownReason).toBe('previous-window');
  });

  it("reports and stores 'unknown' for an unknown current signature", () => {
    const record = makeRecord({
      sig: {
        hash: 0x1234,
        unknown: true,
        opCount: 3,
        unknownReason: 'test-reason',
      },
      prev: { hash: 0x1234, unknown: false, windowIndex: 5 },
    });

    const processed = processRecord(record, 6, 1);

    expect(processed?.report.signatureStatus).toBe('unknown');
    expect(processed?.report.unknownReason).toBe('test-reason');
    expect(record.prev).toEqual({
      hash: 0x1234,
      unknown: true,
      windowIndex: 6,
    });
  });

  it('logs the first status and subsequent status transitions only', () => {
    const record = makeRecord({
      prev: { hash: 0x1234, unknown: false, windowIndex: 5 },
    });

    expect(processRecord(record, 6, 1)?.shouldLog).toBe(true);

    record.sig = {
      hash: 0x1234,
      unknown: false,
      opCount: 3,
      unknownReason: null,
    };
    record.activeInWindow = true;
    expect(processRecord(record, 7, 1)?.shouldLog).toBe(false);

    record.sig = {
      hash: 0x5678,
      unknown: false,
      opCount: 3,
      unknownReason: null,
    };
    record.activeInWindow = true;
    expect(processRecord(record, 8, 1)?.shouldLog).toBe(true);
  });

  it('resets an uncaptured sampling window without advancing comparison state', () => {
    const prev = { hash: 0x5678, unknown: false, windowIndex: 3 };
    const record = makeRecord({
      prev,
      lastStatus: 'changed',
    });

    expect(processRecord(record, 4, 3)).toBeNull();
    expect(record.sig).toEqual({
      hash: 0x811c9dc5,
      unknown: false,
      opCount: 0,
      unknownReason: null,
    });
    expect(record.rasterOps).toBe(0);
    expect(record.selfTimeMs).toBe(0);
    expect(record.activeInWindow).toBe(false);
    expect(record.prev).toBe(prev);
    expect(record.lastStatus).toBe('changed');
  });

  it('uses the first captured window after lost raster continuity as a clean baseline', () => {
    const record = makeRecord({
      continuityLost: true,
      prev: { hash: 0x1234, unknown: false, windowIndex: 4 },
    });

    expect(processRecord(record, 6, 2)?.report).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'uncaptured-raster',
      comparisonGap: 2,
    });
    expect(record.continuityLost).toBe(false);

    record.sig = {
      hash: 0x1234,
      unknown: false,
      opCount: 3,
      unknownReason: null,
    };
    record.rasterOps = 2;
    record.activeInWindow = true;

    expect(processRecord(record, 8, 2)?.report).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
      comparisonGap: 2,
    });
  });

  it('produces a sampled report on a captured sampling window', () => {
    const record = makeRecord();

    const processed = processRecord(record, 6, 3);

    expect(processed?.report.sampled).toBe(true);
  });

  it('rounds canvas API self-time to three decimal places', () => {
    const record = makeRecord({ selfTimeMs: 1.23456 });

    const processed = processRecord(record, 1, 1);

    expect(processed?.report.canvasApiSelfTimeMs).toBe(1.235);
  });

  it('caches attributed owners and retries unattributed records', () => {
    const attribution = {
      nearestReactOwner: 'Fake',
      attributionKind: 'jsx-owner' as const,
    };
    const attributed = makeRecord({ attribution });

    const attributedReport = processRecord(attributed, 1, 1);

    expect(attributedReport?.report).toMatchObject(attribution);
    expect(attributed.attribution).toBe(attribution);

    const unattributed = makeRecord({ attribution: null });
    const firstReport = processRecord(unattributed, 1, 1);
    const firstAttribution = unattributed.attribution;

    expect(firstReport?.report.attributionKind).toBe('unattributed');

    unattributed.sig = {
      hash: 0x5678,
      unknown: false,
      opCount: 1,
      unknownReason: null,
    };
    unattributed.activeInWindow = true;
    const secondReport = processRecord(unattributed, 2, 1);

    expect(secondReport?.report.attributionKind).toBe('unattributed');
    expect(unattributed.attribution).not.toBe(firstAttribution);
  });

  it('returns exactly the complete report contract', () => {
    const record = makeRecord();

    const processed = processRecord(record, 1, 1);

    expect(Object.keys(processed!.report).sort()).toEqual(
      [
        'canvasId',
        'nearestReactOwner',
        'attributionKind',
        'sourceLocation',
        'rasterOperationCount',
        'canvasApiSelfTimeMs',
        'signatureStatus',
        'unknownReason',
        'sampled',
        'comparisonGap',
        'followsCanvasReset',
        'methodEvidence',
      ].sort(),
    );
    expect(processed?.report.sourceLocation).toBeNull();
  });

  it('tags windows that carry a reset barrier and leaves clean windows untagged', () => {
    const resetRecord = makeRecord({ resetPendingReason: 'canvas-reset' });
    expect(processRecord(resetRecord, 1, 1)?.report.followsCanvasReset).toBe(true);

    const cleanRecord = makeRecord();
    expect(processRecord(cleanRecord, 1, 1)?.report.followsCanvasReset).toBe(false);
  });

  it('republishes a source location without mutating the previous report', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: FrameRequestCallback) =>
        callbacks.push(callback),
    });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const record = makeRecord({ id: 'source-republish' });
    records.add(record);

    try {
      startFrameLoop({});
      callbacks.shift()!(0);
      const published = latestReports.get(record.id)!;
      const location = { file: '/src/Chart.tsx', line: 12, column: 4 };

      setSourceLocation(record.id, location);

      expect(published.sourceLocation).toBeNull();
      expect(latestReports.get(record.id)).not.toBe(published);
      expect(latestReports.get(record.id)?.sourceLocation).toEqual(location);
    } finally {
      records.delete(record);
      latestReports.delete(record.id);
      debug.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('carries a resolved source location into subsequent reports', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: FrameRequestCallback) =>
        callbacks.push(callback),
    });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const record = makeRecord({ id: 'source-subsequent' });
    records.add(record);

    try {
      startFrameLoop({});
      callbacks.shift()!(0);
      const location = { file: '/src/Chart.tsx', line: 18, column: 2 };
      setSourceLocation(record.id, location);

      record.activeInWindow = true;
      record.rasterOps = 2;
      callbacks.shift()!(1);

      expect(latestReports.get(record.id)?.sourceLocation).toEqual(location);
      expect(getHistory(record.id).at(-1)?.sourceLocation).toEqual(location);
    } finally {
      records.delete(record);
      latestReports.delete(record.id);
      debug.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('drains observer records before processing the affected animation-frame tick', async () => {
    class TickMutationObserver {
      static current: TickMutationObserver | null = null;
      private readonly observed = new Set<unknown>();
      private readonly records: MutationRecord[] = [];

      constructor(_callback: MutationCallback) {
        TickMutationObserver.current = this;
      }

      observe(target: unknown, _options: MutationObserverInit) {
        this.observed.add(target);
      }

      disconnect() {}

      takeRecords(): MutationRecord[] {
        return this.records.splice(0);
      }

      static queue(target: unknown, attributeName: string): void {
        const observer = TickMutationObserver.current;
        if (!observer?.observed.has(target)) return;
        observer.records.push({
          type: 'attributes',
          target: target as Node,
          attributeName,
        } as MutationRecord);
      }
    }

    class TickContext {
      fillRect(..._args: unknown[]) {}
    }

    class TickCanvas {
      private context: TickContext | null = null;

      get width() {
        return 300;
      }

      get height() {
        return 150;
      }

      getAttribute(_name: string) {
        return null;
      }

      setAttributeNS(
        _namespace: string | null,
        name: string,
        _value: unknown,
      ) {
        TickMutationObserver.queue(this, String(name).toLowerCase());
      }

      getContext(type: string) {
        if (type !== '2d') return null;
        this.context ??= new TickContext();
        return this.context;
      }
    }

    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('MutationObserver', TickMutationObserver);
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
    });
    vi.resetModules();
    const freshWrap = await import('../src/wrap-context');
    const freshFrameLoop = await import('../src/frame-loop');
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    let record: CanvasRecord | null = null;

    try {
      freshWrap.installCanvasPatch({
        canvasProto: TickCanvas.prototype,
        contextProto: TickContext.prototype,
      });
      const canvas = new TickCanvas();
      const context = canvas.getContext('2d')!;
      record = freshWrap.getRecord(canvas)!;
      record.attribution = {
        nearestReactOwner: 'Tick',
        attributionKind: 'jsx-owner',
      };
      freshFrameLoop.startFrameLoop({});

      context.fillRect();
      callbacks.shift()!(0);

      canvas.setAttributeNS(null, 'width', '300');
      context.fillRect();
      callbacks.shift()!(1);

      expect(freshFrameLoop.latestReports.get(record.id)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'canvas-attribute-reset',
      });

      context.fillRect();
      callbacks.shift()!(2);
      expect(freshFrameLoop.latestReports.get(record.id)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'canvas-state-unmodeled',
      });
    } finally {
      if (record) freshWrap.records.delete(record);
      debug.mockRestore();
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('processes every canvas before a synchronous report callback can reset a later canvas', async () => {
    class ReentrantMutationObserver {
      static current: ReentrantMutationObserver | null = null;
      private readonly observed = new Set<unknown>();
      private readonly records: MutationRecord[] = [];

      constructor(_callback: MutationCallback) {
        ReentrantMutationObserver.current = this;
      }

      observe(target: unknown, _options: MutationObserverInit) {
        this.observed.add(target);
      }

      disconnect() {}

      takeRecords(): MutationRecord[] {
        return this.records.splice(0);
      }

      static queue(target: unknown, attributeName: string): void {
        const observer = ReentrantMutationObserver.current;
        if (!observer?.observed.has(target)) return;
        observer.records.push({
          type: 'attributes',
          target: target as Node,
          attributeName,
        } as MutationRecord);
      }
    }

    class ReentrantContext {
      readonly paintedRects = new Set<string>();

      fillRect(...args: unknown[]) {
        this.paintedRects.add(args.join(','));
      }

      resetBitmap() {
        this.paintedRects.clear();
      }
    }

    class ReentrantCanvas {
      private context: ReentrantContext | null = null;

      get width() {
        return 300;
      }

      get height() {
        return 150;
      }

      getAttribute(_name: string) {
        return null;
      }

      setAttributeNS(
        _namespace: string | null,
        name: string,
        _value: unknown,
      ) {
        this.context?.resetBitmap();
        ReentrantMutationObserver.queue(this, String(name).toLowerCase());
      }

      getContext(type: string) {
        if (type !== '2d') return null;
        this.context ??= new ReentrantContext();
        return this.context;
      }
    }

    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('MutationObserver', ReentrantMutationObserver);
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
    });
    vi.resetModules();
    const freshWrap = await import('../src/wrap-context');
    const freshFrameLoop = await import('../src/frame-loop');
    let earlierCanvas: ReentrantCanvas | null = null;
    let laterCanvas: ReentrantCanvas | null = null;
    let earlierContext: ReentrantContext | null = null;
    let laterContext: ReentrantContext | null = null;
    let earlierRecord: CanvasRecord | null = null;
    let laterRecord: CanvasRecord | null = null;
    let callbackArmed = false;
    let callbackRuns = 0;
    let debug: { mockRestore(): void } | null = null;

    try {
      freshWrap.installCanvasPatch({
        canvasProto: ReentrantCanvas.prototype,
        contextProto: ReentrantContext.prototype,
      });
      earlierCanvas = new ReentrantCanvas();
      laterCanvas = new ReentrantCanvas();
      earlierContext = earlierCanvas.getContext('2d')!;
      laterContext = laterCanvas.getContext('2d')!;
      earlierRecord = freshWrap.getRecord(earlierCanvas)!;
      laterRecord = freshWrap.getRecord(laterCanvas)!;
      earlierRecord.attribution = {
        nearestReactOwner: 'Earlier',
        attributionKind: 'jsx-owner',
      };
      laterRecord.attribution = {
        nearestReactOwner: 'Later',
        attributionKind: 'jsx-owner',
      };
      expect([...freshWrap.records]).toEqual([earlierRecord, laterRecord]);
      debug = vi
        .spyOn(console, 'debug')
        .mockImplementation((...args: unknown[]) => {
          const report = args[1] as DrawBatchReport | undefined;
          if (
            callbackArmed &&
            callbackRuns === 0 &&
            report?.canvasId === earlierRecord?.id
          ) {
            callbackRuns++;
            laterCanvas!.setAttributeNS(null, 'width', '300');
            laterContext!.fillRect(20, 0, 10, 10);
          }
        });
      freshFrameLoop.startFrameLoop({});

      earlierContext.fillRect(0, 0, 10, 10);
      laterContext.fillRect(0, 0, 10, 10);
      laterContext.fillRect(20, 0, 10, 10);
      callbacks.shift()!(0);
      expect(laterContext.paintedRects).toEqual(
        new Set(['0,0,10,10', '20,0,10,10']),
      );

      callbackArmed = true;
      earlierContext.fillRect(0, 0, 10, 10);
      laterContext.fillRect(0, 0, 10, 10);
      callbacks.shift()!(1);

      expect(callbackRuns).toBe(1);
      expect(laterContext.paintedRects).toEqual(new Set(['20,0,10,10']));
      expect(freshFrameLoop.latestReports.get(laterRecord.id)).toMatchObject({
        signatureStatus: 'changed',
        unknownReason: null,
      });

      callbacks.shift()!(2);
      expect(freshFrameLoop.latestReports.get(laterRecord.id)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'canvas-attribute-reset',
      });
    } finally {
      if (earlierRecord) freshWrap.records.delete(earlierRecord);
      if (laterRecord) freshWrap.records.delete(laterRecord);
      debug?.mockRestore();
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

describe('report subscribers', () => {
  const report: DrawBatchReport = {
    canvasId: 'test-canvas',
    nearestReactOwner: 'Fake',
    attributionKind: 'jsx-owner',
    sourceLocation: null,
    rasterOperationCount: 2,
    canvasApiSelfTimeMs: 0.5,
    signatureStatus: 'same',
    unknownReason: null,
    sampled: false,
    comparisonGap: 1,
    followsCanvasReset: false,
    methodEvidence: {},
  };

  it('delivers reports until unsubscribed', () => {
    const canvas = {};
    const listener = vi.fn();
    const unsubscribe = subscribeToReports(listener);

    emitReport(report, canvas);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(report, canvas);

    unsubscribe();
    emitReport(report, canvas);

    expect(listener).toHaveBeenCalledOnce();
  });

  it('isolates stored method evidence from listener mutations', () => {
    const source = {
      ...report,
      methodEvidence: {
        fillRect: { count: 2, canvasApiSelfTimeMs: 0.5 },
      },
    };
    const listener = vi.fn((published: DrawBatchReport) => {
      published.methodEvidence.fillRect.count = 99;
    });
    const unsubscribe = subscribeToReports(listener);

    try {
      emitReport(source, {});

      expect(listener.mock.calls[0][0]).not.toBe(source);
      expect(source.methodEvidence.fillRect.count).toBe(2);
    } finally {
      unsubscribe();
    }
  });

  it('removes a throwing listener without interrupting other listeners', () => {
    const error = new Error('listener failed');
    const throwingListener = vi.fn(() => {
      throw error;
    });
    const listener = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unsubscribeThrowing = subscribeToReports(throwingListener);
    const unsubscribe = subscribeToReports(listener);

    emitReport(report, {});

    expect(throwingListener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      '[canvas-scan] report listener removed after error',
      error,
    );

    emitReport(report, {});

    expect(throwingListener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledOnce();

    unsubscribeThrowing();
    unsubscribe();
    warn.mockRestore();
  });
});

describe('published metadata', () => {
  it('uses frame-loop observation time and a stable window index', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => callbacks.push(callback) });
    let clock = 456.75; const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const record = makeRecord({ id: 'metadata' }); records.add(record);
    const listener = vi.fn(); const unsubscribe = subscribeToReports(listener);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      startFrameLoop({}); callbacks.shift()!(100);
      clock = 789.25; record.activeInWindow = true; callbacks.shift()!(200);
      const first = listener.mock.calls[0][2]; const second = listener.mock.calls[1][2];
      expect(Number.isInteger(first.windowIndex)).toBe(true);
      expect(first).toEqual({ windowIndex: first.windowIndex, timestampMs: 456.75 });
      expect(second).toEqual({ windowIndex: first.windowIndex + 1, timestampMs: 789.25 });
    } finally { unsubscribe(); records.delete(record); latestReports.delete(record.id); debug.mockRestore(); now.mockRestore(); vi.unstubAllGlobals(); }
  });

  it('uses the frame loop as the only recording clock and preserves a restarted boundary', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; } });
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const record = makeRecord({ id: 'recording-clock' });
    const metadata: Array<{ windowIndex: number; timestampMs: number; startedAtTimestampMs?: number; endedAtTimestampMs?: number }> = [];
    const restart = vi.fn(() => {
      stopRecording();
      clock = 30;
      startRecording();
    });
    const unsubscribe = subscribeToReports((_, __, value) => {
      if (value?.startedAtTimestampMs !== undefined) metadata.push(value);
      if (metadata.length === 2) restart();
    });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    records.add(record);
    try {
      startRecording();
      expect(callbacks).toHaveLength(0);
      startFrameLoop({});
      expect(callbacks).toHaveLength(1);
      clock = 10; callbacks.shift()!(1);
      clock = 20; record.activeInWindow = true;
      callbacks.shift()!(2);
      clock = 40; record.activeInWindow = true;
      callbacks.shift()!(3);
      expect(metadata[0]).toMatchObject({ startedAtTimestampMs: 0, endedAtTimestampMs: 10, timestampMs: 10 });
      expect(metadata[1]).toMatchObject({ startedAtTimestampMs: 10, endedAtTimestampMs: 20, timestampMs: 20 });
      expect(restart).toHaveBeenCalledOnce();
      expect(metadata[2]).toMatchObject({ startedAtTimestampMs: 30, endedAtTimestampMs: 40, timestampMs: 40 });
    } finally {
      unsubscribe();
      records.delete(record);
      latestReports.delete(record.id);
      resetRecordingForTests();
      debug.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('uses frame-loop observation time for reset evidence', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => callbacks.push(callback) });
    const now = vi.spyOn(performance, 'now').mockReturnValue(456.75);
    const record = makeRecord({ id: 'reset-metadata', resetPendingReason: 'canvas-reset' });
    const listener = vi.fn();
    const unsubscribe = subscribeToResetEvents(listener);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    records.add(record);
    setResetEventCollectionEnabled(true);
    getResetEvents(record).push({ source: 'width-setter', width: 300, height: 150, dimensionChange: 'unchanged' });
    try {
      startFrameLoop({});
      callbacks.shift()!(100);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        canvasId: 'reset-metadata', timestampMs: 456.75,
        rasterOperationCount: 2, activeRasterOverlap: true,
      }));
    } finally {
      unsubscribe();
      setResetEventCollectionEnabled(false);
      records.delete(record);
      latestReports.delete(record.id);
      debug.mockRestore();
      now.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('publishes reset evidence before a synchronous report listener stops recording', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => callbacks.push(callback) });
    const record = makeRecord({ id: 'stop-order', resetPendingReason: 'canvas-reset' });
    const stopOnReport = () => stopRecording();
    const unsubscribe = subscribeToReports(stopOnReport);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    let clock = 0; const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    records.add(record);
    startRecording();
    getResetEvents(record).push({ source: 'width-setter', width: 300, height: 150, dimensionChange: 'unchanged' });
    try {
      startFrameLoop({});
      clock = 10; callbacks.shift()!(1);
      callbacks.shift()!(2);
      expect(stopRecording()).toBeUndefined();
      expect(getLastSession()?.resetEvents).toMatchObject([{ canvasId: 'stop-order', timestampMs: 10 }]);
    } finally {
      unsubscribe();
      records.delete(record);
      resetRecordingForTests();
      debug.mockRestore();
      now.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('publishes lifecycle evidence before a synchronous report listener stops recording', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => callbacks.push(callback) });
    const record = makeRecord({
      id: 'lifecycle-stop-order',
      pendingLifecycleEvents: [{ type: 'first-observed', connected: false, activeRegistrySize: 1 }],
    });
    const stopOnReport = () => stopRecording();
    const unsubscribe = subscribeToReports(stopOnReport);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    let clock = 0; const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    records.add(record);
    startRecording();
    try {
      startFrameLoop({});
      clock = 10; callbacks.shift()!(1);
      callbacks.shift()!(2);
      expect(stopRecording()).toBeUndefined();
      expect(getLastSession()?.lifecycleEvents).toMatchObject([
        { canvasId: 'lifecycle-stop-order', type: 'first-observed', timestampMs: 10 },
      ]);
    } finally {
      unsubscribe();
      records.delete(record);
      resetRecordingForTests();
      debug.mockRestore();
      now.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('record lifecycle retirement', () => {
  it('retires an inactive record on exactly the 120th boundary', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => callbacks.push(callback) });
    const record = makeRecord({
      id: 'exact-retirement',
      canvas: { isConnected: true },
      activeInWindow: false,
      lastConnected: true,
    });
    const events: Array<{ type: string; windowIndex: number; activeRegistrySize: number }> = [];
    const unsubscribe = subscribeToLifecycleEvents(event => {
      if (event.canvasId === record.id) events.push(event);
    });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const startWindowIndex = getCurrentWindowIndex();
    records.add(record);

    try {
      startFrameLoop({});
      for (let boundary = 1; boundary < INACTIVE_BOUNDARIES_BEFORE_RETIREMENT; boundary++) {
        callbacks.shift()!(boundary);
      }
      expect(records.has(record)).toBe(true);
      expect(record.inactiveBoundaries).toBe(INACTIVE_BOUNDARIES_BEFORE_RETIREMENT - 1);

      callbacks.shift()!(INACTIVE_BOUNDARIES_BEFORE_RETIREMENT);
      expect(records.has(record)).toBe(false);
      expect(record.retired).toBe(true);
      expect(events).toMatchObject([
        {
          type: 'retired',
          windowIndex: startWindowIndex + INACTIVE_BOUNDARIES_BEFORE_RETIREMENT,
          activeRegistrySize: 0,
        },
      ]);
    } finally {
      unsubscribe();
      records.delete(record);
      debug.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('keeps a detached cache active when it draws before retirement', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => callbacks.push(callback) });
    const record = makeRecord({
      id: 'detached-active-cache',
      canvas: { isConnected: false },
      activeInWindow: true,
      inactiveBoundaries: INACTIVE_BOUNDARIES_BEFORE_RETIREMENT - 1,
      lastConnected: true,
    });
    const events: string[] = [];
    const unsubscribe = subscribeToLifecycleEvents(event => {
      if (event.canvasId === record.id) events.push(event.type);
    });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    records.add(record);

    try {
      startFrameLoop({});
      callbacks.shift()!(1);
      expect(records.has(record)).toBe(true);
      expect(record.inactiveBoundaries).toBe(0);
      callbacks.shift()!(2);
      expect(records.has(record)).toBe(true);
      expect(events.filter(type => type === 'detached')).toEqual(['detached']);
      expect(events).not.toContain('retired');
    } finally {
      unsubscribe();
      records.delete(record);
      latestReports.delete(record.id);
      debug.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('publishes detach before retirement with registry sizes from each transition', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => callbacks.push(callback) });
    const record = makeRecord({
      id: 'detach-then-retire',
      canvas: { isConnected: false },
      activeInWindow: false,
      inactiveBoundaries: INACTIVE_BOUNDARIES_BEFORE_RETIREMENT - 1,
      lastConnected: true,
    });
    const events: Array<{ type: string; activeRegistrySize: number }> = [];
    const unsubscribe = subscribeToLifecycleEvents(event => {
      if (event.canvasId === record.id) events.push(event);
    });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    records.add(record);

    try {
      startFrameLoop({});
      callbacks.shift()!(1);
      expect(events).toMatchObject([
        { type: 'detached', activeRegistrySize: 1 },
        { type: 'retired', activeRegistrySize: 0 },
      ]);
      expect(records.has(record)).toBe(false);
    } finally {
      unsubscribe();
      records.delete(record);
      debug.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('keeps the active registry bounded across repeated retire-reactivate cycles', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => callbacks.push(callback) });
    const record = makeRecord({
      id: 'repeated-lifecycle',
      canvas: { isConnected: false },
      activeInWindow: false,
      inactiveBoundaries: INACTIVE_BOUNDARIES_BEFORE_RETIREMENT - 1,
    });
    const id = record.id;
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    let timestamp = 0;
    records.add(record);

    try {
      startFrameLoop({});
      callbacks.shift()!(++timestamp);
      expect(records.has(record)).toBe(false);

      for (let cycle = 0; cycle < 3; cycle++) {
        expect(reactivateRecord(record)).toBe(true);
        record.activeInWindow = true;
        expect(records.size).toBe(1);
        callbacks.shift()!(++timestamp);
        for (let boundary = 0; boundary < INACTIVE_BOUNDARIES_BEFORE_RETIREMENT; boundary++) {
          callbacks.shift()!(++timestamp);
        }
        expect(records.has(record)).toBe(false);
        expect(record.id).toBe(id);
      }

      expect(records.size).toBe(0);
    } finally {
      records.delete(record);
      latestReports.delete(record.id);
      debug.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('report history', () => {
  it('caps each canvas history at 120 reports', () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('window', { requestAnimationFrame });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const record = makeRecord({ id: 'history-cap' });
    records.add(record);

    try {
      startFrameLoop({});

      for (let index = 0; index < 121; index++) {
        record.activeInWindow = true;
        record.rasterOps = index;
        callbacks.shift()!(index);
      }

      const history = getHistory(record.id);
      expect(history).toHaveLength(120);
      expect(history[0].rasterOperationCount).toBe(1);
      expect(history[119].rasterOperationCount).toBe(120);
    } finally {
      records.delete(record);
      debug.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('returns copies of a canvas history and its reports', () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('window', { requestAnimationFrame });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const record = makeRecord({ id: 'history-copy' });
    records.add(record);

    try {
      startFrameLoop({});
      callbacks.shift()!(0);

      const history = getHistory(record.id);
      history.length = 0;

      expect(getHistory(record.id)).toHaveLength(1);
      const report = getHistory(record.id)[0];
      report.rasterOperationCount = 99;
      expect(getHistory(record.id)[0].rasterOperationCount).toBe(2);
    } finally {
      records.delete(record);
      debug.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('keeps nested method evidence isolated from listeners and callers', () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: FrameRequestCallback) => callbacks.push(callback),
    });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const record = makeRecord({ id: 'method-copy' });
    const listener = vi.fn((report: DrawBatchReport) => {
      report.methodEvidence.fillRect.count = 99;
    });
    const unsubscribe = subscribeToReports(listener);
    records.add(record);
    setMethodEvidenceCollectionEnabled(true);

    try {
      getMethodEvidence(record).fillRect = { count: 2, canvasApiSelfTimeMs: 0.5 };
      startFrameLoop({});
      callbacks.shift()!(0);

      expect(listener).toHaveBeenCalledOnce();
      expect(latestReports.get(record.id)?.methodEvidence.fillRect.count).toBe(2);
      expect(getHistory(record.id)[0].methodEvidence.fillRect.count).toBe(2);

      getHistory(record.id)[0].methodEvidence.fillRect.count = 88;
      getReports()[record.id].methodEvidence.fillRect.count = 77;
      expect(getHistory(record.id)[0].methodEvidence.fillRect.count).toBe(2);
      expect(latestReports.get(record.id)?.methodEvidence.fillRect.count).toBe(2);
    } finally {
      unsubscribe();
      records.delete(record);
      latestReports.delete(record.id);
      setMethodEvidenceCollectionEnabled(false);
      debug.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('returns copies from getReports', () => {
    const report = makeRecord({ id: 'reports-copy' });
    const processed = processRecord(report, 1, 1)!.report;
    latestReports.set(report.id, processed);

    const reports = getReports();
    reports[report.id].rasterOperationCount = 99;

    expect(latestReports.get(report.id)?.rasterOperationCount).toBe(2);
    latestReports.delete(report.id);
  });

  it('keeps histories and source locations independent across canvas lifetimes', () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('window', { requestAnimationFrame });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const first = makeRecord({ id: 'shared-dom-id#1', rasterOps: 3 });
    const second = makeRecord({ id: 'shared-dom-id#2', rasterOps: 7 });
    records.add(first);
    records.add(second);

    try {
      startFrameLoop({});
      callbacks.shift()!(0);
      const firstLocation = {
        file: '/First.tsx',
        line: 1,
        column: 0,
      };
      const secondLocation = {
        file: '/Second.tsx',
        line: 2,
        column: 0,
      };
      setSourceLocation(first.id, firstLocation);
      setSourceLocation(second.id, secondLocation);

      first.activeInWindow = true;
      first.rasterOps = 4;
      second.activeInWindow = true;
      second.rasterOps = 8;
      callbacks.shift()!(1);

      expect(getHistory(first.id).map(report => report.rasterOperationCount))
        .toEqual([3, 4]);
      expect(getHistory(second.id).map(report => report.rasterOperationCount))
        .toEqual([7, 8]);
      expect(getHistory(first.id).map(report => report.sourceLocation))
        .toEqual([firstLocation, firstLocation]);
      expect(getHistory(second.id).map(report => report.sourceLocation))
        .toEqual([secondLocation, secondLocation]);
    } finally {
      records.delete(first);
      records.delete(second);
      latestReports.delete(first.id);
      latestReports.delete(second.id);
      debug.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('stamps a late source location onto history already recorded', () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('window', { requestAnimationFrame });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const record = makeRecord({ id: 'late-stamp' });
    records.add(record);

    try {
      startFrameLoop({});
      callbacks.shift()!(0);
      // The canvas stops drawing before the lookup resolves.
      setSourceLocation('late-stamp', {
        file: '/Late.tsx',
        line: 9,
        column: 0,
      });

      expect(getHistory('late-stamp').map(report => report.sourceLocation))
        .toEqual([{ file: '/Late.tsx', line: 9, column: 0 }]);
    } finally {
      records.delete(record);
      latestReports.delete('late-stamp');
      debug.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('hands out deep copies so a caller cannot rewrite a stored source', () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('window', { requestAnimationFrame });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const record = makeRecord({ id: 'deep-copy' });
    records.add(record);

    try {
      startFrameLoop({});
      callbacks.shift()!(0);
      setSourceLocation('deep-copy', { file: '/Real.tsx', line: 4, column: 0 });

      getHistory('deep-copy')[0].sourceLocation!.file = '/Hacked.tsx';
      getReports()['deep-copy'].sourceLocation!.line = 999;

      expect(getHistory('deep-copy')[0].sourceLocation).toEqual({
        file: '/Real.tsx',
        line: 4,
        column: 0,
      });
      expect(getReports()['deep-copy'].sourceLocation?.line).toBe(4);
    } finally {
      records.delete(record);
      latestReports.delete('deep-copy');
      debug.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('evicts history, latest report, and source together after 64 lifetimes', () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('window', { requestAnimationFrame });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const tracked = Array.from({ length: 65 }, (_, index) =>
      makeRecord({ id: `retention-${index}`, rasterOps: index }),
    );
    records.add(tracked[0]);

    try {
      startFrameLoop({});
      callbacks.shift()!(0);
      setSourceLocation(tracked[0].id, {
        file: '/Evicted.tsx',
        line: 1,
        column: 0,
      });
      for (const record of tracked.slice(1)) records.add(record);
      callbacks.shift()!(1);

      expect(getHistory(tracked[0].id)).toEqual([]);
      expect(latestReports.has(tracked[0].id)).toBe(false);
      expect(latestReports.has(tracked[0].id)).toBe(false);
      expect(getHistory(tracked[64].id)).toHaveLength(1);
      expect(latestReports.has(tracked[64].id)).toBe(true);
      expect(
        [...latestReports].filter(([id]) => id.startsWith('retention-')),
      ).toHaveLength(64);

      tracked[0].activeInWindow = true;
      tracked[0].rasterOps = 66;
      callbacks.shift()!(2);

      expect(getHistory(tracked[0].id)).toHaveLength(1);
      expect(latestReports.get(tracked[0].id)?.sourceLocation).toBeNull();
    } finally {
      for (const record of tracked) records.delete(record);
      debug.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('preserves sampled history order', () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('window', { requestAnimationFrame });
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const record = makeRecord({ id: 'sampled-history' });
    records.add(record);

    try {
      startFrameLoop({ captureEvery: 2 });
      for (let index = 1; index <= 4; index++) {
        record.activeInWindow = true;
        record.rasterOps = index;
        callbacks.shift()!(index);
      }

      const rasterOperationCounts = getHistory(record.id).map(
        report => report.rasterOperationCount,
      );
      expect(rasterOperationCounts).toHaveLength(2);
      expect(rasterOperationCounts[1]).toBe(rasterOperationCounts[0] + 2);
    } finally {
      records.delete(record);
      debug.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
