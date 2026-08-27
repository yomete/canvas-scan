// Attribution against a real minified bundle with a real source map.
//
// This is the regression case for the excalidraw.com dogfood run, where 124 of
// 128 canvases had no React owner and the four that did resolved to `mRe`. Both
// halves of that defect are invisible to the unit suite: they need a bundler, a
// source map, and a browser that will fetch it.
//
// The fixture is built here rather than committed, because a committed bundle
// stops being a minified build the first time somebody tidies it.
//
// Run: node --test minified-attribution.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve } from '../../scripts/browser-driver.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const esbuild = path.join(root, 'node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/bin/esbuild');

// The application under test. One canvas, created imperatively and never put in
// the document — the shape Excalidraw uses for its per-element caches, and the
// shape React cannot see.
const APPLICATION = `
export function paintTiles(target) {
  const context = target.getContext('2d');
  for (let index = 0; index < 400; index++) {
    context.fillStyle = 'hsl(' + (index * 7) % 360 + ' 60% 55%)';
    context.fillRect((index % 20) * 20, Math.floor(index / 20) * 20, 18, 18);
  }
}

export function startCacheCanvas() {
  const cache = document.createElement('canvas');
  cache.width = 400;
  cache.height = 400;
  paintTiles(cache);
  const visible = document.getElementById('visible');
  const context = visible.getContext('2d');
  visible.addEventListener('pointermove', () => {
    paintTiles(cache);
    context.drawImage(cache, 0, 0);
  });
}

startCacheCanvas();
`;

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>minified fixture</title>
<canvas id="visible" width="400" height="400"></canvas>
<script src="./app.min.js"></script>
`;

function buildFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'canvas-scan-minified-'));
  writeFileSync(path.join(dir, 'renderer.js'), APPLICATION);
  writeFileSync(path.join(dir, 'index.html'), PAGE);
  execFileSync(esbuild, [
    path.join(dir, 'renderer.js'),
    '--bundle',
    '--minify',
    '--sourcemap',
    `--outfile=${path.join(dir, 'app.min.js')}`,
  ], { stdio: 'ignore' });
  return dir;
}

test('a canvas React never made resolves to the developer’s own source', { timeout: 240000 }, async () => {
  const dir = buildFixture();
  // The bundle must actually be minified and actually carry a map, or the test
  // proves nothing about a production build.
  const bundle = readFileSync(path.join(dir, 'app.min.js'), 'utf8');
  assert.ok(bundle.includes('//# sourceMappingURL='), 'the fixture bundle declares no source map');
  assert.ok(!bundle.includes('startCacheCanvas'), 'the fixture bundle was not minified');

  const canvasScan = readFileSync(path.join(root, 'packages/core/dist/canvas-scan.iife.js'), 'utf8');
  const { server, port } = await serve(dir);
  const page = await launch(`http://127.0.0.1:${port}/index.html`, { initScript: canvasScan });
  try {
    const result = await page.evaluate(`
      const api = window.__CANVAS_SCAN__;
      api.startRecording();
      const visible = document.getElementById('visible');
      for (let step = 0; step < 30; step++) {
        visible.dispatchEvent(new PointerEvent('pointermove', { clientX: 20 + step * 8, clientY: 40, bubbles: true }));
        await new Promise(done => requestAnimationFrame(done));
      }
      await new Promise(done => setTimeout(done, 600));
      api.stopRecording();
      await new Promise(done => setTimeout(done, 400));

      // Open the flyout, which is where a reader meets the findings, and give
      // the source-map lookup it starts time to land.
      const shadow = document.querySelector('[data-canvas-scan]').shadowRoot;
      if (shadow.querySelector('.flyout').hidden) shadow.querySelector('.counts').click();
      await new Promise(done => setTimeout(done, 1500));

      const session = api.getLastSession();
      const cards = [...shadow.querySelectorAll('.finding-card')].map(card => card.textContent);
      return {
        canvases: session.canvases.map(item => ({
          id: item.canvasId,
          kind: item.attributionKind,
          owner: item.nearestReactOwner,
          source: item.sourceLocation,
          ms: item.canvasApiSelfTimeMs,
        })),
        drawnFrom: cards.map(text => (text.match(/Drawn from [^·\\n]+/) ?? [null])[0]).filter(Boolean),
      };
    `);

    // Every canvas the run saw has a place in the source. Before this, an
    // imperatively created canvas carried nothing at all.
    assert.ok(result.canvases.length >= 2, `expected the visible and the cache canvas, got ${result.canvases.length}`);
    for (const canvas of result.canvases) {
      assert.ok(canvas.source, `${canvas.id} carries no source location`);
    }

    // The artifact holds the generated location, and only that. It is recorded
    // with no network at all, so it says the same thing whether or not a source
    // map was ever fetched. Mapping is a reading of it, not a replacement.
    for (const canvas of result.canvases) {
      assert.match(canvas.source.file, /app\.min\.js$/, `${canvas.id} put a mapped location in the artifact`);
    }

    // The card is where the reader meets the finding, and it names the file
    // they wrote. This is the whole point: app.min.js:1 is a real place and no
    // help.
    assert.ok(result.drawnFrom.length > 0, 'no finding card named where the canvas was drawn from');
    assert.ok(
      result.drawnFrom.some(line => line.includes('renderer.js')),
      `the cards still name the bundle: ${JSON.stringify(result.drawnFrom)}`,
    );
    assert.ok(
      !result.drawnFrom.some(line => line.includes('app.min.js')),
      `a card still names the bundle: ${JSON.stringify(result.drawnFrom)}`,
    );

  } finally {
    await page.close();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
