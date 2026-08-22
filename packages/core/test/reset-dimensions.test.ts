import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emitReport, emitResetEvent, processRecordWithResetEvents } from '../src/frame-loop';
import { startRecording, stopRecording } from '../src/recording';
import {
  drainAttributeRecords,
  getRecord,
  installCanvasPatch,
  setMethodEvidenceCollectionEnabled,
  setResetEventCollectionEnabled,
} from '../src/wrap-context';
import type { CanvasRecord } from '../src/wrap-context';
import type { DrawBatchReport, RecordedResetEvent } from '../src/types';

// Mutation falsifiability: every classification branch below is pinned by an
// exact dimensionChange assertion — 'unchanged' (tests 1, 4, 5a), 'changed'
// (tests 2, 5b), 'unavailable' (test 3 and both oldValue cases in test 5c).
// Flipping any branch in recordResetEvent fails at least one assertion here.

class FakeContext {
  fillRect(..._args: unknown[]) {}
  reset() {}
}

const queuedMutationRecords: MutationRecord[] = [];

class FakeCanvas {
  private context: FakeContext | null = null;
  widthValue = 300;
  heightValue = 150;
  throwOnWidthRead = false;

  get width(): number {
    if (this.throwOnWidthRead) throw new Error('width unavailable');
    return this.widthValue;
  }

  set width(value: number) {
    this.widthValue = value;
  }

  get height(): number {
    return this.heightValue;
  }

  set height(value: number) {
    this.heightValue = value;
  }

  getAttribute(_name: string) {
    return null;
  }

  setAttribute(name: string, value: unknown) {
    const attribute = String(name).toLowerCase();
    if (attribute === 'width') this.widthValue = Number(value);
    else if (attribute === 'height') this.heightValue = Number(value);
  }

  getContext(type: string) {
    if (type !== '2d') return null;
    this.context ??= new FakeContext();
    return this.context;
  }
}

installCanvasPatch({
  canvasProto: FakeCanvas.prototype,
  contextProto: FakeContext.prototype,
  attributeObserver: { observe() {}, takeRecords: () => queuedMutationRecords.splice(0) },
});

function makeCanvas() {
  const canvas = new FakeCanvas();
  const context = canvas.getContext('2d')!;
  const record = getRecord(canvas)!;
  record.attribution = {
    nearestReactOwner: 'Fake',
    attributionKind: 'jsx-owner',
  };
  return { canvas, context, record };
}

function flush(record: CanvasRecord, events: RecordedResetEvent[], windowIndex: number) {
  return processRecordWithResetEvents(record, windowIndex, 1, events)?.report;
}

beforeEach(() => {
  setMethodEvidenceCollectionEnabled(false);
  setResetEventCollectionEnabled(true);
});

afterEach(() => {
  queuedMutationRecords.length = 0;
  setResetEventCollectionEnabled(false);
});

