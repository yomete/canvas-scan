import { describe, expect, it, vi } from 'vitest';

import {
  emitReport,
  processRecord,
  subscribeToReports,
} from '../src/frame-loop';
import type { DrawBatchReport } from '../src/types';
import type { CanvasRecord } from '../src/wrap-context';

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
    serial: 1,
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
    pathHash: 0x811c9dc5,
    pathUnknown: false,
    clipHash: 0x811c9dc5,
    clipUnknown: false,
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
