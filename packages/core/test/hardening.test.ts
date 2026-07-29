import { describe, expect, it } from 'vitest';
import { processRecord } from '../src/frame-loop';
import {
  getRecord,
  installCanvasPatch,
  isKilled,
  records,
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
  private widthValue = 0;
  private heightValue = 0;

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

function finish(record: ReturnType<typeof makeCanvas>['record'], index: number) {
  return processRecord(record, index, 1)?.report;
}

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

  it('reports same for same-size resizes and identical commands', () => {
    const { canvas, context, record } = makeCanvas();

    canvas.width = canvas.width;
    context.fillRect(1, 2, 3, 4);
    finish(record, 1);

    canvas.width = canvas.width;
    context.fillRect(1, 2, 3, 4);

    expect(finish(record, 2)?.signatureStatus).toBe('same');
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

  it('resets persistent state before the next draw window', () => {
    const resized = makeCanvas();
    const fresh = makeCanvas();

    resized.context.translate(5, 5);
    resized.canvas.width = resized.canvas.width;

    expect(resized.record.sig.unknown).toBe(false);
    expect(resized.record.props.size).toBe(0);
    expect(resized.record.matrix).toEqual([1, 0, 0, 1, 0, 0]);
    expect(resized.record.matrixUnknown).toBe(false);
    expect(resized.record.pathHash).toBe(0x811c9dc5);
    expect(resized.record.clipHash).toBe(0x811c9dc5);
    expect(resized.record.clipUnknown).toBe(false);
    expect(resized.record.stateStack).toEqual([]);
    finish(resized.record, 1);

    resized.context.fillRect(1, 2, 3, 4);
    fresh.context.fillRect(1, 2, 3, 4);

    expect(resized.record.sig.hash).toBe(fresh.record.sig.hash);
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
