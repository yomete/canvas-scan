import { describe, expect, it, vi } from 'vitest';

import {
  emitReport,
  getHistory,
  latestReports,
  processRecord,
  setSourceLocation,
  startFrameLoop,
  subscribeToReports,
} from '../src/frame-loop';
import { getReports } from '../src/index';
import type { DrawBatchReport } from '../src/types';
import { records, type CanvasRecord } from '../src/wrap-context';

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
      ].sort(),
    );
    expect(processed?.report.sourceLocation).toBeNull();
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
