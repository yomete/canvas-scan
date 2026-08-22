import { beforeEach, describe, expect, it } from 'vitest';

import { processRecord } from '../src/frame-loop';
import {
  getRecord,
  installCanvasPatch,
  setWindowCaptured,
} from '../src/wrap-context';
import type { CanvasRecord } from '../src/wrap-context';

class FakeContext {
  fillRect(..._args: unknown[]) {}
  drawImage(..._args: unknown[]) {}
  reset() {}
}

class FakeCanvas {
  private context: FakeContext | null = null;
  widthValue = 300;
  heightValue = 150;

  get width(): number {
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

function finish(record: CanvasRecord, windowIndex: number) {
  return processRecord(record, windowIndex, 1)?.report;
}

beforeEach(() => {
  setWindowCaptured(true);
});

describe('signature comparison continuity across plain resets', () => {
  it("yields 'changed' for a genuine size change across a reset, never 'unknown'", () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    canvas.width = 400;
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 3)).toMatchObject({
      signatureStatus: 'changed',
      unknownReason: null,
      comparisonGap: 2,
    });
  });

  it("yields 'same' for an identical redraw across a captured reset", () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    canvas.width = canvas.width;
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 3)).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
      comparisonGap: 2,
    });
  });

  it("keeps 'first-window' when no baseline ever existed", () => {
    const { context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 1)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'first-window',
      comparisonGap: null,
    });
  });

  it("still invalidates the baseline for a source reset and reports 'first-window' after it", () => {
    const source = makeCanvas();
    const consumer = makeCanvas();

    source.context.fillRect(0, 0, 10, 10);
    finish(source.record, 1);
    consumer.context.drawImage(source.canvas, 0, 0);
    finish(consumer.record, 1);

    source.context.reset();
    consumer.context.drawImage(source.canvas, 0, 0);
    expect(finish(consumer.record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-source-reset',
    });
    // Consuming the source's own reset window is what lets the next consumer
    // registration see a stable source version again.
    finish(source.record, 2);
    consumer.context.drawImage(source.canvas, 0, 0);
    expect(finish(consumer.record, 3)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'first-window',
    });
  });
});
