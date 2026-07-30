import { beforeEach, describe, expect, it } from 'vitest';

import { trackBuild } from '../src/build-registry';
import { processRecord } from '../src/frame-loop';
import { newWindowSignature } from '../src/signature';
import {
  getRecord,
  installCanvasPatch,
  setWindowCaptured,
} from '../src/wrap-context';
import type { CanvasRecord } from '../src/wrap-context';

class CanvasGradient {
  addColorStop(..._args: unknown[]) {}
}

class Path2D {}

class FakeContext {
  throwOnFillRect: Error | null = null;
  private fillStyleValue: unknown = '#000000';
  private lineDash: unknown[] = [];
  private stateStack: Array<{
    fillStyle: unknown;
    lineDash: unknown[];
  }> = [];

  get fillStyle() {
    return this.fillStyleValue;
  }

  set fillStyle(value: unknown) {
    this.fillStyleValue = value;
  }

  clearRect(..._args: unknown[]) {}
  fillRect(..._args: unknown[]) {
    if (this.throwOnFillRect) {
      const error = this.throwOnFillRect;
      this.throwOnFillRect = null;
      throw error;
    }
  }
  drawImage(..._args: unknown[]) {}
  roundRect(..._args: unknown[]) {}
  translate(..._args: unknown[]) {}
  setTransform(..._args: unknown[]) {}
  resetTransform() {}
  beginPath() {}
  closePath() {}
  moveTo(..._args: unknown[]) {}
  lineTo(..._args: unknown[]) {}
  rect(..._args: unknown[]) {}
  fill(..._args: unknown[]) {}
  stroke(..._args: unknown[]) {}
  clip(..._args: unknown[]) {}

  setLineDash(value: unknown[]) {
    this.lineDash = [...value];
  }

  getLineDash() {
    return [...this.lineDash];
  }

  save() {
    this.stateStack.push({
      fillStyle: this.fillStyleValue,
      lineDash: [...this.lineDash],
    });
  }

  restore() {
    const state = this.stateStack.pop();
    if (!state) return;
    this.fillStyleValue = state.fillStyle;
    this.lineDash = state.lineDash;
  }

  reset() {
    this.fillStyleValue = '#000000';
    this.lineDash = [];
    this.stateStack = [];
  }

  createLinearGradient(..._args: unknown[]) {
    return new CanvasGradient();
  }
}

class HTMLCanvasElement {
  private context: FakeContext | null = null;

  constructor(readonly id = '') {}

  get width() {
    return 300;
  }

  get height() {
    return 150;
  }

  getAttribute(name: string) {
    return name === 'id' ? this.id || null : null;
  }

  getContext(type: string) {
    if (type !== '2d') return null;
    this.context ??= new FakeContext();
    return this.context;
  }
}

installCanvasPatch({
  canvasProto: HTMLCanvasElement.prototype,
  contextProto: FakeContext.prototype,
  attributeObserver: { observe() {}, takeRecords: () => [] },
});

