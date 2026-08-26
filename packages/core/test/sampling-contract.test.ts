import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processRecord, processRecordWithResetEvents } from '../src/frame-loop';
import {
  getRecord,
  getResetEvents,
  installCanvasPatch,
  setMethodEvidenceCollectionEnabled,
  setResetEventCollectionEnabled,
  setWindowCaptured,
} from '../src/wrap-context';
import type { CanvasRecord } from '../src/wrap-context';

class CanvasGradient {
  addColorStop(..._args: unknown[]) {}
}

class FakeContext {
  private fillStyleValue: unknown;

  get fillStyle() {
    return this.fillStyleValue;
  }

  set fillStyle(value: unknown) {
    this.fillStyleValue = value;
  }

  fillRect(..._args: unknown[]) {}
  translate(..._args: unknown[]) {}
  scale(..._args: unknown[]) {}
  setTransform(..._args: unknown[]) {}
  moveTo(..._args: unknown[]) {}
  lineTo(..._args: unknown[]) {}
  fill(..._args: unknown[]) {}
  reset() {}

  createLinearGradient(..._args: unknown[]) {
    return new CanvasGradient();
  }
}

class FakeCanvas {
  private context: FakeContext | null = null;
  private widthValue = 300;
  private heightValue = 150;

  get width() {
    return this.widthValue;
  }

  set width(value: number) {
    this.widthValue = value;
  }

  get height() {
    return this.heightValue;
  }

  set height(value: number) {
    this.heightValue = value;
  }

  getAttribute(_name: string) {
    return null;
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
  attributeObserver: { observe() {}, takeRecords: () => [] },
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

function finish(
  record: CanvasRecord,
  windowIndex: number,
) {
  return processRecord(record, windowIndex, 2)?.report;
}

beforeEach(() => {
  setMethodEvidenceCollectionEnabled(true);
  setResetEventCollectionEnabled(true);
  setWindowCaptured(true);
});

afterEach(() => {
  setMethodEvidenceCollectionEnabled(false);
  setResetEventCollectionEnabled(false);
});

describe('sampling contract', () => {
  it('classifies raster work on either side of a reset only in the same window', () => {
    const { canvas, context, record } = makeCanvas();
    const events: import('../src/types').RecordedResetEvent[] = [];

    context.fillRect(0, 0, 1, 1);
    canvas.width = canvas.width;
    expect(processRecordWithResetEvents(record, 2, 2, events)?.report).toMatchObject({
      signatureStatus: 'unknown', unknownReason: 'canvas-reset',
    });

    canvas.height = canvas.height;
    context.fillRect(0, 0, 1, 1);
    processRecordWithResetEvents(record, 4, 2, events);

    canvas.width = canvas.width;
    processRecordWithResetEvents(record, 6, 2, events);
    context.fillRect(0, 0, 1, 1);
    processRecordWithResetEvents(record, 8, 2, events);

    expect(events.map(event => ({ source: event.source, windowIndex: event.windowIndex, active: event.activeRasterOverlap }))).toEqual([
      { source: 'width-setter', windowIndex: 2, active: true },
      { source: 'height-setter', windowIndex: 4, active: true },
      { source: 'width-setter', windowIndex: 6, active: false },
    ]);
    expect(getResetEvents(record)).toEqual([]);
  });

  it('uses two clock reads when captured and none when uncaptured', () => {
    const { context } = makeCanvas();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1);
    context.fillRect(0, 0, 1, 1);
    expect(clock).toHaveBeenCalledTimes(2);
    clock.mockClear();
    setWindowCaptured(false);
    context.fillRect(0, 0, 1, 1);
    expect(clock).not.toHaveBeenCalled();
    clock.mockRestore();
  });
  it('refuses comparison across a continuous uncaptured raster window', () => {
    const { context, record } = makeCanvas();

    setWindowCaptured(false);
    context.scale(2, 2);
    context.fillRect(0, 0, 10, 10);
    finish(record, 1);
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    finish(record, 2);
    setWindowCaptured(false);
    context.fillRect(0, 0, 10, 10);
    finish(record, 3);
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);

    expect(finish(record, 4)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'uncaptured-raster',
      comparisonGap: 2,
    });
  });

