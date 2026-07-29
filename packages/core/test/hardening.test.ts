import { afterEach, describe, expect, it } from 'vitest';
import { processRecord } from '../src/frame-loop';
import {
  getRecord,
  installCanvasPatch,
  isKilled,
  records,
  setWindowCaptured,
} from '../src/wrap-context';

const fillRectResult = Symbol('fillRect result');
const webglContext = {};

class FakeContext {
  canvas: FakeCanvas;
  invocations: Array<{ method: string; args: unknown[] }> = [];

  constructor(canvas: FakeCanvas) {
    this.canvas = canvas;
  }

  fillRect(...args: unknown[]) {
    this.invocations.push({ method: 'fillRect', args });
    return fillRectResult;
  }

  translate(...args: unknown[]) {
    this.invocations.push({ method: 'translate', args });
  }
}

class FakeCanvas {
  id = '';
  private context: FakeContext | null = null;
  widthValue: unknown = 300;
  heightValue: unknown = 150;
  throwOnWidthRead = false;

  get width(): number {
    if (this.throwOnWidthRead) throw new Error('width unavailable');
    return <number>this.widthValue;
  }

  set width(value: number) {
    this.widthValue = value;
  }

  get height(): number {
    return <number>this.heightValue;
  }

  set height(value: number) {
    this.heightValue = value;
  }

  getAttribute(name: string) {
    return name === 'id' ? this.id : null;
  }

  getContext(type: string) {
    if (type === 'webgl') return webglContext;
    if (type !== '2d') return null;
    this.context ??= new FakeContext(this);
    return this.context;
  }
}

const targets = {
  canvasProto: FakeCanvas.prototype,
  contextProto: FakeContext.prototype,
};

installCanvasPatch(targets);

function makeCanvas() {
  const canvas = new FakeCanvas();
  const context = canvas.getContext('2d') as FakeContext;
  const record = getRecord(canvas)!;
  record.attribution = {
    nearestReactOwner: 'Fake',
    attributionKind: 'jsx-owner',
  };
  return { canvas, context, record };
}

function finish(
  record: ReturnType<typeof makeCanvas>['record'],
  index: number,
  captureEvery = 1,
) {
  return processRecord(record, index, captureEvery)?.report;
}

afterEach(() => {
  setWindowCaptured(true);
});

