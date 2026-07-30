import { describe, expect, it } from 'vitest';

import { captureSet, newWindowSignature } from '../src/signature';
import {
  getRecord,
  installCanvasPatch,
} from '../src/wrap-context';

const addColorStopResult = Symbol('addColorStop result');

class CanvasGradient {
  invocations: unknown[][] = [];

  addColorStop(...args: unknown[]) {
    this.invocations.push(args);
    return addColorStopResult;
  }
}

class FakeContext {
  private fillStyleValue: unknown = '#000000';

  get fillStyle() {
    return this.fillStyleValue;
  }

  set fillStyle(value: unknown) {
    this.fillStyleValue = value;
  }

  createLinearGradient(..._args: unknown[]) {
    return new CanvasGradient();
  }

  fillRect(..._args: unknown[]) {}
}

class FakeCanvas {
  private context: FakeContext | null = null;

  get width() {
    return 300;
  }

  get height() {
    return 150;
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

function gradientWindow(secondColor: string) {
  const canvas = new FakeCanvas();
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 100, 0);
  gradient.addColorStop(0, '#000');
  gradient.addColorStop(1, secondColor);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 100, 100);
  return getRecord(canvas)!.sig;
}

describe('CanvasGradient construction capture', () => {
  it('hashes identical gradients and draw windows equally', () => {
    const first = gradientWindow('#fff');
    const second = gradientWindow('#fff');

    expect(first.hash).toBe(second.hash);
    expect(first.unknown).toBe(false);
    expect(second.unknown).toBe(false);
  });

  it('hashes different color stops differently', () => {
    expect(gradientWindow('#fff').hash).not.toBe(
      gradientWindow('#f00').hash,
    );
  });

  it('marks an untracked gradient unknown', () => {
    const signature = newWindowSignature();

    captureSet(signature, 'fillStyle', new CanvasGradient());

    expect(signature.unknown).toBe(true);
    expect(signature.unknownReason).toBe('CanvasGradient');
  });

  it('preserves addColorStop return values and arguments', () => {
    const canvas = new FakeCanvas();
    const context = canvas.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, 100, 0);

    const result = gradient.addColorStop(0.25, '#abc');

    expect(result).toBe(addColorStopResult);
    expect(gradient.invocations).toEqual([[0.25, '#abc']]);
  });
});