  it('reports same across an idle skipped window', () => {
    const { context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 2);
    setWindowCaptured(false);
    expect(finish(record, 3)).toBeUndefined();
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);

    expect(finish(record, 4)).toMatchObject({
      signatureStatus: 'same',
      comparisonGap: 2,
    });
  });

  it('compares across an uncaptured same-value reset through the preserved baseline', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 2);

    setWindowCaptured(false);
    canvas.width = canvas.width;
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 3)).toBeUndefined();

    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 4)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });

    setWindowCaptured(false);
    expect(finish(record, 5)).toBeUndefined();
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 6)).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
      comparisonGap: 4,
    });

    setWindowCaptured(false);
    expect(finish(record, 7)).toBeUndefined();
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 8)).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
      comparisonGap: 2,
    });
  });

  it('does not compare captured blue across uncaptured red raster activity', () => {
    const { context, record } = makeCanvas();

    context.fillStyle = 'blue';
    context.fillRect(0, 0, 10, 10);
    finish(record, 2);

    setWindowCaptured(false);
    context.fillStyle = 'red';
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 3)).toBeUndefined();

    setWindowCaptured(true);
    context.fillStyle = 'blue';
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 4)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'uncaptured-raster',
    });

    setWindowCaptured(false);
    context.fillStyle = 'red';
    expect(finish(record, 5)).toBeUndefined();
    setWindowCaptured(true);
    context.fillStyle = 'blue';
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 6)).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
      comparisonGap: 2,
    });
  });

  it('sees a property change made during a skipped window', () => {
    const { context, record } = makeCanvas();

    setWindowCaptured(false);
    context.fillStyle = 'red';
    finish(record, 1);
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    finish(record, 2);
    setWindowCaptured(false);
    context.fillStyle = 'blue';
    finish(record, 3);
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);

    expect(finish(record, 4)?.signatureStatus).toBe('changed');
  });

  it('sees a path built during a skipped window', () => {
    const { context, record } = makeCanvas();

    context.fill();
    finish(record, 2);
    setWindowCaptured(false);
    context.moveTo(0, 0);
    context.lineTo(10, 10);
    finish(record, 3);
    setWindowCaptured(true);
    context.fill();

    expect(finish(record, 4)).toMatchObject({
      signatureStatus: 'changed',
      unknownReason: null,
    });
  });

  it('sees a transform changed during a skipped window', () => {
    const { context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 2);
    setWindowCaptured(false);
    context.translate(5, 0);
    finish(record, 3);
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);

    expect(finish(record, 4)).toMatchObject({
      signatureStatus: 'changed',
      unknownReason: null,
    });
  });

  it('sees gradient mutation during a skipped window', () => {
    const { context, record } = makeCanvas();

    setWindowCaptured(false);
    const gradient = context.createLinearGradient(0, 0, 10, 0);
    context.fillStyle = gradient;
    finish(record, 1);
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    finish(record, 2);

    setWindowCaptured(false);
    gradient.addColorStop(0.5, 'red');
    expect(finish(record, 3)).toBeUndefined();
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);

    expect(finish(record, 4)?.signatureStatus).toBe('changed');
  });

  it('reports an object-form transform from a skipped window as unmodeled', () => {
    const { context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 2);
    setWindowCaptured(false);
    context.setTransform({});
    finish(record, 3);
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);

    expect(finish(record, 4)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'transform-unmodeled',
    });
  });

  it('recovers through previous-window before returning to same', () => {
    const { context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 2);

    setWindowCaptured(false);
    context.setTransform({});
    finish(record, 3);
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 4)?.unknownReason).toBe('transform-unmodeled');

    setWindowCaptured(false);
    context.setTransform(1, 0, 0, 1, 0, 0);
    finish(record, 5);
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 6)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'previous-window',
    });

    setWindowCaptured(false);
    expect(finish(record, 7)).toBeUndefined();
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 8)).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
    });
  });

  it('carries work from skipped windows into the next reported one', () => {
    const { context, record } = makeCanvas();

    // Window 1 is skipped by sampling and window 2 is reported.
    setWindowCaptured(false);
    context.fillRect(0, 0, 10, 10);
    context.fillRect(0, 0, 10, 10);
    record.selfTimeMs = 3;
    expect(finish(record, 1)).toBeUndefined();

    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    // Pinned after the call, so the wrapper's own measured microseconds do not
    // make the assertion depend on the clock.
    record.selfTimeMs = 1;
    const report = finish(record, 2)!;

    // Three raster operations happened across the two windows and all three
    // are counted. Sampling decides what is reported, not what is measured.
    expect(report.rasterOperationCount).toBe(3);
    expect(report.canvasApiSelfTimeMs).toBe(4);
    expect(report.coveredWindowCount).toBe(2);
    // Method evidence from the skipped window travels with the totals.
    expect(report.methodEvidence.fillRect.count).toBe(3);

    // The carry is cleared, so the next reported window is its own again.
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    record.selfTimeMs = 0.5;
    const next = finish(record, 4)!;
    expect(next.rasterOperationCount).toBe(1);
    expect(next.canvasApiSelfTimeMs).toBe(0.5);
    expect(next.coveredWindowCount).toBe(1);
  });

  it('reports one covered window when nothing was skipped', () => {
    const { context, record } = makeCanvas();
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 2)?.coveredWindowCount).toBe(1);
  });
});