function makeCanvas(id = '') {
  const canvas = new HTMLCanvasElement(id);
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

describe('classifier-trust remediation', () => {
  describe('1. same-frame composite staleness', () => {
    it('changes a consumer before source finalization, then recovers after the moved version', () => {
      const source = makeCanvas();
      const consumer = makeCanvas();

      source.context.fillRect(0, 0, 10, 10);
      finish(source.record, 1);
      consumer.context.drawImage(source.canvas, 0, 0);
      finish(consumer.record, 1);

      source.context.fillRect(0, 0, 20, 20);
      consumer.context.drawImage(source.canvas, 0, 0);
      expect(finish(consumer.record, 2)?.signatureStatus).toBe('changed');
      expect(finish(source.record, 2)?.signatureStatus).toBe('changed');

      consumer.context.drawImage(source.canvas, 0, 0);
      expect(finish(consumer.record, 3)?.signatureStatus).toBe('changed');
      consumer.context.drawImage(source.canvas, 0, 0);
      expect(finish(consumer.record, 4)?.signatureStatus).toBe('same');
    });

    it('uses a dirty token for an identical redraw, then returns to the clean token', () => {
      const source = makeCanvas();
      const consumer = makeCanvas();

      source.context.fillRect(0, 0, 10, 10);
      finish(source.record, 1);
      consumer.context.drawImage(source.canvas, 0, 0);
      finish(consumer.record, 1);

      source.context.fillRect(0, 0, 10, 10);
      consumer.context.drawImage(source.canvas, 0, 0);
      expect(finish(consumer.record, 2)?.signatureStatus).toBe('changed');
      expect(finish(source.record, 2)?.signatureStatus).toBe('same');

      consumer.context.drawImage(source.canvas, 0, 0);
      expect(finish(consumer.record, 3)?.signatureStatus).toBe('changed');
      consumer.context.drawImage(source.canvas, 0, 0);
      expect(finish(consumer.record, 4)?.signatureStatus).toBe('same');
    });
  });

  describe('2. path framing collisions', () => {
    it('distinguishes numeric boundaries in carried paths and remains stable', () => {
      const first = makeCanvas();
      const second = makeCanvas();

      first.context.rect(1, 23, 4, 5);
      second.context.rect(12, 3, 4, 5);
      finish(first.record, 1);
      finish(second.record, 1);

      first.context.fill();
      second.context.fill();
      expect(first.record.sig.hash).not.toBe(second.record.sig.hash);
      finish(first.record, 2);
      finish(second.record, 2);

      first.context.fill();
      second.context.fill();
      expect(finish(first.record, 3)?.signatureStatus).toBe('same');
      expect(finish(second.record, 3)?.signatureStatus).toBe('same');
    });

    it('distinguishes numeric and string path arguments and remains stable', () => {
      const numeric = makeCanvas();
      const string = makeCanvas();

      numeric.context.rect(1, 2, 3, 5);
      string.context.rect(1, 2, 3, '5');
      finish(numeric.record, 1);
      finish(string.record, 1);

      numeric.context.fill();
      string.context.fill();
      expect(numeric.record.sig.hash).not.toBe(string.record.sig.hash);
      finish(numeric.record, 2);
      finish(string.record, 2);

      numeric.context.fill();
      string.context.fill();
      expect(finish(numeric.record, 3)?.signatureStatus).toBe('same');
      expect(finish(string.record, 3)?.signatureStatus).toBe('same');
    });

    it('distinguishes a closed carried path from an open one and remains stable', () => {
      const closed = makeCanvas();
      const open = makeCanvas();

      closed.context.rect(0, 0, 10, 10);
      closed.context.closePath();
      open.context.rect(0, 0, 10, 10);
      finish(closed.record, 1);
      finish(open.record, 1);

      closed.context.fill();
      open.context.fill();
      expect(closed.record.sig.hash).not.toBe(open.record.sig.hash);
      finish(closed.record, 2);
      finish(open.record, 2);

      closed.context.fill();
      open.context.fill();
      expect(finish(closed.record, 3)?.signatureStatus).toBe('same');
      expect(finish(open.record, 3)?.signatureStatus).toBe('same');
    });
  });

  describe('3. skipped line-dash and close-path changes', () => {
    it('sees a skipped line-dash change and reaches same again', () => {
      const { context, record } = makeCanvas();

      context.stroke();
      finish(record, 2, 2);
      setWindowCaptured(false);
      context.setLineDash([5, 5]);
      expect(finish(record, 3, 2)).toBeUndefined();
      setWindowCaptured(true);
      context.stroke();
      expect(finish(record, 4, 2)?.signatureStatus).toBe('changed');

      setWindowCaptured(false);
      expect(finish(record, 5, 2)).toBeUndefined();
      setWindowCaptured(true);
      context.stroke();
      expect(finish(record, 6, 2)?.signatureStatus).toBe('same');
    });

    it('sees a skipped closePath change and reaches same again', () => {
      const { context, record } = makeCanvas();

      context.moveTo(0, 0);
      context.stroke();
      finish(record, 2, 2);
      setWindowCaptured(false);
      context.closePath();
      expect(finish(record, 3, 2)).toBeUndefined();
      setWindowCaptured(true);
      context.stroke();
      expect(finish(record, 4, 2)?.signatureStatus).toBe('changed');

      setWindowCaptured(false);
      expect(finish(record, 5, 2)).toBeUndefined();
      setWindowCaptured(true);
      context.stroke();
      expect(finish(record, 6, 2)?.signatureStatus).toBe('same');
    });
  });

  describe('4. save and restore model fidelity', () => {
    it('restores skipped property changes in both the native fake and model', () => {
      const { context, record } = makeCanvas();

      setWindowCaptured(false);
      context.fillStyle = 'blue';
      expect(finish(record, 1, 2)).toBeUndefined();
      setWindowCaptured(true);
      context.fillRect(0, 0, 10, 10);
      finish(record, 2, 2);

      setWindowCaptured(false);
      context.save();
      context.fillStyle = 'red';
      context.restore();
      expect(finish(record, 3, 2)).toBeUndefined();
      expect(context.fillStyle).toBe('blue');
      expect(record.props.get('fillStyle')).toBe(context.fillStyle);

      setWindowCaptured(true);
      context.fillRect(0, 0, 10, 10);
      expect(finish(record, 4, 2)?.signatureStatus).toBe('same');
    });

    it('does not hash equal when native state diverges after a restored assignment', () => {
      const { context, record } = makeCanvas();

      setWindowCaptured(false);
      context.save();
      context.fillStyle = 'red';
      context.restore();
      expect(finish(record, 1, 2)).toBeUndefined();
      expect(context.fillStyle).toBe('#000000');
      setWindowCaptured(true);
      context.fillRect(0, 0, 10, 10);
      finish(record, 2, 2);

      setWindowCaptured(false);
      context.fillStyle = 'red';
      expect(finish(record, 3, 2)).toBeUndefined();
      expect(context.fillStyle).toBe('red');
      setWindowCaptured(true);
      context.fillRect(0, 0, 10, 10);
      expect(finish(record, 4, 2)?.signatureStatus).toBe('changed');

      setWindowCaptured(false);
      expect(finish(record, 5, 2)).toBeUndefined();
      setWindowCaptured(true);
      context.fillRect(0, 0, 10, 10);
      expect(finish(record, 6, 2)?.signatureStatus).toBe('same');
    });
  });

  describe('5. mid-window gradient mutation', () => {
    it('marks active dependents unknown, then recovers through previous-window', () => {
      const { context, record } = makeCanvas();
      const gradient = context.createLinearGradient(0, 0, 10, 0);

      context.fillStyle = gradient;
      context.clearRect(0, 0, 10, 10);
      context.fillRect(0, 0, 10, 10);
      finish(record, 1);

      context.clearRect(0, 0, 10, 10);
      gradient.addColorStop(0.5, 'red');
      context.fillRect(0, 0, 10, 10);
      expect(finish(record, 2)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'gradient-mutated',
      });

      context.clearRect(0, 0, 10, 10);
      context.fillRect(0, 0, 10, 10);
      expect(finish(record, 3)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'previous-window',
      });

      context.clearRect(0, 0, 10, 10);
      context.fillRect(0, 0, 10, 10);
      expect(finish(record, 4)).toMatchObject({
        signatureStatus: 'same',
        unknownReason: null,
      });
    });
  });

  describe('6. identity, reset, and clip uncertainty', () => {
    it('reports every reset-and-draw window as a reset barrier', () => {
      const { context, record } = makeCanvas();

      for (let index = 1; index <= 3; index++) {
        context.reset();
        context.fillRect(0, 0, 10, 10);
        expect(finish(record, index)).toMatchObject({
          signatureStatus: 'unknown',
          unknownReason: 'canvas-reset',
        });
      }
    });

    it('uses internal identity for duplicate DOM ids and remains stable', () => {
      const firstSource = makeCanvas('duplicate');
      const secondSource = makeCanvas('duplicate');
      const firstConsumer = makeCanvas();
      const secondConsumer = makeCanvas();

      firstSource.context.fillRect(0, 0, 10, 10);
      secondSource.context.fillRect(0, 0, 20, 20);
      finish(firstSource.record, 1);
      finish(secondSource.record, 1);

      firstConsumer.context.drawImage(firstSource.canvas, 0, 0);
      secondConsumer.context.drawImage(secondSource.canvas, 0, 0);
      expect(firstConsumer.record.sig.hash).not.toBe(
        secondConsumer.record.sig.hash,
      );
      finish(firstConsumer.record, 1);
      finish(secondConsumer.record, 1);

      firstConsumer.context.drawImage(firstSource.canvas, 0, 0);
      secondConsumer.context.drawImage(secondSource.canvas, 0, 0);
      expect(finish(firstConsumer.record, 2)?.signatureStatus).toBe('same');
      expect(finish(secondConsumer.record, 2)?.signatureStatus).toBe('same');
    });

    it('refuses a reset source token and then reaches same again', () => {
      const source = makeCanvas();
      const consumer = makeCanvas();

      source.context.fillRect(0, 0, 10, 10);
      finish(source.record, 1);
      consumer.context.drawImage(source.canvas, 0, 0);
      finish(consumer.record, 1);

      source.context.reset();
      consumer.context.drawImage(source.canvas, 0, 0);
      expect(finish(consumer.record, 2)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'canvas-source-reset',
      });
      expect(finish(source.record, 2)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'canvas-reset',
      });

      consumer.context.drawImage(source.canvas, 0, 0);
      expect(finish(consumer.record, 3)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'first-window',
      });
      consumer.context.drawImage(source.canvas, 0, 0);
      expect(finish(consumer.record, 4)).toMatchObject({
        signatureStatus: 'same',
        unknownReason: null,
      });
    });

    it('keeps an untracked clip unknown across a skipped window until reset', () => {
      const { context, record } = makeCanvas();

      context.clip(new Path2D());
      context.fillRect(0, 0, 10, 10);
      expect(finish(record, 2, 2)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'clip-unmodeled',
      });

      setWindowCaptured(false);
      context.fillRect(0, 0, 10, 10);
      expect(finish(record, 3, 2)).toBeUndefined();
      setWindowCaptured(true);
      context.fillRect(0, 0, 10, 10);
      expect(finish(record, 4, 2)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'clip-unmodeled',
      });

      setWindowCaptured(false);
      context.reset();
      expect(finish(record, 5, 2)).toBeUndefined();
      setWindowCaptured(true);
      context.fillRect(0, 0, 10, 10);
      expect(finish(record, 6, 2)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'canvas-reset',
      });

      setWindowCaptured(false);
      expect(finish(record, 7, 2)).toBeUndefined();
      setWindowCaptured(true);
      context.fillRect(0, 0, 10, 10);
      expect(finish(record, 8, 2)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'first-window',
      });

      setWindowCaptured(false);
      expect(finish(record, 9, 2)).toBeUndefined();
      setWindowCaptured(true);
      context.fillRect(0, 0, 10, 10);
      expect(finish(record, 10, 2)).toMatchObject({
        signatureStatus: 'same',
        unknownReason: null,
      });
    });

    it('restores past a bracketed untracked clip and recovers', () => {
      const { context, record } = makeCanvas();

      context.save();
      context.clip(new Path2D());
      context.fillRect(0, 0, 10, 10);
      context.restore();
      expect(finish(record, 1)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'clip-unmodeled',
      });

      context.fillRect(0, 0, 10, 10);
      expect(finish(record, 2)).toMatchObject({
        signatureStatus: 'unknown',
        unknownReason: 'previous-window',
      });
      context.fillRect(0, 0, 10, 10);
      expect(finish(record, 3)).toMatchObject({
        signatureStatus: 'same',
        unknownReason: null,
      });
    });
  });
});

