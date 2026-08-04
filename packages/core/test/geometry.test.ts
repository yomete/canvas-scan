import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectCanvasGeometry } from '../src/geometry';

const canvas = (overrides: Record<string, unknown> = {}) => ({ isConnected: true, width: 480, height: 240, getBoundingClientRect: () => ({ width: 240, height: 120 }), ...overrides });

afterEach(() => { vi.unstubAllGlobals(); });

describe('collectCanvasGeometry', () => {
  it('collects plain DPR-adjusted geometry', () => {
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' }));
    vi.stubGlobal('devicePixelRatio', 2);
    const result = collectCanvasGeometry(canvas());
    expect(result).toEqual({ backingWidth: 480, backingHeight: 240, cssWidth: 240, cssHeight: 120, devicePixelRatio: 2, expectedBackingWidth: 480, expectedBackingHeight: 240, expectedPixelArea: 115200, actualToExpectedAreaRatio: 1, unavailableReason: null });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('uses the inclusive ratio and avoids layout reads when disconnected', () => {
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' })); vi.stubGlobal('devicePixelRatio', 2);
    expect(collectCanvasGeometry(canvas({ width: 960, height: 240 })).actualToExpectedAreaRatio).toBe(2);
    const rect = vi.fn();
    expect(collectCanvasGeometry(canvas({ isConnected: false, getBoundingClientRect: rect })).unavailableReason).toBe('disconnected');
    expect(rect).not.toHaveBeenCalled();
  });

  it('reports hidden, zero-size, and unavailable geometry', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    vi.stubGlobal('getComputedStyle', () => ({ display: 'none', visibility: 'visible' }));
    expect(collectCanvasGeometry(canvas()).unavailableReason).toBe('hidden');
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' }));
    expect(collectCanvasGeometry(canvas({ getBoundingClientRect: () => ({ width: 0, height: 10 }) })).unavailableReason).toBe('zero-size');
    expect(collectCanvasGeometry({}).unavailableReason).toBe('unavailable');
  });

  it('keeps public values finite when geometry math cannot produce evidence', () => {
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' }));
    vi.stubGlobal('devicePixelRatio', Number.MAX_VALUE);
    const result = collectCanvasGeometry(canvas());
    expect(result.unavailableReason).toBe('unavailable');
    expect(Object.values(result).every(value => value === null || typeof value === 'string' || Number.isFinite(value))).toBe(true);
  });

  it('keeps a zero backing store as available geometry', () => {
    vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible' }));
    vi.stubGlobal('devicePixelRatio', 2);
    expect(collectCanvasGeometry(canvas({ width: 0, height: 0 }))).toMatchObject({
      backingWidth: 0, backingHeight: 0, expectedPixelArea: 115200,
      actualToExpectedAreaRatio: 0, unavailableReason: null,
    });
  });
});