describe('reset dimension classification', () => {
  it("classifies a same-value width assignment as 'unchanged'", () => {
    const { canvas, context, record } = makeCanvas();
    const events: RecordedResetEvent[] = [];

    context.fillRect(0, 0, 10, 10);
    canvas.width = canvas.width;
    flush(record, events, 1);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'width-setter',
      width: 300,
      height: 150,
      activeRasterOverlap: true,
    });
    expect(events[0].dimensionChange).toEqual('unchanged');
  });

  it("classifies a real width change as 'changed'", () => {
    const { canvas, context, record } = makeCanvas();
    const events: RecordedResetEvent[] = [];

    context.fillRect(0, 0, 10, 10);
    canvas.width = 400;
    flush(record, events, 1);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'width-setter',
      width: 400,
      height: 150,
    });
    expect(events[0].dimensionChange).toEqual('changed');
  });

  it("classifies an unreadable dimension as 'unavailable' instead of guessing", () => {
    const { canvas, context, record } = makeCanvas();
    const events: RecordedResetEvent[] = [];

    context.fillRect(0, 0, 10, 10);
    canvas.throwOnWidthRead = true;
    canvas.width = 300;
    flush(record, events, 1);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'width-setter',
      width: null,
      height: 150,
    });
    expect(events[0].dimensionChange).toEqual('unavailable');
  });

  it("classifies a context reset as definitionally 'unchanged'", () => {
    const { canvas, context, record } = makeCanvas();
    const events: RecordedResetEvent[] = [];

    context.fillRect(0, 0, 10, 10);
    context.reset();
    flush(record, events, 1);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'context-reset',
      width: 300,
      height: 150,
    });
    expect(events[0].dimensionChange).toEqual('unchanged');
  });

  it("classifies attribute writes through the setter path and the late observer path", () => {
    const { canvas, context, record } = makeCanvas();
    const events: RecordedResetEvent[] = [];

    context.fillRect(0, 0, 10, 10);
    canvas.setAttribute('width', String(canvas.width));
    canvas.setAttribute('width', '400');
    flush(record, events, 1);

    expect(events.map(event => [event.source, event.dimensionChange])).toEqual([
      ['width-attribute', 'unchanged'],
      ['width-attribute', 'changed'],
    ]);
  });

  it("parses the observed oldValue for late attribute resets, or reports 'unavailable'", () => {
    const { canvas, record } = makeCanvas();
    const events: RecordedResetEvent[] = [];

    canvas.widthValue = 320;
    queuedMutationRecords.push({ type: 'attributes', target: canvas as unknown as Node, attributeName: 'width', oldValue: '300' } as MutationRecord);
    drainAttributeRecords();
    processRecordWithResetEvents(record, 1, 1, events);
    expect(events[0]).toMatchObject({ source: 'width-attribute', width: 320, height: 150 });
    expect(events[0].dimensionChange).toEqual('changed');

    canvas.widthValue = 320;
    queuedMutationRecords.push({ type: 'attributes', target: canvas as unknown as Node, attributeName: 'width', oldValue: '320' } as MutationRecord);
    drainAttributeRecords();
    processRecordWithResetEvents(record, 2, 1, events);
    expect(events[1].dimensionChange).toEqual('unchanged');

    canvas.widthValue = 340;
    queuedMutationRecords.push({ type: 'attributes', target: canvas as unknown as Node, attributeName: 'height', oldValue: null } as MutationRecord);
    drainAttributeRecords();
    processRecordWithResetEvents(record, 3, 1, events);
    expect(events[2].source).toBe('height-attribute');
    expect(events[2].dimensionChange).toEqual('unavailable');
  });

  it('tallies session-level dimension changes over qualifying resets', () => {
    const report = (windowIndex: number): DrawBatchReport => ({
      canvasId: 'tally',
      nearestReactOwner: null,
      attributionKind: 'unattributed',
      sourceLocation: null,
      rasterOperationCount: 4,
      canvasApiSelfTimeMs: 1,
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
      sampled: false,
      comparisonGap: null,
      followsCanvasReset: true,
      methodEvidence: {},
    });
    startRecording();
    emitReport(report(1), {}, { windowIndex: 1, timestampMs: 10 });
    emitResetEvent({ canvasId: 'tally', windowIndex: 1, timestampMs: 10, source: 'width-setter', dimensionChange: 'unchanged', width: 240, height: 120, rasterOperationCount: 4, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset' });
    emitReport(report(2), {}, { windowIndex: 2, timestampMs: 20 });
    emitResetEvent({ canvasId: 'tally', windowIndex: 2, timestampMs: 20, source: 'height-setter', dimensionChange: 'changed', width: 240, height: 120, rasterOperationCount: 4, activeRasterOverlap: true, commandStatus: 'unknown', unknownReason: 'canvas-reset' });
    const session = stopRecording()!;
    const finding = session.findings.find(item => item.type === 'resize-churn');
    expect(finding?.dimensionChanges).toEqual({ changed: 1, unchanged: 1, unavailable: 0 });
    expect(finding?.activeResetCount).toBe(finding!.dimensionChanges.changed + finding!.dimensionChanges.unchanged + finding!.dimensionChanges.unavailable);
  });
});
