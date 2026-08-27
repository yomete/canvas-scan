// The six benchmark fixtures, driven in real Chrome.
//
// The scorer test proves the protocol is sound. This one proves the fixtures
// are. A seeded defect that does not actually happen would waste six people's
// afternoon and produce a result about nothing.
//
// The instrumentation here counts Canvas2D calls per canvas. It is deliberately
// not canvas-scan: a fixture check that used canvas-scan would only ever accept
// defects canvas-scan can already see, which is the one bias this benchmark
// cannot afford. Counting calls is arm-neutral and says the same thing to a
// DevTools user and a canvas-scan user.
//
// Call counts, not milliseconds. A headless machine's timings wander; the
// number of times a page painted the same thing does not.
//
// Run: node --test benchmark-fixtures.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../scripts/browser-driver.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const benchmark = path.join(here, 'benchmark');
const manifest = JSON.parse(readFileSync(path.join(benchmark, 'manifest.json'), 'utf8'));
const answers = JSON.parse(readFileSync(path.join(benchmark, 'answers.json'), 'utf8'));

// Installed before the fixture's own script runs, so no draw is missed.
const COUNTER = `
  (() => {
    const proto = CanvasRenderingContext2D.prototype;
    const methods = ['fillRect', 'strokeRect', 'clearRect', 'fill', 'stroke', 'drawImage', 'getImageData', 'createLinearGradient', 'arc'];
    const records = new Map();
    let detachedIndex = 0;
    const labelFor = canvas => {
      if (canvas.id) return canvas.id;
      if (!canvas.__benchLabel) canvas.__benchLabel = 'detached-' + (detachedIndex++);
      return canvas.__benchLabel;
    };
    for (const name of methods) {
      const original = proto[name];
      proto[name] = function (...args) {
        const label = labelFor(this.canvas);
        const record = records.get(label) ?? { label, calls: 0, inDocument: false, methods: {} };
        record.calls++;
        record.methods[name] = (record.methods[name] ?? 0) + 1;
        record.inDocument = document.contains(this.canvas);
        records.set(label, record);
        return original.apply(this, args);
      };
    }
    window.__BENCH__ = {
      reset: () => records.clear(),
      read: () => [...records.values()].sort((left, right) => right.calls - left.calls),
    };
  })();
`;

// Each fixture is driven the way the protocol tells a participant to drive it.
const INTERACTIONS = {
  'scene-overdraw': `
    const canvas = document.getElementById('scene');
    for (let step = 0; step < 60; step++) {
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 100 + step * 8, clientY: 200, bubbles: true }));
    }
  `,
  'resize-churn': `await new Promise(done => setTimeout(done, 1500));`,
  'oversized-backing-store': `
    for (let press = 0; press < 10; press++) document.getElementById('redraw').click();
  `,
  'gradient-per-shape': `
    document.getElementById('animate').click();
    await new Promise(done => setTimeout(done, 1500));
  `,
  'pixel-readback': `
    const canvas = document.getElementById('picker');
    for (let step = 0; step < 40; step++) {
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 100 + step * 8, clientY: 100, bubbles: true }));
    }
  `,
  'hidden-cache-canvas': `
    const canvas = document.getElementById('visible');
    for (let step = 0; step < 40; step++) {
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 100 + step * 8, clientY: 200, bubbles: true }));
    }
  `,
};

async function drive(task, port) {
  const page = await launch(`http://127.0.0.1:${port}/${task.page}`, { initScript: COUNTER });
  try {
    await page.evaluate('window.__BENCH__.reset();');
    await page.evaluate(INTERACTIONS[task.id]);
    return await page.evaluate('return window.__BENCH__.read();');
  } finally {
    await page.close();
  }
}

test('every fixture seeds work on the canvas its answer names', { timeout: 240000 }, async () => {
  const { server, port } = await serve(path.join(benchmark, 'pages'));
  try {
    for (const task of manifest.tasks) {
      const key = answers.keys[task.id];
      const records = await drive(task, port);
      assert.ok(records.length > 0, `${task.id} drew nothing, so the fixture is not exercisable`);

      const busiest = records[0];
      assert.ok(busiest.calls > 50, `${task.id} issued only ${busiest.calls} calls; the symptom would not be noticeable`);

      // The seeded answer must be true of the fixture's real behaviour. This is
      // the check that stops a participant being marked wrong for reading the
      // page correctly.
      if (task.id === 'hidden-cache-canvas') {
        // The whole point of this task: the busiest canvas is not on screen.
        assert.equal(busiest.inDocument, false, 'the busiest canvas is in the document, so the task tests nothing');
        const visible = records.find(record => record.label === 'visible');
        assert.ok(visible.calls < busiest.calls, 'the visible canvas is doing more work than the cache canvas');
      } else {
        assert.equal(busiest.label, key.canvas, `${task.id} names ${key.canvas}, but ${busiest.label} did the work`);
      }
    }
  } finally {
    server.close();
  }
});

test('each fixture shows the method its seeded cause predicts', { timeout: 240000 }, async () => {
  // The cause tag is a claim about which call dominates. If the fixture does
  // not show that call, the answer key is describing a page that does not
  // exist.
  const predicted = {
    'scene-overdraw': 'fillRect',
    'resize-churn': 'fill',
    'oversized-backing-store': 'fillRect',
    'gradient-per-shape': 'createLinearGradient',
    'pixel-readback': 'getImageData',
    'hidden-cache-canvas': 'arc',
  };
  const { server, port } = await serve(path.join(benchmark, 'pages'));
  try {
    for (const task of manifest.tasks) {
      const records = await drive(task, port);
      const method = predicted[task.id];
      const found = records.some(record => (record.methods[method] ?? 0) > 0);
      assert.ok(found, `${task.id} never called ${method}, which its seeded cause depends on`);
    }
  } finally {
    server.close();
  }
});
