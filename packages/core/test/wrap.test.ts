import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { processRecord } from '../src/frame-loop';
import {
  captureBoundary,
  captureCommand,
  createCommandCapture,
  disableCommandCapture,
  finishCommandCapture,
  getCommandEntryAllocationCount,
  resetCommandCaptureForTests,
} from '../src/command-capture';
import { captureDrawCallsite, createDrawCallsiteCapture, getDrawCallsiteTestCounts, resetDrawCallsiteForTests } from '../src/draw-callsite';
import {
  getRecord,
  getMethodEvidence,
  getResetEvents,
  installCanvasPatch,
  isKilled,
  records,
  refreshContentToken,
  setMethodEvidenceCollectionEnabled,
  setResetEventCollectionEnabled,
  setWindowCaptured,
  subscribeToSelectedCommands,
  takeLifecycleEvents,
} from '../src/wrap-context';

const fillRectResult = Symbol('fillRect result');

class FakeContext {
  canvas: FakeCanvas;
  invocations: Array<{ method: string; args: unknown[] }> = [];
  throwOnFillRect: Error | null = null;
  throwOnFillStyle: Error | null = null;
  private fillStyleValue = '#000000';

  constructor(canvas: FakeCanvas) {
    this.canvas = canvas;
  }

  get fillStyle() {
    return this.fillStyleValue;
  }

  set fillStyle(value: string) {
    if (this.throwOnFillStyle) throw this.throwOnFillStyle;
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

  save(...args: unknown[]) {
    this.invocations.push({ method: 'save', args });
  }

  restore(...args: unknown[]) {
    this.invocations.push({ method: 'restore', args });
  }

  reset() {
    this.invocations.push({ method: 'reset', args: [] });
  }

  getImageData(...args: unknown[]) {
    this.invocations.push({ method: 'getImageData', args });
    return { data: new Uint8ClampedArray(4) };
  }

  measureText(...args: unknown[]) {
    this.invocations.push({ method: 'measureText', args });
    return { width: 10 };
  }

  boom() {
    throw new Error('boom');
  }
}

class FakeCanvas {
  id = '';
  isConnected = false;
  private context: FakeContext | null = null;

  get width() {
    return 300;
  }

  get height() {
    return 150;
  }

  getAttribute(name: string) {
    return name === 'id' ? this.id : null;
  }

  getContext(type: string) {
    if (type !== '2d') return null;
    this.context ??= new FakeContext(this);
    return this.context;
  }

  toDataURL(..._args: unknown[]) {
    return 'data:image/png;base64,';
  }

