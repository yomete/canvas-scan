import {
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { processRecord } from '../src/frame-loop';
import { captureBoundary, captureCommand, createCommandCapture, disableCommandCapture, finishCommandCapture } from '../src/command-capture';
import {
  drainAttributeRecords,
  getRecord,
  getResetEvents,
  installCanvasPatch,
  isKilled,
  records,
  setResetEventCollectionEnabled,
  setWindowCaptured,
  subscribeToSelectedCommands,
} from '../src/wrap-context';

const fillRectResult = Symbol('fillRect result');
const webglContext = {};
const originalMutationObserverDescriptor =
  Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');

class FakeMutationObserver {
  static current: FakeMutationObserver | null = null;
  static throwOnTakeRecords = false;
  static observations: Array<{
    target: unknown;
    options: MutationObserverInit;
  }> = [];
  private readonly callback: MutationCallback;
  private readonly records: MutationRecord[] = [];

  constructor(callback: MutationCallback) {
    this.callback = callback;
    FakeMutationObserver.current = this;
  }

  observe(target: Node, options: MutationObserverInit) {
    if ((target as unknown as FakeCanvas).throwOnObserve) {
      throw new Error('observation unavailable');
    }
    FakeMutationObserver.observations.push({ target, options });
  }

  disconnect() {}

  takeRecords(): MutationRecord[] {
    if (FakeMutationObserver.throwOnTakeRecords) {
      throw new Error('takeRecords unavailable');
    }
    return this.records.splice(0);
  }

  deliver(): void {
    const records = this.takeRecords();
    if (records.length > 0) {
      this.callback(records, this as unknown as MutationObserver);
    }
  }

  static queue(target: FakeCanvas, attributeName: string): void {
    const observer = FakeMutationObserver.current;
    if (!observer) return;
    const observation = FakeMutationObserver.observations.find(
      entry => entry.target === target,
    );
    if (
      !observation ||
      (observation.options.attributeFilter &&
        !observation.options.attributeFilter.includes(attributeName))
    ) {
      return;
    }
    observer.records.push({
      type: 'attributes',
      target: target as unknown as Node,
      attributeName,
    } as MutationRecord);
  }

  static reset(): void {
    FakeMutationObserver.throwOnTakeRecords = false;
    FakeMutationObserver.observations = [];
    FakeMutationObserver.current?.takeRecords();
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
  throwOnNextFillRect = false;
  resetError: unknown = null;

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
    if (this.throwOnNextFillRect) {
      this.throwOnNextFillRect = false;
      throw new Error('fillRect failed');
    }
    this.invocations.push({ method: 'fillRect', args });
    return fillRectResult;
  }

  translate(...args: unknown[]) {
    this.invocations.push({ method: 'translate', args });
  }

  reset() {
    if (this.resetError) throw this.resetError;
    this.canvas.resetOutOfBand();
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
  widthSetError: unknown = null;
  heightSetError: unknown = null;
  throwOnSetAttribute = false;
  setAttributeError: unknown = null;
  removeAttributeError: unknown = null;
  throwOnObserve = false;
  afterReset: (() => void) | null = null;

  get width(): number {
    if (this.throwOnWidthRead) throw new Error('width unavailable');
    return <number>this.widthValue;
  }

  set width(value: number) {
    if (this.widthSetError) throw this.widthSetError;
    this.widthValue = value;
    this.resetOutOfBand();
    FakeMutationObserver.queue(this, 'width');
  }

  get height(): number {
    return <number>this.heightValue;
  }

  set height(value: number) {
    if (this.heightSetError) throw this.heightSetError;
    this.heightValue = value;
    this.resetOutOfBand();
    FakeMutationObserver.queue(this, 'height');
  }

  getAttribute(name: string) {
    return name === 'id' ? this.id : null;
  }

  present = new Set<string>();

  hasAttribute(name: string) {
    return this.present.has(String(name).toLowerCase());
  }

  setAttribute(name: string, value: unknown) {
    if (this.setAttributeError) throw this.setAttributeError;
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
      this.resetOutOfBand();
      FakeMutationObserver.queue(this, 'width');
    } else if (attribute === 'height') {
      this.heightValue = Number(value);
      this.resetOutOfBand();
      FakeMutationObserver.queue(this, 'height');
    } else if (attribute === 'id') {
      this.id = String(value);
    }
  }

  setAttributeNS(_namespace: string | null, name: string, value: unknown) {
    const attribute = String(name).toLowerCase();
    this.present.add(attribute);
    if (attribute === 'width') {
      this.widthValue = Number(value);
      this.resetOutOfBand();
      FakeMutationObserver.queue(this, 'width');
    } else if (attribute === 'height') {
      this.heightValue = Number(value);
      this.resetOutOfBand();
      FakeMutationObserver.queue(this, 'height');
    }
  }

  // A browser resets nothing when the attribute is not there.
  removeAttribute(name: string) {
    if (this.removeAttributeError) throw this.removeAttributeError;
    const attribute = String(name).toLowerCase();
    if (!this.present.delete(attribute)) return;
    if (attribute === 'width') {
      this.widthValue = 300;
      this.resetOutOfBand();
      FakeMutationObserver.queue(this, 'width');
    } else if (attribute === 'height') {
      this.heightValue = 150;
      this.resetOutOfBand();
      FakeMutationObserver.queue(this, 'height');
    } else if (attribute === 'id') {
      this.id = '';
    }
  }

  resetOutOfBand() {
    this.context?.resetOutOfBand();
    this.afterReset?.();
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
  setResetEventCollectionEnabled(false);
  setWindowCaptured(true);
  FakeMutationObserver.reset();
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
  it('keeps a hostile ignored argument inside selected detail capture', () => {
    const { context, record } = makeCanvas();
    const capture = createCommandCapture()!;
    let traps = 0;
    const handler = Object.fromEntries(['get', 'set', 'has', 'ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf', 'setPrototypeOf', 'defineProperty', 'deleteProperty', 'isExtensible', 'preventExtensions', 'apply', 'construct'].map(name => [name, () => { traps++; throw new Error(name); }]));
    const hostile = new Proxy(function privateFunction() {}, handler);
    let decoyRecord: typeof record | undefined;
    const unsubscribe = subscribeToSelectedCommands(
      record,
      (operationKind, name, args, sampled) => captureCommand(capture, operationKind, name, args, sampled),
      (windowIndex, timestampMs, active, sampled) => captureBoundary(capture, windowIndex, timestampMs, active, sampled),
      () => disableCommandCapture(capture),
    );
    try {
      expect(context.fillRect(0, 0, 1, 1, hostile)).toBe(fillRectResult);
      captureBoundary(capture, 10, 10, true, true);
      const result = finishCommandCapture(capture, 11, 11);
      expect(traps).toBe(0);
      expect(result.windows[0]).toMatchObject({ complete: false, unknownReason: 'sampling-gap', commands: [{ unknownReason: 'unsupported-value' }] });
      expect(result.firstGap).toEqual({ windowIndex: 10, commandOrdinal: 0, reason: 'sampling-gap' });
      expect(JSON.stringify(result)).not.toContain('privateFunction');
      expect(isKilled()).toBe(false);
      const decoy = makeCanvas();
      decoyRecord = decoy.record;
      decoy.context.fillRect(0, 0, 1, 1);
      expect(finish(decoy.record, 11)).toBeDefined();
    } finally {
      unsubscribe();
      records.delete(record);
      if (decoyRecord) records.delete(decoyRecord);
    }
  });

  it('does not read a stored application value from selected head state', () => {
    const { context, record } = makeCanvas();
    let constructorReads = 0;
    const applicationValue = {
      get constructor() { constructorReads++; return Object; },
      toString() { return '#123456'; },
    };
    context.fillStyle = applicationValue as unknown as string;
    finish(record, 1);
    constructorReads = 0;
    const capture = createCommandCapture()!;
    const unsubscribe = subscribeToSelectedCommands(
      record,
      (operationKind, name, args, sampled) => captureCommand(capture, operationKind, name, args, sampled),
      (windowIndex, timestampMs, active, sampled) => captureBoundary(capture, windowIndex, timestampMs, active, sampled),
      () => disableCommandCapture(capture),
    );
    try {
      context.fillRect(0, 0, 1, 1);
      expect(constructorReads).toBe(0);
      expect(finish(record, 2)).toMatchObject({ signatureStatus: 'unknown', unknownReason: 'selected-head-state-unmodeled' });
      expect(constructorReads).toBe(0);
    } finally {
      unsubscribe();
      records.delete(record);
    }
  });

  it('records each successful native reset once with its source and resulting dimensions', () => {
    const { canvas, context, record } = makeCanvas();
    setResetEventCollectionEnabled(true);

    canvas.width = canvas.width;
    canvas.height = 160;
    canvas.setAttribute('width', '320');
    canvas.present.add('height');
    canvas.removeAttribute('height');
    canvas.setAttributeNS(null, 'width', '330');
    drainAttributeRecords();
    context.reset();

    expect(getResetEvents(record)).toEqual([
      { source: 'width-setter', width: 300, height: 150, dimensionChange: 'unchanged' },
      { source: 'height-setter', width: 300, height: 160, dimensionChange: 'changed' },
      { source: 'width-attribute', width: 320, height: 160, dimensionChange: 'changed' },
      { source: 'height-attribute', width: 320, height: 150, dimensionChange: 'changed' },
      { source: 'width-attribute', width: 330, height: 150, dimensionChange: 'unavailable' },
      { source: 'context-reset', width: 330, height: 150, dimensionChange: 'unchanged' },
    ]);
    records.delete(record);
  });

  it('does not record failed resets and preserves each native error object', () => {
    const { canvas, context, record } = makeCanvas();
    setResetEventCollectionEnabled(true);
    const cases: Array<[unknown, () => void, () => void]> = [
      [new Error('width failed'), () => { canvas.width = 1; }, () => { canvas.widthSetError = null; }],
      [new Error('height failed'), () => { canvas.height = 1; }, () => { canvas.heightSetError = null; }],
      [new Error('setAttribute failed'), () => { canvas.setAttribute('width', '1'); }, () => { canvas.setAttributeError = null; }],
      [new Error('removeAttribute failed'), () => { canvas.removeAttribute('width'); }, () => { canvas.removeAttributeError = null; }],
      [new Error('reset failed'), () => { context.reset(); }, () => { context.resetError = null; }],
    ];
    canvas.present.add('width');

    for (const [error, call, clear] of cases) {
      if ((error as Error).message === 'width failed') canvas.widthSetError = error;
      if ((error as Error).message === 'height failed') canvas.heightSetError = error;
      if ((error as Error).message === 'setAttribute failed') canvas.setAttributeError = error;
      if ((error as Error).message === 'removeAttribute failed') canvas.removeAttributeError = error;
      if ((error as Error).message === 'reset failed') context.resetError = error;
      let thrown: unknown;
      try { call(); } catch (caught) { thrown = caught; }
      expect(thrown).toBe(error);
      clear();
    }

    expect(getResetEvents(record)).toEqual([]);
    canvas.present.delete('width');
    canvas.removeAttribute('width');
    expect(getResetEvents(record)).toEqual([]);
    records.delete(record);
  });

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

  it('reports every same-value resize-and-draw window as reset', () => {
    const { canvas, context, record } = makeCanvas();

    for (let index = 1; index <= 3; index++) {
      canvas.width = canvas.width;
      context.fillRect(1, 2, 3, 4);
      expect(finish(record, index)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'canvas-reset',
      });
    }
  });

  it('does not baseline commands captured before a same-window reset', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    canvas.width = canvas.width;
    expect(finish(record, 1)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'first-window',
    });

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 3)).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
    });
  });

  it.each([
    [
      'width property',
      ({ canvas }: ReturnType<typeof makeCanvas>) => {
        canvas.width = canvas.width;
      },
    ],
    [
      'setAttribute',
      ({ canvas }: ReturnType<typeof makeCanvas>) => {
        canvas.setAttribute('width', String(canvas.width));
      },
    ],
    [
      'removeAttribute',
      ({ canvas }: ReturnType<typeof makeCanvas>) => {
        canvas.present.add('width');
        canvas.removeAttribute('width');
      },
    ],
    [
      'context reset',
      ({ context }: ReturnType<typeof makeCanvas>) => {
        context.reset();
      },
    ],
  ])(
    'keeps the model untrusted when context activity reenters %s',
    (_name, runReset) => {
      const fixture = makeCanvas();
      fixture.canvas.afterReset = () => {
        fixture.context.translate(10, 0);
      };
      runReset(fixture);
      fixture.canvas.afterReset = null;
      fixture.context.fillRect(0, 0, 10, 10);
      expect(finish(fixture.record, 1)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'canvas-reset',
      });

      fixture.context.fillRect(0, 0, 10, 10);
      expect(finish(fixture.record, 2)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'canvas-state-unmodeled',
      });
    },
  );

  it('propagates context activity through nested exact resets', () => {
    const { canvas, context, record } = makeCanvas();
    let nested = false;
    canvas.afterReset = () => {
      if (!nested) {
        nested = true;
        canvas.height = canvas.height;
      } else {
        context.translate(10, 0);
      }
    };

    canvas.width = canvas.width;
    canvas.afterReset = null;
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 1)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-state-unmodeled',
    });
    expect(record.exactResetDepth).toBe(0);
  });

  it('reports an observer-only attribute reset in the affected window', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    canvas.setAttributeNS(null, 'width', '300');
    context.fillRect(0, 0, 10, 10);
    drainAttributeRecords();

    expect(finish(record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-attribute-reset',
    });
  });

  it('does not double-advance and keeps an overlapped model untrusted', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    const beforeResetVersion = record.resetVersion;
    canvas.setAttributeNS(null, 'width', '300');
    context.fillRect(0, 0, 10, 10);
    drainAttributeRecords();
    expect(finish(record, 2)?.unknownReason).toBe(
      'canvas-attribute-reset',
    );
    expect(record.resetVersion).toBe(beforeResetVersion + 1);

    // A callback after takeRecords() has drained the queue must see nothing.
    FakeMutationObserver.current?.deliver();
    expect(record.resetVersion).toBe(beforeResetVersion + 1);

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 3)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-state-unmodeled',
    });

    canvas.width = canvas.width;
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 4)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 5)).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
    });

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 6)).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
    });
  });

  it('handles callback delivery and takeRecords delivery equivalently', () => {
    const drained = makeCanvas();
    const delivered = makeCanvas();

    drained.context.fillRect(0, 0, 10, 10);
    delivered.context.fillRect(0, 0, 10, 10);
    finish(drained.record, 1);
    finish(delivered.record, 1);

    delivered.canvas.setAttributeNS(null, 'width', '300');
    FakeMutationObserver.current?.deliver();
    drained.canvas.setAttributeNS(null, 'width', '300');
    drainAttributeRecords();

    drained.context.fillRect(0, 0, 10, 10);
    delivered.context.fillRect(0, 0, 10, 10);
    expect(finish(drained.record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-attribute-reset',
    });
    expect(finish(delivered.record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-attribute-reset',
    });
  });

  it('keeps a delivered reset barrier after the first draw throws', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    canvas.setAttributeNS(null, 'width', '300');
    FakeMutationObserver.current?.deliver();
    context.throwOnNextFillRect = true;
    expect(() => context.fillRect(0, 0, 10, 10)).toThrow(
      'fillRect failed',
    );

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-attribute-reset',
    });
  });

  it('does not blanket-poison an unrelated healthy canvas', () => {
    const reset = makeCanvas();
    const healthy = makeCanvas();

    reset.context.fillRect(0, 0, 10, 10);
    healthy.context.fillRect(0, 0, 10, 10);
    finish(reset.record, 1);
    finish(healthy.record, 1);

    reset.canvas.setAttributeNS(null, 'width', '300');
    reset.context.fillRect(0, 0, 10, 10);
    healthy.context.fillRect(0, 0, 10, 10);
    drainAttributeRecords();

    expect(finish(reset.record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-attribute-reset',
    });
    expect(finish(healthy.record, 2)).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
    });
  });

  it('carries an uncaptured observer reset to the next captured window', () => {
    const { canvas, context, record } = makeCanvas();

    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    finish(record, 2, 2);

    setWindowCaptured(false);
    canvas.setAttributeNS(null, 'width', '300');
    context.fillRect(0, 0, 10, 10);
    drainAttributeRecords();
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

  it('drains a property reset record without poisoning a later healthy window', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    const beforeResetVersion = record.resetVersion;
    canvas.width = 600;
    expect(record.resetVersion).toBe(beforeResetVersion + 1);
    drainAttributeRecords();
    expect(record.resetVersion).toBe(beforeResetVersion + 1);
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 3)).toMatchObject({
      signatureStatus: 'changed',
      unknownReason: null,
    });

    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 4)).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
    });
  });

  it('observes width and height attributes when getContext registers a canvas', () => {
    const canvas = new FakeCanvas();

    canvas.getContext('2d');

    expect(FakeMutationObserver.observations.at(-1)).toEqual({
      target: canvas,
      options: {
        attributes: true,
        attributeFilter: ['width', 'height'],
        attributeOldValue: true,
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

  it('reports an uncaptured synchronous reset at the next captured window', () => {
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

    expect(report).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });
  });

  it('reports changed when live dimensions bypass the wrapped setter', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    canvas.widthValue = 600;
    context.fillRect(0, 0, 10, 10);

    const report = finish(record, 2);

    expect(report).toMatchObject({
      signatureStatus: 'changed',
      unknownReason: null,
    });
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

  it('reports a changed-dimension property reset as unknown', () => {
    const { canvas, context, record } = makeCanvas();

    canvas.width = 100;
    context.fillRect(1, 2, 3, 4);
    finish(record, 1);

    canvas.width = 200;
    context.fillRect(1, 2, 3, 4);
    const report = finish(record, 2);

    expect(report).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });
  });

  it('reports observer-only resizes away and back as unknown', () => {
    const { canvas, context, record } = makeCanvas();

    setWindowCaptured(true);
    context.fillStyle = 'red';
    context.fillRect(0, 0, 10, 10);
    finish(record, 2, 2);

    setWindowCaptured(false);
    canvas.setAttributeNS(null, 'width', '600');
    drainAttributeRecords();
    finish(record, 3, 2);

    setWindowCaptured(true);
    context.fillStyle = 'red';
    context.fillRect(0, 0, 10, 10);
    canvas.setAttributeNS(null, 'width', '300');
    drainAttributeRecords();
    const report = finish(record, 4, 2);

    expect(report).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-attribute-reset',
    });
  });

  it('reports a direct attribute reset even without a draw', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    canvas.setAttribute('WIDTH', '600');
    const report = finish(record, 2);

    expect(report).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
      rasterOperationCount: 0,
    });
  });

  it('treats removal of a present width attribute as a reset', () => {
    const { canvas, record } = makeCanvas();

    canvas.setAttribute('width', '600');
    finish(record, 1);

    canvas.removeAttribute('width');
    const report = finish(record, 2);

    expect(report).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });
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

  it('still treats removal of a present dimension attribute as a reset', () => {
    const { canvas, context, record } = makeCanvas();

    canvas.setAttribute('width', '600');
    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    canvas.removeAttribute('width');
    context.fillRect(0, 0, 10, 10);
    const report = finish(record, 2);

    expect(report).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });
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
    expect(report).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });
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

  it('keeps the reset barrier when the first activity is a resize', () => {
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

    expect(report).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });
  });

  it('reports both width and height resets with identical dimensions', () => {
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
    const widthReport = finish(record, 1);

    canvas.height = 200;
    context.fillRect(1, 2, 3, 4);
    const heightReport = finish(record, 2);

    expect(widthReport).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });
    expect(heightReport).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });
  });

  it('keeps the reset barrier regardless of its command-stream position', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(1, 2, 3, 4);
    canvas.width = 200;
    const resetAfterDraw = finish(record, 1);

    canvas.width = 200;
    context.fillRect(1, 2, 3, 4);
    const resetBeforeDraw = finish(record, 2);

    expect(resetAfterDraw).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });
    expect(resetBeforeDraw).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });
  });

  it('does not compare repeated reset-only windows', () => {
    const { canvas, record } = makeCanvas();

    canvas.width = 200;

    expect(finish(record, 1)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });

    canvas.width = 200;

    expect(finish(record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
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

    expect(finish(record, 4, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });

    setWindowCaptured(false);
    context.fillRect(1, 2, 3, 4);
    finish(record, 5, 2);
    setWindowCaptured(true);
    context.fillRect(1, 2, 3, 4);
    expect(finish(record, 6, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'uncaptured-raster',
    });

    setWindowCaptured(false);
    finish(record, 7, 2);
    setWindowCaptured(true);
    context.fillRect(1, 2, 3, 4);
    expect(finish(record, 8, 2)).toMatchObject({
      signatureStatus: 'same',
      unknownReason: null,
    });
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

    expect(finish(record, 4, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-reset',
    });
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

  it('fails closed when the observer queue cannot be drained', () => {
    const { canvas, context, record } = makeCanvas();

    context.fillRect(0, 0, 10, 10);
    finish(record, 1);

    canvas.setAttributeNS(null, 'width', '300');
    context.fillRect(0, 0, 10, 10);
    FakeMutationObserver.throwOnTakeRecords = true;
    expect(() => drainAttributeRecords()).not.toThrow();
    FakeMutationObserver.throwOnTakeRecords = false;

    expect(finish(record, 2)).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'canvas-dimensions-unmodeled',
    });
  });
});
