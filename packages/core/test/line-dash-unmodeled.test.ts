import { describe, expect, it } from 'vitest';

import { processRecord } from '../src/frame-loop';
import { getRecord, installCanvasPatch } from '../src/wrap-context';

// A context WITHOUT getLineDash: the tracer has no authoritative post-call
// snapshot, so line-dash state must become persistently unmodeled.
class FakeContext {
  setLineDash(_value: unknown) {}
  stroke() {}
}

class FakeCanvas {
  private context: FakeContext | null = null;

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
});

describe('setLineDash without a native getLineDash', () => {
  it('persists uncertainty instead of guessing', () => {
    const canvas = new FakeCanvas();
    const context = canvas.getContext('2d')!;
    const record = getRecord(canvas)!;
    record.attribution = {
      nearestReactOwner: 'Fake',
      attributionKind: 'jsx-owner',
    };

    context.setLineDash([5, 5]);
    context.stroke();
    processRecord(record, 1, 1);

    context.stroke();
    const report = processRecord(record, 2, 1)?.report;
    expect(report?.signatureStatus).toBe('unknown');
    expect(report?.unknownReason).toContain('object');
  });
});