describe('post-review patch: array radii, clip-time CTM, failed natives', () => {
  function carriedRoundRectFill(firstRadii: number[], secondRadii: number[]) {
    const { context, record } = makeCanvas();
    setWindowCaptured(false);
    context.beginPath();
    context.roundRect(0, 0, 100, 100, firstRadii);
    finish(record, 1, 2);
    setWindowCaptured(true);
    context.fill();
    finish(record, 2, 2);
    setWindowCaptured(false);
    context.beginPath();
    context.roundRect(0, 0, 100, 100, secondRadii);
    finish(record, 3, 2);
    setWindowCaptured(true);
    context.fill();
    return finish(record, 4, 2)?.signatureStatus;
  }

  it('distinguishes carried paths rebuilt with different array radii in a skipped window', () => {
    expect(carriedRoundRectFill([1, 23], [1, 23])).toBe('same');
    expect(carriedRoundRectFill([1, 23], [12, 3])).toBe('changed');
  });

  function clippedUnderTranslate(first: number, second: number) {
    const path = new Path2D();
    trackBuild(path, newWindowSignature());
    const { context, record } = makeCanvas();
    setWindowCaptured(false);
    context.save();
    context.translate(first, 0);
    context.clip(path);
    context.resetTransform();
    finish(record, 1, 2);
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    finish(record, 2, 2);
    setWindowCaptured(false);
    context.restore();
    context.save();
    context.translate(second, 0);
    context.clip(path);
    context.resetTransform();
    finish(record, 3, 2);
    setWindowCaptured(true);
    context.fillRect(0, 0, 10, 10);
    return finish(record, 4, 2)?.signatureStatus;
  }

  it('mixes the clip-time CTM into tracked Path2D clips', () => {
    expect(clippedUnderTranslate(10, 10)).toBe('same');
    expect(clippedUnderTranslate(10, 20)).toBe('changed');
  });

  it('promotes an unknown tracked build to persistent clip uncertainty', () => {
    const path = new Path2D();
    const dirty = newWindowSignature();
    dirty.unknown = true;
    trackBuild(path, dirty);
    const { context, record } = makeCanvas();
    context.clip(path);
    context.fillRect(0, 0, 10, 10);
    const report = finish(record, 1);
    expect(report?.signatureStatus).toBe('unknown');
    context.fillRect(0, 0, 10, 10);
    expect(finish(record, 2)?.unknownReason).toBe('clip-unmodeled');
  });

  it('preserves the native error and leaves the model untouched when a raster call throws', () => {
    const { context, record } = makeCanvas();
    context.fillRect(0, 0, 1, 1);
    finish(record, 1);
    const before = {
      dirty: record.contentDirty,
      token: record.contentSig.hash,
      rasterOps: record.rasterOps,
      hash: record.sig.hash,
      pathHash: record.pathHash,
    };
    const nativeError = new Error('native failure');
    (<any>context).throwOnFillRect = nativeError;
    let thrown: unknown;
    try {
      context.fillRect(1, 1, 1, 1);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(nativeError);
    expect(record.contentDirty).toBe(before.dirty);
    expect(record.contentSig.hash).toBe(before.token);
    expect(record.rasterOps).toBe(before.rasterOps);
    expect(record.sig.hash).toBe(before.hash);
    expect(record.pathHash).toBe(before.pathHash);
    expect(record.activeInWindow).toBe(false);
  });

  it('does not mask a native setLineDash error and stores no dash state', () => {
    const { context, record } = makeCanvas();
    let thrown: unknown;
    try {
      (<any>context).setLineDash(42);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(record.props.has('__lineDash')).toBe(false);
    expect(record.activeInWindow).toBe(false);
  });
});

describe('post-review patch 2: one-shot iterables, accessor-backed inputs', () => {
  it('snapshots line dash from native state, so distinct generator dashes never collide', () => {
    function* dashOf(...values: number[]) {
      yield* values;
    }
    const { context, record } = makeCanvas();
    context.stroke();
    finish(record, 2, 2);

    setWindowCaptured(false);
    context.setLineDash(<never>dashOf(5, 5));
    finish(record, 3, 2);
    setWindowCaptured(true);
    context.stroke();
    expect(finish(record, 4, 2)?.signatureStatus).toBe('changed');

    setWindowCaptured(false);
    context.setLineDash(<never>dashOf(2, 8));
    finish(record, 5, 2);
    setWindowCaptured(true);
    context.stroke();
    expect(finish(record, 6, 2)?.signatureStatus).toBe('changed');

    setWindowCaptured(false);
    context.setLineDash(<never>dashOf(2, 8));
    finish(record, 7, 2);
    setWindowCaptured(true);
    context.stroke();
    expect(finish(record, 8, 2)?.signatureStatus).toBe('same');
  });

  it('treats accessor-backed radii as persistently unmodeled, never colliding with data radii', () => {
    const stable = makeCanvas();
    setWindowCaptured(false);
    stable.context.beginPath();
    stable.context.roundRect(0, 0, 100, 100, [2]);
    finish(stable.record, 1, 2);
    setWindowCaptured(true);
    stable.context.fill();
    finish(stable.record, 2, 2);
    setWindowCaptured(false);
    stable.context.beginPath();
    stable.context.roundRect(0, 0, 100, 100, [2]);
    finish(stable.record, 3, 2);
    setWindowCaptured(true);
    stable.context.fill();
    expect(finish(stable.record, 4, 2)?.signatureStatus).toBe('same');

    const tricky = makeCanvas();
    const radii = [2];
    Object.defineProperty(radii, 0, { get: () => 2, configurable: true });
    tricky.context.beginPath();
    tricky.context.roundRect(0, 0, 100, 100, radii);
    tricky.context.fill();
    expect(finish(tricky.record, 1)?.unknownReason).toBe('array-accessor');
    tricky.context.fill();
    expect(finish(tricky.record, 2)?.unknownReason).toBe('path-unmodeled');

    tricky.context.beginPath();
    tricky.context.rect(0, 0, 10, 10);
    tricky.context.fill();
    finish(tricky.record, 3);
    tricky.context.fill();
    expect(finish(tricky.record, 4)?.unknownReason).toBe('previous-window');
    tricky.context.fill();
    expect(finish(tricky.record, 5)?.signatureStatus).toBe('same');
  });

  it('treats accessor-backed point dictionaries as unmodeled', () => {
    const { context, record } = makeCanvas();
    const dict = Object.defineProperty({ y: 1 }, 'x', {
      get: () => 1,
      configurable: true,
    });
    context.beginPath();
    context.roundRect(0, 0, 100, 100, [dict]);
    context.fill();
    finish(record, 1);
    context.fill();
    expect(finish(record, 2)?.unknownReason).toBe('path-unmodeled');
  });
});

describe('post-review patch 3: shadowed getters, inherited indices, safe traversal', () => {
  it('snapshots line dash via the original prototype method, never a shadowed instance method', () => {
    const { context, record } = makeCanvas();
    let shadowCalls = 0;
    (<any>context).getLineDash = () => {
      shadowCalls++;
      return [];
    };

    context.setLineDash([5, 5]);

    expect(shadowCalls).toBe(0);
    expect(record.props.get('__lineDash')).toEqual([5, 5]);
  });

  it('never invokes inherited index getters and keeps the carried path unknown', () => {
    let inheritedReads = 0;
    const radii = new Array(1);
    Object.setPrototypeOf(radii, {
      get 0() {
        inheritedReads++;
        return 40;
      },
    });

    const { context, record } = makeCanvas();
    context.beginPath();
    context.roundRect(0, 0, 100, 100, radii);
    const readsAfterNative = inheritedReads;
    context.fill();
    finish(record, 1);

    // The fake performs no conversion reads; the tracer must add ZERO.
    expect(inheritedReads).toBe(readsAfterNative);
    expect(record.pathUnknown).toBe(true);

    context.fill();
    expect(finish(record, 2)?.unknownReason).toBe('path-unmodeled');
  });

  it('never iterates app arrays in the captured stream (custom Symbol.iterator untouched)', () => {
    let iterations = 0;
    const dash = [4, 2];
    (<any>dash)[Symbol.iterator] = function* () {
      iterations++;
      yield* [4, 2];
    };

    const { context, record } = makeCanvas();
    context.setLineDash(dash);
    context.stroke();
    const report = finish(record, 1);

    // The fake's setLineDash spreads (1 iteration = native conversion);
    // tracer hashing and the getLineDash snapshot must add none.
    expect(iterations).toBe(1);
    expect(report).toBeDefined();
    expect(record.props.get('__lineDash')).toEqual([4, 2]);
  });

  it('marks stream arrays with accessor elements unknown without reading them', () => {
    let reads = 0;
    const arr = [7];
    Object.defineProperty(arr, 0, {
      get() {
        reads++;
        return 7;
      },
      configurable: true,
    });

    const { context, record } = makeCanvas();
    context.beginPath();
    context.roundRect(0, 0, 10, 10, arr);
    context.fill();
    const readsBeforeFinish = reads;
    const report = finish(record, 1);

    expect(reads).toBe(readsBeforeFinish);
    expect(report?.signatureStatus).toBe('unknown');
    expect(record.pathUnknown).toBe(true);
  });
});

describe('post-review patch 4: integer aliasing, unmodeled-transform geometry', () => {
  function carriedRectFill(x: number) {
    const { context, record } = makeCanvas();
    setWindowCaptured(false);
    context.beginPath();
    context.rect(x, 0, 10, 10);
    finish(record, 1, 2);
    setWindowCaptured(true);
    context.fill();
    finish(record, 2, 2);
    return record;
  }

  it('does not alias path coordinates 2^32 cents apart', () => {
    const zero = carriedRectFill(0);
    const aliased = carriedRectFill(42949672.96);
    expect(zero.pathUnknown).toBe(false);
    expect(aliased.pathUnknown).toBe(false);
    expect(zero.prev?.hash).not.toBe(aliased.prev?.hash);
  });

  it('keeps in-range integer folding stable across identical rebuilds', () => {
    const first = carriedRectFill(12345.67);
    const second = carriedRectFill(12345.67);
    expect(first.prev?.hash).toBe(second.prev?.hash);
  });

  it('marks geometry built under an unmodeled transform as path-unmodeled', () => {
    const { context, record } = makeCanvas();
    (<any>context).setTransform({});
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(10, 10);
    (<any>context).setTransform(1, 0, 0, 1, 0, 0);
    context.fill();
    finish(record, 1);
    context.fill();
    expect(finish(record, 2)?.unknownReason).toBe('path-unmodeled');

    context.beginPath();
    context.rect(0, 0, 5, 5);
    context.fill();
    finish(record, 3);
    context.fill();
    finish(record, 4);
    context.fill();
    expect(finish(record, 5)?.signatureStatus).toBe('same');
  });
});
