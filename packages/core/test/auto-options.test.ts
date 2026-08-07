// @vitest-environment jsdom

import { expect, it } from 'vitest';

import { getLastExplanation, getLastSession, mark, startExplanation, startRecording, stopExplanation, stopRecording } from '../src/index';

it('uses global options when auto-starting', async () => {
  (globalThis as any).__CANVAS_SCAN_OPTS = { overlay: false };
  (globalThis as any).CanvasRenderingContext2D = class {};

  await import('../src/auto');

  expect(document.querySelector('[data-canvas-scan]')).toBeNull();
  expect((window as any).__CANVAS_SCAN__).toBeDefined();
  expect((window as any).__CANVAS_SCAN__.startRecording).toBe(startRecording);
  expect((window as any).__CANVAS_SCAN__.stopRecording).toBe(stopRecording);
  expect((window as any).__CANVAS_SCAN__.mark).toBe(mark);
  expect((window as any).__CANVAS_SCAN__.getLastSession).toBe(getLastSession);
  expect((window as any).__CANVAS_SCAN__.startExplanation).toBe(startExplanation);
  expect((window as any).__CANVAS_SCAN__.stopExplanation).toBe(stopExplanation);
  expect((window as any).__CANVAS_SCAN__.getLastExplanation).toBe(getLastExplanation);
});