describe('canvas patch hardening', () => {
  it('treats duplicate installation as a no-op', () => {
    installCanvasPatch(targets);
    const canvas = new FakeCanvas();
    const context = canvas.getContext('2d') as FakeContext;

    expect(context.fillRect(1, 2, 3, 4)).toBe(fillRectResult);
    expect(context.invocations).toHaveLength(1);
    expect(records.size).toBe(1);
  });

  it('passes pre-patch contexts through safely', () => {
    const context = new FakeContext(new FakeCanvas());

    expect(context.fillRect(1, 2, 3, 4)).toBe(fillRectResult);
    expect(context.invocations).toHaveLength(1);
    expect(records.size).toBe(1);
    expect(isKilled()).toBe(false);
  });

  it('reports same when dimensions and command streams match', () => {
    const { canvas, context, record } = makeCanvas();

    canvas.width = canvas.width;
    context.fillRect(1, 2, 3, 4);
    finish(record, 1);

    canvas.width = canvas.width;
    context.fillRect(1, 2, 3, 4);

    expect(finish(record, 2)?.signatureStatus).toBe('same');
  });

  it('never reports same after a resize in an uncaptured window', () => {
    const { canvas, context, record } = makeCanvas();

    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    finish(record, 2, 2);

    setWindowCaptured(false);
    canvas.width = 600;
    finish(record, 3, 2);

    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);

    expect(finish(record, 4, 2)?.signatureStatus).not.toBe('same');
  });

  it('never reports same when a resize bypasses the wrapped setter', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    canvas.widthValue = 600;
    context.fillRect(0, 0, 10, 10);

    expect(finish(record, 2)?.signatureStatus).not.toBe('same');
  });

  it('reports unknown when the current dimensions cannot be read', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    canvas.widthValue = 'unreadable';
    context.fillRect(0, 0, 10, 10);

    expect(finish(record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-dimensions-unmodeled',
    });
  });

  it('never reports same when a resize changes the dimensions', () => {
    const { canvas, context, record } = makeCanvas();

    canvas.width = 100;
    context.fillRect(1, 2, 3, 4);
    finish(record, 1);

    canvas.width = 200;
    context.fillRect(1, 2, 3, 4);
    const report = finish(record, 2);

    expect(report?.signatureStatus).toBe('changed');
    expect(report?.signatureStatus).not.toBe('same');
  });

  it('distinguishes width and height resizes with identical dimensions', () => {
    const canvas = new FakeCanvas();
    canvas.width = 200;
    canvas.height = 200;
    const context = canvas.getContext('2d') as FakeContext;
    const record = getRecord(canvas)!;
    record.attribution = {
      nearestReactOwner: 'Fake',
      attributionKind: 'jsx-owner',
    };

    canvas.width = 200;
    context.fillRect(1, 2, 3, 4);
    finish(record, 1);

    canvas.height = 200;
    context.fillRect(1, 2, 3, 4);

    expect(finish(record, 2)?.signatureStatus).toBe('changed');
  });

  it('distinguishes resize position within the command stream', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(1, 2, 3, 4);
    canvas.width = 200;
    finish(record, 1);

    canvas.width = 200;
    context.fillRect(1, 2, 3, 4);

    expect(finish(record, 2)?.signatureStatus).toBe('changed');
  });

  it('keeps resize windows comparable without canvas-resize uncertainty', () => {
    const { canvas, record } = makeCanvas();

    canvas.width = 200;

    expect(record.sig.unknown).toBe(false);
    expect(record.sig.unknownReason).toBeNull();
    finish(record, 1);

    canvas.width = 200;

    expect(finish(record, 2)).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
    });
  });

  it('resets all persistent state before the next captured window', () => {
    const { canvas, context, record } = makeCanvas();

    setWindowCaptured(true);
    context.fillRect(1, 2, 3, 4);
    finish(record, 2, 2);

    record.props.set('fillStyle', 'red');
    record.matrix = [2, 0, 0, 2, 5, 5];
    record.matrixUnknown = true;
    record.pathHash = 1;
    record.clipHash = 2;
    record.clipUnknown = true;
    record.stateStack.push({
      matrix: [1, 0, 0, 1, 0, 0],
      matrixUnknown: false,
      clipHash: 0x811c9dc5,
      clipUnknown: false,
      undo: [],
    });

    setWindowCaptured(false);
    canvas.width = canvas.width;

    expect(record.props.size).toBe(0);
    expect(record.matrix).toEqual([1, 0, 0, 1, 0, 0]);
    expect(record.matrixUnknown).toBe(false);
    expect(record.pathHash).toBe(0x811c9dc5);
    expect(record.clipHash).toBe(0x811c9dc5);
    expect(record.clipUnknown).toBe(false);
    expect(record.stateStack).toEqual([]);
    finish(record, 3, 2);

    setWindowCaptured(true);
    context.fillRect(1, 2, 3, 4);

    expect(finish(record, 4, 2)?.signatureStatus).toBe('same');
  });

  it('resets the transform when a resize dimension getter throws', () => {
    const { canvas, context, record } = makeCanvas();

    setWindowCaptured(true);
    context.fillRect(1, 2, 3, 4);
    finish(record, 2, 2);

    setWindowCaptured(false);
    context.translate(5, 5);
    canvas.throwOnWidthRead = true;
    expect(() => {
      canvas.width = 300;
    }).not.toThrow();
    canvas.throwOnWidthRead = false;
    finish(record, 3, 2);

    setWindowCaptured(true);
    context.fillRect(1, 2, 3, 4);

    expect(finish(record, 4, 2)?.signatureStatus).toBe('same');
  });

  it('passes resize through for an unregistered canvas', () => {
    const canvas = new FakeCanvas();

    expect(() => {
      canvas.width = 300;
    }).not.toThrow();
    expect(canvas.width).toBe(300);
    expect(getRecord(canvas)).toBeUndefined();
  });

  it('leaves non-2d contexts untouched', () => {
    const canvas = new FakeCanvas();

    expect(canvas.getContext('webgl')).toBe(webglContext);
    expect(getRecord(canvas)).toBeUndefined();
  });
});
