import { describe, expect, it } from 'vitest';

import { processRecord } from '../src/frame-loop';
import { getRecord, installCanvasPatch } from '../src/wrap-context';

class FakeContext {
  fillRect() {}
}

class FakeCanvas {
  private context: FakeContext | null = null;

  get width() {
    return 300;
  }

  get height() {
    return 150;
  }

  getAttribute() {
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
  attributeObserver: { observe() {} },
});

describe('observer drain availability', () => {
  it('never compares when takeRecords is unavailable', () => {
    const canvas = new FakeCanvas();
    const context = canvas.getContext('2d')!;
    const record = getRecord(canvas)!;
    record.attribution = {
      nearestReactOwner: 'Fake',
      attributionKind: 'jsx-owner',
    };

    context.fillRect();
    processRecord(record, 1, 1);
    context.fillRect();

    expect(processRecord(record, 2, 1)?.report).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-dimensions-unmodeled',
    });
  });
});
