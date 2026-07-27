// @vitest-environment jsdom

import { expect, it } from 'vitest';

it('uses global options when auto-starting', async () => {
  (globalThis as any).__CANVAS_SCAN_OPTS = { overlay: false };
  (globalThis as any).CanvasRenderingContext2D = class {};

  await import('../src/auto');

  expect(document.querySelector('[data-canvas-scan]')).toBeNull();
  expect((window as any).__CANVAS_SCAN__).toBeDefined();
});
