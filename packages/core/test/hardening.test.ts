import {
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { processRecord } from '../src/frame-loop';
import {
  getRecord,
  installCanvasPatch,
  isKilled,
  markAttributeReset,
  records,
  setWindowCaptured,
} from '../src/wrap-context';

const fillRectResult = Symbol('fillRect result');
const webglContext = {};
const originalMutationObserverDescriptor =
  Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');

class FakeMutationObserver {
  static observations: Array<{
    target: unknown;
    options: MutationObserverInit;
  }> = [];

  constructor(_callback: MutationCallback) {}

  observe(target: Node, options: MutationObserverInit) {
    if ((target as unknown as FakeCanvas).throwOnObserve) {
      throw new Error('observation unavailable');
    }
    FakeMutationObserver.observations.push({ target, options });
  }

  disconnect() {}

  takeRecords(): MutationRecord[] {
    return [];
  }
}

Object.defineProperty(globalThis, 'MutationObserver', {
  configurable: true,
  writable: true,
  value: FakeMutationObserver,
});

class FakeContext {
  canvas: FakeCanvas;
  invocations: Array<{ method: string; args: unknown[] }> = [];
  private fillStyleValue = '#000000';
  throwOnFillStyleRead = false;

  constructor(canvas: FakeCanvas) {
    this.canvas = canvas;
  }

  get fillStyle() {
    if (this.throwOnFillStyleRead) {
      throw new Error('fillStyle unavailable');
    }
    return this.fillStyleValue;
  }

  set fillStyle(value: string) {
    this.fillStyleValue = value;
  }

  fillRect(...args: unknown[]) {
    this.invocations.push({ method: 'fillRect', args });
    return fillRectResult;
  }

  translate(...args: unknown[]) {
    this.invocations.push({ method: 'translate', args });
  }

  resetOutOfBand() {
    this.fillStyleValue = '#000000';
  }
}

class FakeCanvas {
  id = '';
  private context: FakeContext | null = null;
  widthValue: unknown = 300;
  heightValue: unknown = 150;
  throwOnWidthRead = false;
  throwOnSetAttribute = false;
  throwOnObserve = false;

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

  present = new Set<string>();

  hasAttribute(name: string) {
    return this.present.has(String(name).toLowerCase());
  }

  setAttribute(name: string, value: unknown) {
    if (typeof name === 'symbol') {
      // WebIDL DOMString conversion, as a browser does it.
      throw new TypeError('Cannot convert a Symbol value to a string');
    }
    if (this.throwOnSetAttribute) {
      throw new Error('setAttribute unavailable');
    }
    const attribute = String(name).toLowerCase();
    this.present.add(attribute);
    if (attribute === 'width') {
      this.widthValue = Number(value);
    } else if (attribute === 'height') {
      this.heightValue = Number(value);
    } else if (attribute === 'id') {
      this.id = String(value);
    }
  }

  // A browser resets nothing when the attribute is not there.
  removeAttribute(name: string) {
    const attribute = String(name).toLowerCase();
    if (!this.present.delete(attribute)) return;
    if (attribute === 'width') {
      this.widthValue = 300;
    } else if (attribute === 'height') {
      this.heightValue = 150;
    } else if (attribute === 'id') {
      this.id = '';
    }
  }

  resetOutOfBand() {
    this.context?.resetOutOfBand();
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

afterAll(() => {
  if (originalMutationObserverDescriptor) {
    Object.defineProperty(
      globalThis,
      'MutationObserver',
      originalMutationObserverDescriptor,
    );
  } else {
    delete (globalThis as { MutationObserver?: unknown }).MutationObserver;
  }
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

  it('refuses the next captured window after an attribute reset', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    markAttributeReset(canvas);
    context.fillRect(0, 0, 10, 10);

    expect(finish(record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-attribute-reset',
    });
  });

  it('consumes an attribute reset exactly once', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    markAttributeReset(canvas);
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 2)?.unknownReason).toBe(
      'canvas-attribute-reset',
    );

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 3)?.unknownReason).toBe('previous-window');

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 4)?.signatureStatus).toBe('same');
  });

  it('carries an uncaptured attribute reset to the next captured window', () => {
    const { canvas, context, record } = makeCanvas();

    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    finish(record, 2, 2);

    setWindowCaptured(false);
    markAttributeReset(canvas);
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 3, 2)).toBeUndefined();

    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 4, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-attribute-reset',
    });
  });

  it('does not refuse ordinary identical windows without a reset', () => {
    const { context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 2)).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
    });
  });

  it('does not refuse a later window for an observed property resize', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    canvas.width = 600;
    markAttributeReset(canvas);
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 2)?.unknownReason).not.toBe(
      'canvas-attribute-reset',
    );

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 3)?.unknownReason).not.toBe(
      'canvas-attribute-reset',
    );
  });

  it('observes width and height attributes when getContext registers a canvas', () => {
    const canvas = new FakeCanvas();

    canvas.getContext('2d');

    expect(FakeMutationObserver.observations.at(-1)).toEqual({
      target: canvas,
      options: {
        attributes: true,
        attributeFilter: ['width', 'height'],
      },
    });
  });

  it('refuses windows when MutationObserver is unavailable', async () => {
    const mutationObserverDescriptor =
      Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
    Object.defineProperty(globalThis, 'MutationObserver', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    vi.resetModules();

    try {
      const freshWrap = await import('../src/wrap-context');
      const freshFrameLoop = await import('../src/frame-loop');

      class UnobservedContext {
        fillRect() {}
      }

      class UnobservedCanvas {
        private context: UnobservedContext | null = null;

        get width() {
          return 300;
        }

        set width(_value: number) {}

        get height() {
          return 150;
        }

        set height(_value: number) {}

        getAttribute() {
          return null;
        }

        getContext(type: string) {
          if (type !== '2d') return null;
          this.context ??= new UnobservedContext();
          return this.context;
        }
      }

      freshWrap.installCanvasPatch({
        canvasProto: UnobservedCanvas.prototype,
        contextProto: UnobservedContext.prototype,
      });
      const canvas = new UnobservedCanvas();
      const context = canvas.getContext('2d')!;
      const record = freshWrap.getRecord(canvas)!;
      record.attribution = {
        nearestReactOwner: 'Unobserved',
        attributionKind: 'jsx-owner',
      };

      context.fillRect();
      freshFrameLoop.processRecord(record, 1, 1);
      context.fillRect();

      expect(
        freshFrameLoop.processRecord(record, 2, 1)?.report,
      ).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'canvas-dimensions-unmodeled',
      });
    } finally {
      if (mutationObserverDescriptor) {
        Object.defineProperty(
          globalThis,
          'MutationObserver',
          mutationObserverDescriptor,
        );
      }
      vi.resetModules();
    }
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

    const report = finish(record, 4, 2);

    expect(report).toBeDefined();
    expect(report?.signatureStatus).not.toBe('same');
  });

  it('never reports same when a resize bypasses the wrapped setter', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    canvas.widthValue = 600;
    context.fillRect(0, 0, 10, 10);

    const report = finish(record, 2);

    expect(report).toBeDefined();
    expect(report?.signatureStatus).not.toBe('same');
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

    expect(report).toBeDefined();
    expect(report?.signatureStatus).toBe('changed');
    expect(report?.signatureStatus).not.toBe('same');
  });

  it('never reports same after attribute resizes away and back', () => {
    const { canvas, context, record } = makeCanvas();

    setWindowCaptured(true);
    context.fillStyle = 'red';
    context.fillRect(0, 0, 10, 10);
    finish(record, 2, 2);

    setWindowCaptured(false);
    canvas.width = 300;
    finish(record, 3, 2);

    setWindowCaptured(true);
    context.fillStyle = 'red';
    context.fillRect(0, 0, 10, 10);
    canvas.setAttribute('width', '600');
    canvas.setAttribute('width', '300');
    const report = finish(record, 4, 2);

    expect(report).toBeDefined();
    expect(report?.signatureStatus).not.toBe('same');
  });

  it('catches a resize between windows through setAttribute', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    canvas.setAttribute('WIDTH', '600');
    const report = finish(record, 2);

    expect(report).toBeDefined();
    expect(report?.signatureStatus).not.toBe('same');
  });

  it('treats removeAttribute width as a resize', () => {
    const { canvas, record } = makeCanvas();

    canvas.setAttribute('width', '600');
    finish(record, 1);

    canvas.removeAttribute('width');
    const report = finish(record, 2);

    expect(report).toBeDefined();
    expect(report?.signatureStatus).not.toBe('same');
  });

  it('ignores removal of a dimension attribute that is not there', () => {
    const { canvas, context, record } = makeCanvas();

    // Seed the style first, so the two compared windows start from the same
    // persistent state and differ only by the removal under test.
    context.fillStyle = 'red';
    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 2)?.signatureStatus).toBe('changed');

    // No width attribute was ever set, so this is a browser no-op: it must not
    // clear modelled state the canvas still has.
    canvas.removeAttribute('width');
    expect(record.props.size).toBeGreaterThan(0);

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 3)?.signatureStatus).toBe('same');
  });

  it('still treats removal of a present dimension attribute as a resize', () => {
    const { canvas, context, record } = makeCanvas();

    canvas.setAttribute('width', '600');
    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    canvas.removeAttribute('width');
    context.fillRect(0, 0, 10, 10);
    const report = finish(record, 2);

    expect(report).toBeDefined();
    expect(report?.signatureStatus).not.toBe('same');
  });

  it('converts the attribute name once so coercion cannot hide a resize', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    // Returns 'width' on the first read and 'id' on the second. A wrapper that
    // converts separately from the native call would resize and record nothing.
    let reads = 0;
    const shifty = {
      toString() {
        reads += 1;
        return reads === 1 ? 'width' : 'id';
      },
    };
    canvas.setAttribute(shifty as unknown as string, '600');
    context.fillRect(0, 0, 10, 10);
    const report = finish(record, 2);

    expect(reads).toBe(1);
    expect(report).toBeDefined();
    expect(report?.signatureStatus).not.toBe('same');
  });

  it('lets a symbol attribute name throw as the browser would', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    expect(() =>
      canvas.setAttribute(Symbol('width') as unknown as string, '600'),
    ).toThrow(TypeError);

    // The failed call changed nothing, so the next window still compares.
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 2)?.signatureStatus).toBe('same');
  });

  it('leaves unrelated attribute writes inert', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    canvas.setAttribute('id', 'chart');
    context.fillRect(0, 0, 10, 10);

    expect(finish(record, 2)?.signatureStatus).toBe('same');
  });

  it('leaves the model untouched when setAttribute throws', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    canvas.throwOnSetAttribute = true;
    expect(() => {
      canvas.setAttribute('width', '600');
    }).toThrow('setAttribute unavailable');
    canvas.throwOnSetAttribute = false;
    context.fillRect(0, 0, 10, 10);

    expect(finish(record, 2)?.signatureStatus).toBe('same');
  });

  it('captures head state when the first activity is a resize', () => {
    const { canvas, context, record } = makeCanvas();

    setWindowCaptured(true);
    canvas.width = 300;
    context.fillRect(0, 0, 10, 10);
    finish(record, 2, 2);

    setWindowCaptured(false);
    context.fillStyle = 'red';
    finish(record, 3, 2);

    setWindowCaptured(true);
    canvas.width = 300;
    context.fillRect(0, 0, 10, 10);
    const report = finish(record, 4, 2);

    expect(report).toBeDefined();
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
