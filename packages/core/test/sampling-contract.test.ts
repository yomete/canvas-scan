import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { processRecord } from '../src/frame-loop';
import {
  getRecord,
  installCanvasPatch,
  setMethodEvidenceCollectionEnabled,
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
  setWindowCaptured(true);
});

afterEach(() => setMethodEvidenceCollectionEnabled(false));

describe('sampling contract', () => {
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

  it('does not compare across an uncaptured same-value reset', () => {
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
      signatureStatus: 'unknown',
      unknownReason: 'first-window',
      comparisonGap: null,
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
});
