import type { CanvasGeometryUnavailableReason, RecordedCanvasGeometry } from './types.js';

const unavailable = (reason: CanvasGeometryUnavailableReason): RecordedCanvasGeometry => ({
  backingWidth: null, backingHeight: null, cssWidth: null, cssHeight: null,
  devicePixelRatio: null, expectedBackingWidth: null, expectedBackingHeight: null,
  expectedPixelArea: null, actualToExpectedAreaRatio: null, unavailableReason: reason,
});

const rounded = (value: number): number => Number(value.toFixed(3));

export function collectCanvasGeometry(canvas: unknown): RecordedCanvasGeometry {
  if (!canvas || typeof canvas !== 'object') return unavailable('unavailable');
  const element = canvas as { isConnected?: boolean; width?: unknown; height?: unknown; getBoundingClientRect?: () => { width: unknown; height: unknown } };
  if (element.isConnected === false) return unavailable('disconnected');
  if (typeof element.getBoundingClientRect !== 'function' || typeof getComputedStyle !== 'function') return unavailable('unavailable');
  try {
    const style = getComputedStyle(canvas as Element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return unavailable('hidden');
    const rect = element.getBoundingClientRect();
    const cssWidth = Number(rect.width); const cssHeight = Number(rect.height);
    if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight) || cssWidth <= 0 || cssHeight <= 0) return unavailable('zero-size');
    const devicePixelRatio = Number(globalThis.devicePixelRatio);
    const backingWidth = Number(element.width); const backingHeight = Number(element.height);
    if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0 || !Number.isFinite(backingWidth) || !Number.isFinite(backingHeight) || backingWidth < 0 || backingHeight < 0) return unavailable('unavailable');
    const expectedBackingWidth = cssWidth * devicePixelRatio;
    const expectedBackingHeight = cssHeight * devicePixelRatio;
    const expectedPixelArea = expectedBackingWidth * expectedBackingHeight;
    const actualPixelArea = backingWidth * backingHeight;
    const actualToExpectedAreaRatio = actualPixelArea / expectedPixelArea;
    if (![expectedBackingWidth, expectedBackingHeight, expectedPixelArea, actualPixelArea, actualToExpectedAreaRatio].every(Number.isFinite) || expectedPixelArea <= 0) return unavailable('unavailable');
    return {
      backingWidth, backingHeight, cssWidth, cssHeight, devicePixelRatio,
      expectedBackingWidth: rounded(expectedBackingWidth),
      expectedBackingHeight: rounded(expectedBackingHeight),
      expectedPixelArea: rounded(expectedPixelArea),
      actualToExpectedAreaRatio: rounded(actualToExpectedAreaRatio),
      unavailableReason: null,
    };
  } catch { return unavailable('unavailable'); }
}
