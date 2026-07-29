import { beforeEach, describe, expect, it } from 'vitest';

import { processRecord } from '../src/frame-loop';
import {
  getRecord,
  installCanvasPatch,
  setWindowCaptured,
} from '../src/wrap-context';
import type { CanvasRecord } from '../src/wrap-context';

const capturedSetterNames = [
  'fillStyle',
  'strokeStyle',
  'globalAlpha',
  'lineWidth',
  'lineCap',
  'lineJoin',
  'miterLimit',
  'font',
  'textAlign',
  'textBaseline',
  'globalCompositeOperation',
  'imageSmoothingEnabled',
  'shadowBlur',
  'shadowColor',
  'shadowOffsetX',
  'shadowOffsetY',
  'filter',
  'lineDashOffset',
  'direction',
  'letterSpacing',
  'wordSpacing',
  'fontKerning',
  'fontStretch',
  'fontVariantCaps',
  'textRendering',
  'imageSmoothingQuality',
] as const;

class CanvasGradient {
  addColorStop(..._args: unknown[]) {}
}

class CanvasPattern {}

class FakeContext {
  private values = new Map<string, unknown>();
  private stateStack: Array<Map<string, unknown>> = [];
  declare fillStyle: unknown;
  declare filter: unknown;

  getValue(name: string) {
    return this.values.get(name);
  }

  setValue(name: string, value: unknown) {
    this.values.set(name, value);
  }

  fillRect(..._args: unknown[]) {}
  save() {
    this.stateStack.push(new Map(this.values));
  }
  restore() {
    const values = this.stateStack.pop();
    if (values) this.values = values;
  }
  translate(..._args: unknown[]) {}
  rotate(..._args: unknown[]) {}
  scale(..._args: unknown[]) {}
  transform(..._args: unknown[]) {}
  setTransform(..._args: unknown[]) {}
  resetTransform() {}
  beginPath() {}
  moveTo(..._args: unknown[]) {}
  lineTo(..._args: unknown[]) {}
  rect(..._args: unknown[]) {}
  fill(..._args: unknown[]) {}
  clip(..._args: unknown[]) {}

  reset() {
    this.values.clear();
    this.stateStack = [];
  }

  createLinearGradient(..._args: unknown[]) {
    return new CanvasGradient();
  }
}

for (const name of capturedSetterNames) {
  Object.defineProperty(FakeContext.prototype, name, {
    configurable: true,
    get(this: FakeContext) {
      return this.getValue(name);
    },
    set(this: FakeContext, value: unknown) {
      this.setValue(name, value);
    },
  });
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
});

function makeCanvas() {
  const canvas = new FakeCanvas();
  const context = canvas.getContext('2d')!;
  const record = getRecord(canvas)!;
  record.attribution = {
    nearestReactOwner: 'Fake',
    attributionKind: 'jsx-owner',
  };
  return { context, record };
}

function finish(
  record: CanvasRecord,
  windowIndex: number,
) {
  return processRecord(record, windowIndex, 1)?.report;
}

beforeEach(() => {
  setWindowCaptured(true);
});

