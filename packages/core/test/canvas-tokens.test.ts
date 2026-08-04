import { beforeEach, describe, expect, it } from 'vitest';

import { processRecord } from '../src/frame-loop';
import {
  drainAttributeRecords,
  getRecord,
  installCanvasPatch,
  records,
  setWindowCaptured,
} from '../src/wrap-context';
import type { CanvasRecord } from '../src/wrap-context';

class FakeAttributeObserver {
  private readonly observed = new Set<unknown>();
  private readonly records: MutationRecord[] = [];

  observe(target: unknown) {
    this.observed.add(target);
  }

  takeRecords(): MutationRecord[] {
    return this.records.splice(0);
  }

  queue(target: unknown, attributeName: string): void {
    if (!this.observed.has(target)) return;
    this.records.push({
      type: 'attributes',
      target: target as Node,
      attributeName,
    } as MutationRecord);
  }

  reset(): void {
    this.records.length = 0;
  }
}

const attributeObserver = new FakeAttributeObserver();

class FakeContext {
  drawImage(..._args: unknown[]) {}
  fillRect(..._args: unknown[]) {}
}

class HTMLCanvasElement {
  private context: FakeContext | null = null;
  private heightValue = 0;
  private widthValue = 0;

  get height() {
    return this.heightValue;
  }

  set height(value: number) {
    this.heightValue = value;
    attributeObserver.queue(this, 'height');
  }

  get width() {
    return this.widthValue;
  }

  set width(value: number) {
    this.widthValue = value;
    attributeObserver.queue(this, 'width');
  }