  toBlob(callback: (blob: null) => void) {
    callback(null);
  }
}

installCanvasPatch({
  canvasProto: FakeCanvas.prototype,
  contextProto: FakeContext.prototype,
  attributeObserver: { observe() {}, takeRecords: () => [] },
});

const canvas = new FakeCanvas();
const context = canvas.getContext('2d')!;

beforeAll(() => setMethodEvidenceCollectionEnabled(true));
afterAll(() => setMethodEvidenceCollectionEnabled(false));

describe('canvas context wrapping', () => {
  it('collects successful context reset evidence only while enabled', () => {
    const record = getRecord(canvas)!;
    setResetEventCollectionEnabled(false);
    context.reset();
    expect(getResetEvents(record)).toEqual([]);
    setResetEventCollectionEnabled(true);
    context.reset();
    expect(getResetEvents(record)).toEqual([{ source: 'context-reset', width: 300, height: 150, dimensionChange: 'unchanged' }]);
    setResetEventCollectionEnabled(false);
  });
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

  it('keeps method counts and measured time separate', () => {
    const record = getRecord(canvas)!;
    setMethodEvidenceCollectionEnabled(true);
    record.selfTimeMs = 0;
    const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(10).mockReturnValueOnce(11.25).mockReturnValueOnce(20).mockReturnValueOnce(23.5);
    context.fillRect(1, 2, 3, 4);
    context.clearRect(1, 2, 3, 4);
    expect(getMethodEvidence(record)).toEqual({ fillRect: { count: 1, canvasApiSelfTimeMs: 1.25 }, clearRect: { count: 1, canvasApiSelfTimeMs: 3.5 } });
    expect(record.selfTimeMs).toBe(4.75);
    clock.mockRestore();
  });

  it('times getImageData and measureText without putting them in the signature', () => {
    const record = getRecord(canvas)!;
    setMethodEvidenceCollectionEnabled(true);
    record.selfTimeMs = 0;
    record.rasterOps = 0;
    record.activeInWindow = false;
    const before = record.sig.hash;
    const clock = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0).mockReturnValueOnce(2)
      .mockReturnValueOnce(10).mockReturnValueOnce(10.5);

    context.getImageData(0, 0, 1, 1);
    context.measureText('hello');

    // Counted and timed, so the work is no longer invisible.
    expect(getMethodEvidence(record)).toEqual({
      getImageData: { count: 1, canvasApiSelfTimeMs: 2 },
      measureText: { count: 1, canvasApiSelfTimeMs: 0.5 },
    });
    expect(record.selfTimeMs).toBe(2.5);
    // The canvas is active, so the window is reported at all.
    expect(record.activeInWindow).toBe(true);
    // Neither draws, so neither is a raster operation and neither changes the
    // command signature — two identical redraws around them still compare same.
    expect(record.rasterOps).toBe(0);
    expect(record.sig.hash).toBe(before);
    clock.mockRestore();
  });

  it('times toDataURL and toBlob on the element and lands the cost on its canvas', () => {
    const record = getRecord(canvas)!;
    setMethodEvidenceCollectionEnabled(true);
    record.selfTimeMs = 0;
    record.rasterOps = 0;
    record.activeInWindow = false;
    const before = record.sig.hash;
    const clock = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0).mockReturnValueOnce(3)
      .mockReturnValueOnce(10).mockReturnValueOnce(10.25);
    const callback = vi.fn();

    expect(canvas.toDataURL('image/png')).toBe('data:image/png;base64,');
    canvas.toBlob(callback);

    // The readback is on the element, but the cost lands on the canvas's
    // record, so it reaches topMethods like getImageData does.
    expect(callback).toHaveBeenCalledWith(null);
    expect(getMethodEvidence(record)).toEqual({
      toDataURL: { count: 1, canvasApiSelfTimeMs: 3 },
      toBlob: { count: 1, canvasApiSelfTimeMs: 0.25 },
    });
    expect(record.selfTimeMs).toBe(3.25);
    expect(record.activeInWindow).toBe(true);
    expect(record.rasterOps).toBe(0);
    expect(record.sig.hash).toBe(before);
    clock.mockRestore();
  });

  it('records successful setters without timing them', () => {
    const record = getRecord(canvas)!;
    setMethodEvidenceCollectionEnabled(true);
    const clock = vi.spyOn(performance, 'now');
    context.fillStyle = '#123456';
    expect(getMethodEvidence(record).fillStyle).toEqual({ count: 1, canvasApiSelfTimeMs: null });
    expect(clock).not.toHaveBeenCalled();
    clock.mockRestore();
  });

  it('records reset with its existing measured duration', () => {
    const record = getRecord(canvas)!;
    setMethodEvidenceCollectionEnabled(true);
    const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(4).mockReturnValueOnce(6.5);
    context.reset();
    expect(getMethodEvidence(record).reset).toEqual({ count: 1, canvasApiSelfTimeMs: 2.5 });
    expect(context.invocations.at(-1)).toEqual({ method: 'reset', args: [] });
    clock.mockRestore();
  });

  it('does not record a failed setter and preserves its native error', () => {
    const nativeError = new Error('setter failure');
    const record = getRecord(canvas)!;
    setMethodEvidenceCollectionEnabled(true);
    context.throwOnFillStyle = nativeError;
    try {
      expect(() => { context.fillStyle = '#123456'; }).toThrow(nativeError);
      expect(getMethodEvidence(record).fillStyle).toBeUndefined();
    } finally {
      context.throwOnFillStyle = null;
    }
  });

  it('keeps detailed method evidence off outside a recording', () => {
    const record = getRecord(canvas)!;
    setMethodEvidenceCollectionEnabled(false);
    try {
      context.fillRect(1, 2, 3, 4);
      context.fillStyle = '#abcdef';
      expect(getMethodEvidence(record)).toEqual({});
    } finally {
      setMethodEvidenceCollectionEnabled(true);
    }
  });

