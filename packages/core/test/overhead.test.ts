import { describe, expect, it } from 'vitest';
import { installCanvasPatch } from '../src/wrap-context';

class RawContext {
  n = 0;

  fillRect() {
    this.n = (this.n + 1) | 0;
  }
}

class WrappedContext {
  n = 0;
  canvas: FakeCanvas;

  constructor(canvas: FakeCanvas) {
    this.canvas = canvas;
  }

  fillRect() {
    this.n = (this.n + 1) | 0;
  }
}

class FakeCanvas {
  private context: WrappedContext | null = null;

  get width() {
    return 300;
  }

  get height() {
    return 150;
  }

  getAttribute() {
    return null;
  }

  getContext(type: string) {
    if (type !== '2d') return null;
    this.context ??= new WrappedContext(this);
    return this.context;
  }
}

installCanvasPatch({
  canvasProto: FakeCanvas.prototype,
  contextProto: WrappedContext.prototype,
});

function run(context: { fillRect(): void }, opCount: number) {
  for (let i = 0; i < opCount; i++) context.fillRect();
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function p95(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

describe('wrapper overhead', () => {
  it('stays below the sanity ceiling', () => {
    const results = [100, 1_000, 10_000].map((opCount) => {
      const raw = new RawContext();
      const canvas = new FakeCanvas();
      const wrapped = canvas.getContext('2d')!;

      for (let i = 0; i < 5; i++) {
        run(raw, opCount);
        run(wrapped, opCount);
      }

      const addedMs: number[] = [];
      const ratios: number[] = [];

      for (let trial = 0; trial < 30; trial++) {
        const rawStart = performance.now();
        run(raw, opCount);
        const rawMs = performance.now() - rawStart;

        const wrappedStart = performance.now();
        run(wrapped, opCount);
        const wrappedMs = performance.now() - wrappedStart;

        addedMs.push(wrappedMs - rawMs);
        ratios.push(wrappedMs / rawMs);
      }

      return {
        ops: opCount,
        medianAddedMs: median(addedMs),
        p95AddedMs: p95(addedMs),
        ratio: median(ratios),
      };
    });

    console.info(
      [
        'ops    median added ms    p95 added ms    ratio',
        ...results.map(
          ({ ops, medianAddedMs, p95AddedMs, ratio }) =>
            `${String(ops).padEnd(7)}${medianAddedMs.toFixed(3).padEnd(19)}${p95AddedMs.toFixed(3).padEnd(16)}${ratio.toFixed(2)}`,
        ),
      ].join('\n'),
    );
    // The ratio against a ~1ns no-op fake is meaningless (any wrapper with two
    // performance.now() calls dwarfs it); gate on absolute added time per op.
    // This is the CATASTROPHE TRIPWIRE only — the binding budgets live in the
    // Chrome release command (bench-chrome.mjs). A 2µs ceiling flaked at
    // 2.02µs on a shared CI runner after the 3R/4R always-on trackers; 5µs
    // never flakes yet still catches order-of-magnitude regressions.
    for (const result of results) {
      expect(result.medianAddedMs / result.ops).toBeLessThan(0.005);
    }
  });
});