  setAttributeNS(_namespace: string | null, name: string, value: unknown) {
    const attribute = String(name).toLowerCase();
    if (attribute === 'width') {
      this.widthValue = Number(value);
      attributeObserver.queue(this, 'width');
    } else if (attribute === 'height') {
      this.heightValue = Number(value);
      attributeObserver.queue(this, 'height');
    }
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

class HTMLVideoElement {}

installCanvasPatch({
  canvasProto: HTMLCanvasElement.prototype,
  contextProto: FakeContext.prototype,
  attributeObserver,
});

function makeCanvas() {
  const canvas = new HTMLCanvasElement();
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
  captureEvery = 1,
) {
  drainAttributeRecords();
  return processRecord(record, windowIndex, captureEvery)?.report;
}

function retire(record: CanvasRecord) {
  records.delete(record);
  record.retired = true;
  record.inactiveBoundaries = 120;
  record.activeInWindow = false;
}

beforeEach(() => {
  setWindowCaptured(true);
  attributeObserver.reset();
});

describe('tracked canvas source tokens', () => {
  it('reports same when a tracked source is untouched between scene windows', () => {
    const cache = makeCanvas();
    const scene = makeCanvas();

    scene.context.drawImage(cache.canvas, 0, 0);
    finish(scene.record, 1);
    scene.context.drawImage(cache.canvas, 0, 0);

    expect(finish(scene.record, 2)?.signatureStatus).toBe('same');
  });

  it('reports changed when a tracked source redraws with different commands', () => {
    const cache = makeCanvas();
    const scene = makeCanvas();

    cache.context.fillRect(0, 0, 10, 10);
    finish(cache.record, 1);
    scene.context.drawImage(cache.canvas, 0, 0);
    finish(scene.record, 1);
    cache.context.fillRect(0, 0, 20, 20);
    finish(cache.record, 2);
    scene.context.drawImage(cache.canvas, 0, 0);

    expect(finish(scene.record, 2)?.signatureStatus).toBe('changed');
  });

  it('reports same when a tracked source redraw is provably same', () => {
    const cache = makeCanvas();
    const scene = makeCanvas();

    cache.context.fillRect(0, 0, 10, 10);
    finish(cache.record, 1);
    scene.context.drawImage(cache.canvas, 0, 0);
    finish(scene.record, 1);
    cache.context.fillRect(0, 0, 10, 10);
    expect(finish(cache.record, 2)?.signatureStatus).toBe('same');
    scene.context.drawImage(cache.canvas, 0, 0);

    expect(finish(scene.record, 2)?.signatureStatus).toBe('same');
  });

  it('uses the current token from a retired tracked source', () => {
    const cache = makeCanvas();
    const scene = makeCanvas();

    cache.context.fillRect(0, 0, 10, 10);
    finish(cache.record, 1);
    scene.context.drawImage(cache.canvas, 0, 0);
    finish(scene.record, 1);
    retire(cache.record);
    scene.context.drawImage(cache.canvas, 0, 0);

    expect(records.has(cache.record)).toBe(false);
    expect(finish(scene.record, 2)?.signatureStatus).toBe('same');
  });

  it('reactivates a retired source before its changed token is consumed', () => {
    const cache = makeCanvas();
    const scene = makeCanvas();

    cache.context.fillRect(0, 0, 10, 10);
    finish(cache.record, 1);
    scene.context.drawImage(cache.canvas, 0, 0);
    finish(scene.record, 1);
    retire(cache.record);
    cache.context.fillRect(0, 0, 20, 20);

    expect(records.has(cache.record)).toBe(true);
    expect(finish(cache.record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'first-window',
    });
    scene.context.drawImage(cache.canvas, 0, 0);
    expect(finish(scene.record, 2)?.signatureStatus).toBe('changed');
  });

  it('reactivates a retired source before its reset token is consumed', () => {
    const cache = makeCanvas();
    const scene = makeCanvas();

    cache.context.fillRect(0, 0, 10, 10);
    finish(cache.record, 1);
    scene.context.drawImage(cache.canvas, 0, 0);
    finish(scene.record, 1);
    retire(cache.record);
    cache.canvas.width = 100;

    expect(records.has(cache.record)).toBe(true);
    scene.context.drawImage(cache.canvas, 0, 0);
    expect(finish(scene.record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-source-reset',
    });
  });

  it('poisons an untracked canvas source', () => {
    const cache = new HTMLCanvasElement();
    const scene = makeCanvas();

    scene.context.drawImage(cache, 0, 0);

    expect(finish(scene.record, 1)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'HTMLCanvasElement',
    });
  });

  it('refuses a tracked source reset in the consuming window', () => {
    const cache = makeCanvas();
    const scene = makeCanvas();

    scene.context.drawImage(cache.canvas, 0, 0);
    finish(scene.record, 1);
    cache.canvas.width = 100;
    scene.context.drawImage(cache.canvas, 0, 0);

    expect(finish(scene.record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-source-reset',
    });
  });

  it('refuses a same-stack observer reset without poisoning another consumer', () => {
    const source = makeCanvas();
    const consumer = makeCanvas();
    const healthySource = makeCanvas();
    const healthyConsumer = makeCanvas();

    source.context.fillRect(0, 0, 10, 10);
    healthySource.context.fillRect(0, 0, 10, 10);
    finish(source.record, 1);
    finish(healthySource.record, 1);

    consumer.context.drawImage(source.canvas, 0, 0);
    healthyConsumer.context.drawImage(healthySource.canvas, 0, 0);
    finish(consumer.record, 1);
    finish(healthyConsumer.record, 1);

    source.canvas.setAttributeNS(
      null,
      'width',
      String(source.canvas.width),
    );
    consumer.context.drawImage(source.canvas, 0, 0);
    healthyConsumer.context.drawImage(healthySource.canvas, 0, 0);

    expect(finish(consumer.record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-source-reset',
    });
    expect(finish(healthyConsumer.record, 2)).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
    });
  });

  it('reports changed after an uncaptured source raster window', () => {
    const cache = makeCanvas();
    const scene = makeCanvas();

    scene.context.drawImage(cache.canvas, 0, 0);
    finish(scene.record, 2, 2);
    setWindowCaptured(false);
    cache.context.fillRect(0, 0, 10, 10);
    expect(finish(cache.record, 3, 2)).toBeUndefined();
    setWindowCaptured(true);
    scene.context.drawImage(cache.canvas, 0, 0);

    expect(finish(scene.record, 4, 2)?.signatureStatus).toBe('changed');
  });

  it('still poisons a video source', () => {
    const scene = makeCanvas();

    scene.context.drawImage(new HTMLVideoElement(), 0, 0);

    expect(finish(scene.record, 1)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'HTMLVideoElement',
    });
  });

  it('keeps first-window semantics for a tracked source', () => {
    const cache = makeCanvas();
    const scene = makeCanvas();

    scene.context.drawImage(cache.canvas, 0, 0);

    expect(finish(scene.record, 1)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'first-window',
    });
  });
});