  it('propagates the same native error instance', () => {
    const nativeError = new Error('native failure');
    setMethodEvidenceCollectionEnabled(true);
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
    expect(getMethodEvidence(getRecord(canvas)!).fillRect).toBeUndefined();
  });

  it('records the first observed connection state', () => {
    const connectedCanvas = new FakeCanvas();
    connectedCanvas.isConnected = true;
    connectedCanvas.getContext('2d');
    const record = getRecord(connectedCanvas)!;

    expect(takeLifecycleEvents(record)).toEqual([
      {
        type: 'first-observed',
        connected: true,
        activeRegistrySize: records.size,
      },
    ]);
  });

  it('reactivates the same retired record before capture', () => {
    const retiredCanvas = new FakeCanvas();
    const retiredContext = retiredCanvas.getContext('2d')!;
    const record = getRecord(retiredCanvas)!;
    const id = record.id;
    takeLifecycleEvents(record);
    record.prev = { hash: record.sig.hash, unknown: false, windowIndex: 1 };
    records.delete(record);
    record.retired = true;
    record.inactiveBoundaries = 120;

    retiredContext.fillRect(0, 0, 10, 10);

    expect(getRecord(retiredCanvas)).toBe(record);
    expect(record.id).toBe(id);
    expect(records.has(record)).toBe(true);
    expect(record.retired).toBe(false);
    expect(takeLifecycleEvents(record).map(event => event.type)).toEqual([
      'reactivated',
      'active',
    ]);
    expect(processRecord(record, 2, 1)?.report).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'first-window',
    });
  });

  it('rolls back reactivation when the native method throws', () => {
    const retiredCanvas = new FakeCanvas();
    const retiredContext = retiredCanvas.getContext('2d')!;
    const record = getRecord(retiredCanvas)!;
    const id = record.id;
    const nativeError = new Error('retired native failure');
    takeLifecycleEvents(record);
    record.prev = { hash: record.sig.hash, unknown: false, windowIndex: 1 };
    records.delete(record);
    record.retired = true;
    record.inactiveBoundaries = 120;
    retiredContext.throwOnFillRect = nativeError;

    expect(() => retiredContext.fillRect(0, 0, 10, 10)).toThrow(nativeError);
    expect(getRecord(retiredCanvas)).toBe(record);
    expect(record.id).toBe(id);
    expect(records.has(record)).toBe(false);
    expect(record.retired).toBe(true);
    expect(takeLifecycleEvents(record)).toEqual([]);

    retiredContext.throwOnFillRect = null;
    retiredContext.fillRect(0, 0, 10, 10);
    expect(processRecord(record, 2, 1)?.report).toMatchObject({
      signatureStatus: 'unknown',
      unknownReason: 'first-window',
    });
  });

  it('captures only successful commands from the selected record', () => {
    const selectedCanvas = new FakeCanvas();
    const selectedContext = selectedCanvas.getContext('2d')!;
    const selectedRecord = getRecord(selectedCanvas)!;
    const decoyCanvas = new FakeCanvas();
    const decoyContext = decoyCanvas.getContext('2d')!;
    const capture = createCommandCapture()!;
    const unsubscribe = subscribeToSelectedCommands(
      selectedRecord,
      (operationKind, name, args, sampled) => captureCommand(capture, operationKind, name, args, sampled),
      (windowIndex, timestampMs, active, sampled) => captureBoundary(capture, windowIndex, timestampMs, active, sampled),
      () => disableCommandCapture(capture),
    );
    resetCommandCaptureForTests();
    try {
      decoyContext.fillRect(0, 0, 1, 1);
      expect(getCommandEntryAllocationCount()).toBe(0);

      selectedContext.save({ privateKey: 'privateValue' });
      selectedContext.fillStyle = 'opaque-private-string';
      selectedContext.fillRect(1, 2, 3, 4);
      selectedContext.restore();
      expect(getCommandEntryAllocationCount()).toBe(4);
      captureBoundary(capture, 10, 10, true, true);

      const beforeFailure = getCommandEntryAllocationCount();
      selectedContext.throwOnFillRect = new Error('native call failed');
      expect(() => selectedContext.fillRect(1, 2, 3, 4)).toThrow('native call failed');
      selectedContext.throwOnFillRect = null;
      selectedContext.throwOnFillStyle = new Error('native setter failed');
      expect(() => { selectedContext.fillStyle = '#123456'; }).toThrow('native setter failed');
      selectedContext.throwOnFillStyle = null;
      expect(getCommandEntryAllocationCount()).toBe(beforeFailure);

      selectedContext.save({ privateKey: 'privateValue' });
      selectedContext.fillStyle = 'opaque-private-string';
      selectedContext.fillRect(1, 2, 3, 4);
      selectedContext.restore();
      captureBoundary(capture, 11, 11, true, true);
      const result = finishCommandCapture(capture, 12, 12);
      expect(result.windows.map(window => window.commands.map(command => [command.operationKind, command.name]))).toEqual([
        [['call', 'save'], ['set', 'fillStyle'], ['call', 'fillRect'], ['call', 'restore']],
        [['call', 'save'], ['set', 'fillStyle'], ['call', 'fillRect'], ['call', 'restore']],
      ]);
      expect(JSON.stringify(result)).not.toContain('privateValue');
      expect(JSON.stringify(result)).not.toContain('opaque-private-string');
    } finally {
      selectedContext.throwOnFillRect = null;
      selectedContext.throwOnFillStyle = null;
      unsubscribe();
    }

    resetCommandCaptureForTests();
    selectedContext.fillRect(0, 0, 1, 1);
    expect(getCommandEntryAllocationCount()).toBe(0);
  });

  // Found on excalidraw.com: 124 of 128 canvases were created imperatively, so
  // React knew nothing about them and the tool had no place in the source to
  // send the reader. The creation site is that place, and it has to be taken
  // where the canvas is first seen — by the time anyone asks, the stack is gone.
  it('remembers where a canvas was first asked for a 2D context', () => {
    resetDrawCallsiteForTests();
    const canvas = new FakeCanvas();
    canvas.getContext('2d');
    const site = getRecord(canvas)!.creationSite;
    expect(site).not.toBeNull();
    expect(site!.file).toContain('wrap.test');
    expect(site!.line).toBeGreaterThan(0);
    expect(getDrawCallsiteTestCounts().creationSiteStacks).toBe(1);
  });

  it('offers stack capture only for a successful selected raster call', () => {
    resetDrawCallsiteForTests();
    const selectedCanvas = new FakeCanvas();
    const selectedContext = selectedCanvas.getContext('2d')!;
    const selectedRecord = getRecord(selectedCanvas)!;
    const decoyContext = new FakeCanvas().getContext('2d')!;
    decoyContext.fillRect(0, 0, 1, 1);
    selectedContext.fillRect(0, 0, 1, 1);
    // The promise this guards: no explanation asked for, no explanation stack
    // allocated. The two creation sites are the standing cost of the two
    // canvases, counted separately so it cannot hide here.
    expect(getDrawCallsiteTestCounts()).toEqual({ stackAllocations: 0, sourceMapLookups: 0, creationSiteStacks: 2 });

    const capture = createCommandCapture()!;
    const callsites = createDrawCallsiteCapture({ locationHref: 'http://example.test/', fetch: vi.fn() as unknown as typeof fetch });
    const target = {};
    const unsubscribe = subscribeToSelectedCommands(
      selectedRecord,
      (operationKind, name, args, sampled) => captureCommand(capture, operationKind, name, args, sampled),
      (windowIndex, timestampMs, active, sampled) => captureBoundary(capture, windowIndex, timestampMs, active, sampled),
      () => disableCommandCapture(capture),
      (command, rasterOperation) => {
        if (rasterOperation) captureDrawCallsite(callsites, target, command.ordinal, ['first-raster'], 'Error\n    at application (https://other.test/app.js:1:1)');
      },
    );
    try {
      decoyContext.fillRect(1, 1, 1, 1);
      selectedContext.fillStyle = '#123456';
      selectedContext.throwOnFillRect = new Error('native failure');
      expect(() => selectedContext.fillRect(2, 2, 1, 1)).toThrow('native failure');
      expect(getDrawCallsiteTestCounts().stackAllocations).toBe(0);
      selectedContext.throwOnFillRect = null;
      expect(selectedContext.fillRect(3, 3, 1, 1)).toBe(fillRectResult);
      expect(getDrawCallsiteTestCounts()).toEqual({ stackAllocations: 1, sourceMapLookups: 0, creationSiteStacks: 2 });
    } finally {
      selectedContext.throwOnFillRect = null;
      unsubscribe();
    }
  });

  it('does not invoke selected hostile object traps or disable global instrumentation', () => {
    const selectedCanvas = new FakeCanvas();
    const selectedContext = selectedCanvas.getContext('2d')!;
    const selectedRecord = getRecord(selectedCanvas)!;
    const capture = createCommandCapture()!;
    let traps = 0;
    const handler = Object.fromEntries(['get', 'set', 'has', 'ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf', 'setPrototypeOf', 'defineProperty', 'deleteProperty', 'isExtensible', 'preventExtensions'].map(name => [name, () => { traps++; throw new Error(name); }]));
    const hostile = new Proxy({}, handler);
    const unsubscribe = subscribeToSelectedCommands(
      selectedRecord,
      (operationKind, name, args, sampled) => captureCommand(capture, operationKind, name, args, sampled),
      (windowIndex, timestampMs, active, sampled) => captureBoundary(capture, windowIndex, timestampMs, active, sampled),
      () => disableCommandCapture(capture),
    );
    try {
      expect(() => selectedContext.save(hostile)).not.toThrow();
      captureBoundary(capture, 20, 20, true, true);
      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      expect(() => selectedContext.save(revoked.proxy)).not.toThrow();
      captureBoundary(capture, 21, 21, true, true);
      const result = finishCommandCapture(capture, 22, 22);
      expect(traps).toBe(0);
      expect(result.windows[1]).toMatchObject({ complete: false, unknownReason: 'unsupported-value' });
      expect(isKilled()).toBe(false);
    } finally {
      unsubscribe();
    }
  });

  it('labels and tracks a mutable registered drawImage source without reading it', () => {
    const selectedCanvas = new FakeCanvas();
    const selectedContext = selectedCanvas.getContext('2d')!;
    const selectedRecord = getRecord(selectedCanvas)!;
    const sourceCanvas = new FakeCanvas();
    sourceCanvas.getContext('2d');
    const sourceRecord = getRecord(sourceCanvas)!;
    const capture = createCommandCapture()!;
    const unsubscribe = subscribeToSelectedCommands(
      selectedRecord,
      (operationKind, name, args, sampled) => captureCommand(capture, operationKind, name, args, sampled),
      (windowIndex, timestampMs, active, sampled) => captureBoundary(capture, windowIndex, timestampMs, active, sampled),
      () => disableCommandCapture(capture),
    );
    try {
      selectedContext.drawImage(sourceCanvas, 0, 0);
      captureBoundary(capture, 30, 30, true, true);
      expect(processRecord(selectedRecord, 30, 1)?.report.signatureStatus).toBe('unknown');
      selectedContext.drawImage(sourceCanvas, 0, 0);
      captureBoundary(capture, 31, 31, true, true);
      expect(processRecord(selectedRecord, 31, 1)?.report.signatureStatus).toBe('same');
      sourceRecord.contentVersion++;
      refreshContentToken(sourceRecord);
      selectedContext.drawImage(sourceCanvas, 0, 0);
      captureBoundary(capture, 32, 32, true, true);
      expect(processRecord(selectedRecord, 32, 1)?.report.signatureStatus).toBe('changed');
      const result = finishCommandCapture(capture, 33, 33);
      expect(result.windows[0].commands[0].arguments[0].kind).toBe('canvas');
      expect(result.comparisons.at(-1)).toMatchObject({ status: 'changed', difference: { ordinal: 0, reason: 'argument-token' } });
    } finally {
      unsubscribe();
    }
  });

  it('contains a selected detail failure without changing the native call', () => {
    const selectedCanvas = new FakeCanvas();
    const selectedContext = selectedCanvas.getContext('2d')!;
    const selectedRecord = getRecord(selectedCanvas)!;
    const disabled = vi.fn();
    const unsubscribe = subscribeToSelectedCommands(
      selectedRecord,
      () => { throw new Error('detail listener failed'); },
      () => {},
      disabled,
    );
    try {
      expect(selectedContext.fillRect(1, 2, 3, 4)).toBe(fillRectResult);
      expect(disabled).toHaveBeenCalledOnce();
      expect(isKilled()).toBe(false);
    } finally {
      unsubscribe();
    }
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
