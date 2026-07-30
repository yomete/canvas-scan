import { beforeEach, describe, expect, it } from 'vitest';

import { processRecord } from '../src/frame-loop';
import {
  getRecord,
  installCanvasPatch,
  setWindowCaptured,
} from '../src/wrap-context';
import type { CanvasRecord } from '../src/wrap-context';

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
  }

  get width() {
    return this.widthValue;
  }

  set width(value: number) {
    this.widthValue = value;
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
  attributeObserver: { observe() {} },
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
  return processRecord(record, windowIndex, captureEvery)?.report;
}

beforeEach(() => {
  setWindowCaptured(true);
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

  it('poisons an untracked canvas source', () => {
    const cache = new HTMLCanvasElement();
    const scene = makeCanvas();

    scene.context.drawImage(cache, 0, 0);

    expect(finish(scene.record, 1)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'HTMLCanvasElement',
    });
  });

  it('reports changed when a tracked source is resized', () => {
    const cache = makeCanvas();
    const scene = makeCanvas();

    scene.context.drawImage(cache.canvas, 0, 0);
    finish(scene.record, 1);
    cache.canvas.width = 100;
    scene.context.drawImage(cache.canvas, 0, 0);

    expect(finish(scene.record, 2)?.signatureStatus).toBe('changed');
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
