import { describe, expect, it, vi } from 'vitest';
import {
  getRecord,
  installCanvasPatch,
  isKilled,
  records,
} from '../src/wrap-context';

const fillRectResult = Symbol('fillRect result');

class FakeContext {
  canvas: FakeCanvas;
  invocations: Array<{ method: string; args: unknown[] }> = [];
  throwOnFillRect: Error | null = null;
  private fillStyleValue = '#000000';

  constructor(canvas: FakeCanvas) {
    this.canvas = canvas;
  }

  get fillStyle() {
    return this.fillStyleValue;
  }

  set fillStyle(value: string) {
    this.fillStyleValue = value;
  }

  fillRect(...args: unknown[]) {
    this.invocations.push({ method: 'fillRect', args });
    if (this.throwOnFillRect) throw this.throwOnFillRect;
    return fillRectResult;
  }

  clearRect(...args: unknown[]) {
    this.invocations.push({ method: 'clearRect', args });
  }

  drawImage(...args: unknown[]) {
    this.invocations.push({ method: 'drawImage', args });
  }

  stroke(...args: unknown[]) {
    this.invocations.push({ method: 'stroke', args });
  }

  boom() {
    throw new Error('boom');
  }
}

class FakeCanvas {
  id = '';
  private context: FakeContext | null = null;

  getAttribute(name: string) {
    return name === 'id' ? this.id : null;
  }

  getContext(type: string) {
    if (type !== '2d') return null;
    this.context ??= new FakeContext(this);
    return this.context;
  }
}

installCanvasPatch({
  canvasProto: FakeCanvas.prototype,
  contextProto: FakeContext.prototype,
});

const canvas = new FakeCanvas();
const context = canvas.getContext('2d')!;

describe('canvas context wrapping', () => {
  it('preserves context identity and registers the canvas once', () => {
    expect(canvas.getContext('2d')).toBe(context);
    expect(canvas.getContext('2d')).toBe(context);
    expect(records.size).toBe(1);
    expect(getRecord(canvas)).toBeDefined();
  });

  it('preserves the native canvas property', () => {
    expect(context.canvas).toBe(canvas);
  });

  it('gives a canvas with a DOM id an id prefixed by the element id', () => {
    const identifiedCanvas = new FakeCanvas();
    identifiedCanvas.id = 'chart';
    identifiedCanvas.getContext('2d');

    const record = getRecord(identifiedCanvas)!;
    expect(record.id).toBe(`chart#${record.serial}`);
  });

  it('gives a canvas without a DOM id an id derived from its serial', () => {
    const identifiedCanvas = new FakeCanvas();
    identifiedCanvas.id = 'identified';
    identifiedCanvas.getContext('2d');
    const anonymousCanvas = new FakeCanvas();
    anonymousCanvas.getContext('2d');

    const record = getRecord(anonymousCanvas)!;
    expect(record.id).toBe(`canvas:${record.serial}`);
  });

  it('gives canvases with the same DOM id different ids', () => {
    const first = new FakeCanvas();
    const second = new FakeCanvas();
    first.id = 'shared';
    second.id = 'shared';
    first.getContext('2d');
    second.getContext('2d');

    expect(getRecord(first)!.id).not.toBe(getRecord(second)!.id);
  });

  it('preserves setter round-trips and captures the assignment', () => {
    const record = getRecord(canvas)!;
    const hashBefore = record.sig.hash;

    context.fillStyle = '#ff0000';

    expect(context.fillStyle).toBe('#ff0000');
    expect(record.sig.hash).not.toBe(hashBefore);
  });

  it('passes native calls through and records basic output', () => {
    const record = getRecord(canvas)!;

    const result = context.fillRect(1, 2, 3, 4);

    expect(result).toBe(fillRectResult);
    expect(context.invocations.at(-1)).toEqual({
      method: 'fillRect',
      args: [1, 2, 3, 4],
    });
    expect(record.rasterOps).toBe(1);
    expect(record.selfTimeMs).toBeGreaterThanOrEqual(0);
    expect(record.activeInWindow).toBe(true);
  });

  it('propagates the same native error instance', () => {
    const nativeError = new Error('native failure');
    context.throwOnFillRect = nativeError;

    let thrown: unknown;
    try {
      context.fillRect(1, 2, 3, 4);
    } catch (error) {
      thrown = error;
    } finally {
      context.throwOnFillRect = null;
    }

    expect(thrown).toBe(nativeError);
  });

  it('kills instrumentation when capture fails without escaping', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const evil = {
      get constructor() {
        throw new Error('boom');
      },
    };

    expect(() => context.fillRect(evil)).not.toThrow();
    expect(context.invocations.at(-1)?.args).toEqual([evil]);
    expect(isKilled()).toBe(true);

    expect(context.fillRect(5, 6, 7, 8)).toBe(fillRectResult);
    expect(context.invocations.at(-1)).toEqual({
      method: 'fillRect',
      args: [5, 6, 7, 8],
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[canvas-scan\]/);
    warn.mockRestore();
  });
});
