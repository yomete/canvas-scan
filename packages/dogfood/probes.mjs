// Real-browser transparency probes (CODEX_REVIEW.md "final acceptance
// audit"): the tracer must never invoke a shadowed instance getLineDash and
// must add zero reads of inherited array indices during path modeling.
// Compares an instrumented page (mode=full) against an uninstrumented
// baseline (mode=off); exits nonzero on any divergence.
//
// Usage: node probes.mjs [baseUrl]
import { chromium } from 'playwright-core';

const baseUrl = process.argv[2] ?? 'http://localhost:5174';

const probe = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 200;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');

  let shadowCalls = 0;
  ctx.getLineDash = () => {
    shadowCalls++;
    return [];
  };
  ctx.setLineDash([5, 5]);
  const nativeDash = CanvasRenderingContext2D.prototype.getLineDash.call(ctx);

  let inheritedReads = 0;
  const radii = new Array(1);
  Object.setPrototypeOf(radii, {
    get 0() {
      inheritedReads++;
      return 40;
    },
  });
  ctx.beginPath();
  ctx.roundRect(0, 0, 100, 100, radii);
  ctx.fill();

  return {
    shadowCalls,
    nativeDash,
    inheritedReads,
    scanLoaded: Boolean(window.__CANVAS_SCAN__),
  };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

async function run(mode) {
  const url = new URL('/bench.html', baseUrl);
  url.searchParams.set('mode', mode);
  url.searchParams.set('ops', '1');
  await page.goto(url.href, { waitUntil: 'load' });
  return page.evaluate(probe);
}

const off = await run('off');
const full = await run('full');
await browser.close();

const failures = [];
if (!full.scanLoaded) failures.push('canvas-scan did not load in mode=full');
if (off.scanLoaded) failures.push('mode=off unexpectedly loaded canvas-scan');
if (full.shadowCalls !== 0) {
  failures.push(`tracer invoked shadowed getLineDash ${full.shadowCalls}x`);
}
if (String(full.nativeDash) !== '5,5') {
  failures.push(`native dash diverged: ${JSON.stringify(full.nativeDash)}`);
}
if (full.inheritedReads !== off.inheritedReads) {
  failures.push(
    `tracer added inherited-index reads: off=${off.inheritedReads} full=${full.inheritedReads}`,
  );
}

console.log(JSON.stringify({ off, full, failures }, null, 2));
console.log(failures.length === 0 ? 'PROBES: PASS' : 'PROBES: FAIL');
process.exitCode = failures.length === 0 ? 0 : 1;