describe('persistent context state', () => {
  it('captures filter assignments', () => {
    const filtered = makeCanvas();
    const control = makeCanvas();

    filtered.context.filter = 'blur(2px)';
    filtered.context.fillRect(0, 0, 10, 10);
    control.context.fillRect(0, 0, 10, 10);

    expect(filtered.record.sig.hash).not.toBe(control.record.sig.hash);
  });

  it('fingerprints prior property state at the next window head', () => {
    const first = makeCanvas();
    const second = makeCanvas();
    const control = makeCanvas();

    first.context.fillStyle = 'red';
    first.context.fillRect(0, 0, 10, 10);
    second.context.fillStyle = 'red';
    second.context.fillRect(0, 0, 10, 10);
    finish(first.record, 1);
    finish(second.record, 1);

    first.context.fillRect(0, 0, 10, 10);
    second.context.fillRect(0, 0, 10, 10);
    control.context.fillRect(0, 0, 10, 10);

    expect(first.record.sig.hash).toBe(second.record.sig.hash);
    expect(first.record.sig.hash).not.toBe(control.record.sig.hash);
  });

  it('sees post-assignment gradient mutation in the next head fingerprint', () => {
    const { context, record } = makeCanvas();
    const gradient = context.createLinearGradient(0, 0, 10, 0);

    context.fillStyle = gradient;
    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    context.fillRect(0, 0, 10, 10);
    const hashBeforeMutation = record.sig.hash;
    finish(record, 2);

    gradient.addColorStop(0.5, 'red');
    context.fillRect(0, 0, 10, 10);

    expect(record.sig.hash).not.toBe(hashBeforeMutation);
    expect(finish(record, 3)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'gradient-mutated',
    });

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 4)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'previous-window',
    });

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 5)).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
    });
  });

  it('keeps a persistent CanvasPattern unknown in later windows', () => {
    const { context, record } = makeCanvas();

    context.fillStyle = new CanvasPattern();
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 1)?.unknownReason).toBe('CanvasPattern');

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 2)?.unknownReason).toBe('CanvasPattern');
  });

  it('reports changed after an unbalanced translate', () => {
    const { context, record } = makeCanvas();

    context.translate(5, 0);
    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    context.fillRect(0, 0, 10, 10);

    expect(finish(record, 2)).toMatchObject({
      signatureStatus: 'changed',
      unknownReason: null,
    });
  });

  it('reports same for repeated save-translate-restore windows', () => {
    const { context, record } = makeCanvas();
    const draw = () => {
      context.save();
      context.translate(5, 0);
      context.fillRect(0, 0, 10, 10);
      context.restore();
    };

    draw();
    finish(record, 1);
    draw();

    expect(finish(record, 2)?.signatureStatus).toBe('same');
  });

  it('treats a konva-style stable baseline transform as same', () => {
    const { context, record } = makeCanvas();

    setWindowCaptured(false);
    context.scale(2, 2);
    expect(processRecord(record, 1, 2)).toBeNull();
    setWindowCaptured(true);

    context.fillRect(0, 0, 10, 10);
    finish(record, 2);
    context.fillRect(0, 0, 10, 10);

    expect(finish(record, 3)?.signatureStatus).toBe('same');
  });

  it('hashes identical carried paths equally and different paths differently', () => {
    const first = makeCanvas();
    const same = makeCanvas();
    const different = makeCanvas();

    for (const { context, record } of [first, same, different]) {
      context.moveTo(0, 0);
      context.lineTo(10, 10);
      if (record === different.record) context.lineTo(20, 20);
      finish(record, 1);
      context.fill();
    }

    expect(first.record.sig.hash).toBe(same.record.sig.hash);
    expect(first.record.sig.hash).not.toBe(different.record.sig.hash);
    expect(first.record.sig.unknown).toBe(false);
    expect(same.record.sig.unknown).toBe(false);
    expect(different.record.sig.unknown).toBe(false);
  });

  it('hashes path operations under different transforms differently', () => {
    const first = makeCanvas();
    const transformed = makeCanvas();

    first.context.moveTo(0, 0);
    first.context.lineTo(10, 10);
    transformed.context.translate(5, 0);
    transformed.context.moveTo(0, 0);
    transformed.context.lineTo(10, 10);

    expect(first.record.pathHash).not.toBe(transformed.record.pathHash);
  });

  it('reset clears matrix, path, and clip state', () => {
    const { context, record } = makeCanvas();

    context.fillStyle = 'red';
    context.translate(5, 0);
    context.moveTo(0, 0);
    context.clip();
    context.reset();
    finish(record, 1);

    expect(record.props.size).toBe(0);
    expect(record.matrix).toEqual([1, 0, 0, 1, 0, 0]);
    expect(record.matrixUnknown).toBe(false);
    expect(record.pathHash).toBe(0x811c9dc5);
    expect(record.clipHash).toBe(0x811c9dc5);
    expect(record.stateStack).toEqual([]);

    context.fillRect(0, 0, 10, 10);
    finish(record, 2);
    context.fillRect(0, 0, 10, 10);

    expect(finish(record, 3)?.signatureStatus).toBe('same');
  });

  it('repeated balanced shape windows reach same', () => {
    const { context, record } = makeCanvas();
    const drawShape = () => {
      context.save();
      context.translate(5, 0);
      context.fillRect(0, 0, 10, 10);
      context.restore();
    };

    drawShape();
    finish(record, 1);
    drawShape();

    expect(finish(record, 2)?.signatureStatus).toBe('same');
  });

  it('reports object-form transforms as unmodeled until numeric recovery', () => {
    const { context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    context.setTransform({});
    finish(record, 2);
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 3)?.unknownReason).toBe('transform-unmodeled');

    context.setTransform(1, 0, 0, 1, 0, 0);
    finish(record, 4);
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 5)?.unknownReason).toBe('previous-window');

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 6)).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
    });
  });

  it('restores the clip hash after a balanced clipped state', () => {
    const { context, record } = makeCanvas();
    const initialClipHash = record.clipHash;
    const draw = () => {
      context.save();
      context.beginPath();
      context.rect(0, 0, 10, 10);
      context.clip();
      const clippedHash = record.clipHash;
      context.fillRect(0, 0, 10, 10);
      context.restore();
      context.beginPath();
      return clippedHash;
    };

    expect(draw()).not.toBe(initialClipHash);
    expect(record.clipHash).toBe(initialClipHash);
    finish(record, 1);
    draw();

    expect(record.clipHash).toBe(initialClipHash);
    expect(finish(record, 2)?.signatureStatus).toBe('same');
  });
});
