import { describe, expect, it } from 'vitest';
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

  it('poisons the window when the canvas is resized', () => {
    const canvas = new FakeCanvas();
    const context = canvas.getContext('2d') as FakeContext;
    const record = getRecord(canvas)!;

    context.fillRect(1, 2, 3, 4);
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
    canvas.width = 300;

    expect(canvas.width).toBe(300);
    expect(record.sig.unknown).toBe(true);
    expect(record.sig.unknownReason).toBe('canvas-resize');
    expect(record.activeInWindow).toBe(true);
    expect(record.props.size).toBe(0);
    expect(record.matrix).toEqual([1, 0, 0, 1, 0, 0]);
    expect(record.matrixUnknown).toBe(false);
    expect(record.pathHash).toBe(0x811c9dc5);
    expect(record.clipHash).toBe(0x811c9dc5);
    expect(record.clipUnknown).toBe(false);
    expect(record.stateStack).toEqual([]);
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
