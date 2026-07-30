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

const resetProbe = async () => {
  const scan = window.__CANVAS_SCAN__;
  const settle = async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  };
  const makeCanvas = (id) => {
    const canvas = document.createElement('canvas');
    canvas.id = id;
    canvas.width = 64;
    canvas.height = 64;
    document.body.append(canvas);
    return { canvas, ctx: canvas.getContext('2d') };
  };
  const latest = (id) => {
    const report = Object.values(scan.getReports()).find((entry) =>
      entry.canvasId.startsWith(`${id}#`),
    );
    return report
      ? {
          status: report.signatureStatus,
          reason: report.unknownReason,
        }
      : null;
  };
  const drawBlue = (ctx) => {
    ctx.fillStyle = 'blue';
    ctx.fillRect(0, 0, 16, 16);
  };

  const direct = makeCanvas('probe-direct-reset');
  drawBlue(direct.ctx);
  await settle();
  drawBlue(direct.ctx);
  await settle();
  drawBlue(direct.ctx);
  await settle();
  const directBefore = latest('probe-direct-reset');
  direct.canvas.width = direct.canvas.width;
  drawBlue(direct.ctx);
  await settle();
  const directFirstReset = latest('probe-direct-reset');
  direct.canvas.width = direct.canvas.width;
  drawBlue(direct.ctx);
  await settle();
  const directSecondReset = latest('probe-direct-reset');
  drawBlue(direct.ctx);
  await settle();
  const directRecovery = latest('probe-direct-reset');
  drawBlue(direct.ctx);
  await settle();
  const directStable = latest('probe-direct-reset');

  const bypass = makeCanvas('probe-observer-reset');
  drawBlue(bypass.ctx);
  await settle();
  drawBlue(bypass.ctx);
  await settle();
  bypass.canvas.setAttributeNS(null, 'width', String(bypass.canvas.width));
  drawBlue(bypass.ctx);
  await settle();
  const bypassReset = latest('probe-observer-reset');
  drawBlue(bypass.ctx);
  await settle();
  const bypassSticky = latest('probe-observer-reset');
  bypass.canvas.width = bypass.canvas.width;
  drawBlue(bypass.ctx);
  await settle();
  const bypassExactRecovery = latest('probe-observer-reset');

  const source = makeCanvas('probe-source');
  const consumer = makeCanvas('probe-consumer');
  const control = makeCanvas('probe-control');
  drawBlue(source.ctx);
  await settle();
  consumer.ctx.drawImage(source.canvas, 0, 0);
  drawBlue(control.ctx);
  await settle();
  consumer.ctx.drawImage(source.canvas, 0, 0);
  drawBlue(control.ctx);
  await settle();
  consumer.ctx.drawImage(source.canvas, 0, 0);
  drawBlue(control.ctx);
  await settle();
  const consumerBefore = latest('probe-consumer');
  const controlBefore = latest('probe-control');
  source.canvas.setAttributeNS(
    null,
    'width',
    String(source.canvas.width),
  );
  consumer.ctx.drawImage(source.canvas, 0, 0);
  drawBlue(control.ctx);
  await settle();
  const consumerAfter = latest('probe-consumer');
  const controlAfter = latest('probe-control');

  let contextReset = null;
  if (typeof direct.ctx.reset === 'function') {
    direct.ctx.reset();
    drawBlue(direct.ctx);
    await settle();
    contextReset = latest('probe-direct-reset');
  }

  let reentrantReset = null;
  let reentrantCalls = 0;
  try {
    class ReentrantCanvas extends HTMLCanvasElement {
      static observedAttributes = ['width', 'height'];

      attributeChangedCallback() {
        if (this.probeArmed && this.probeContext) {
          reentrantCalls++;
          if (!this.probeNested) {
            this.probeNested = true;
            this.height = this.height;
          } else {
            this.probeContext.translate(10, 0);
          }
        }
      }
    }
    customElements.define('probe-reentrant-canvas', ReentrantCanvas, {
      extends: 'canvas',
    });
    const canvas = document.createElement('canvas', {
      is: 'probe-reentrant-canvas',
    });
    canvas.id = 'probe-reentrant-reset';
    canvas.width = 64;
    canvas.height = 64;
    document.body.append(canvas);
    const ctx = canvas.getContext('2d');
    canvas.probeContext = ctx;
    drawBlue(ctx);
    await settle();
    canvas.probeArmed = true;
    canvas.width = canvas.width;
    canvas.probeArmed = false;
    drawBlue(ctx);
    await settle();
    const reset = latest('probe-reentrant-reset');
    drawBlue(ctx);
    await settle();
    const sticky = latest('probe-reentrant-reset');
    reentrantReset = { reset, sticky };
  } catch {}

  return {
    direct: {
      before: directBefore,
      firstReset: directFirstReset,
      secondReset: directSecondReset,
      recovery: directRecovery,
      stable: directStable,
    },
    bypass: {
      reset: bypassReset,
      sticky: bypassSticky,
      exactRecovery: bypassExactRecovery,
    },
    source: {
      consumerBefore,
      consumerAfter,
      controlBefore,
      controlAfter,
    },
    contextReset,
    reentrant: {
      calls: reentrantCalls,
      reports: reentrantReset,
    },
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
const resets = await page.evaluate(resetProbe);
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
const expectReport = (label, report, status, reason) => {
  if (report?.status !== status || report?.reason !== reason) {
    failures.push(
      `${label}: expected ${status}/${reason}, got ${report?.status}/${report?.reason}`,
    );
  }
};
expectReport('direct baseline', resets.direct.before, 'same', null);
expectReport(
  'direct property reset',
  resets.direct.firstReset,
  'unknown',
  'canvas-reset',
);
expectReport(
  'repeated direct property reset',
  resets.direct.secondReset,
  'unknown',
  'canvas-reset',
);
expectReport(
  'direct reset recovery',
  resets.direct.recovery,
  'unknown',
  'first-window',
);
expectReport('direct stable recovery', resets.direct.stable, 'same', null);
expectReport(
  'observer-only reset',
  resets.bypass.reset,
  'unknown',
  'canvas-attribute-reset',
);
expectReport(
  'observer-only reset remains sticky',
  resets.bypass.sticky,
  'unknown',
  'canvas-state-unmodeled',
);
expectReport(
  'exact reset clears observer distrust',
  resets.bypass.exactRecovery,
  'unknown',
  'canvas-reset',
);
expectReport(
  'source consumer baseline',
  resets.source.consumerBefore,
  'same',
  null,
);
expectReport(
  'same-stack source reset',
  resets.source.consumerAfter,
  'unknown',
  'canvas-source-reset',
);
expectReport(
  'unrelated control baseline',
  resets.source.controlBefore,
  'same',
  null,
);
expectReport(
  'unrelated control remains comparable',
  resets.source.controlAfter,
  'same',
  null,
);
if (resets.contextReset !== null) {
  expectReport(
    'context reset',
    resets.contextReset,
    'unknown',
    'canvas-reset',
  );
}
if (resets.reentrant.reports !== null) {
  if (resets.reentrant.calls < 2) {
    failures.push(
      `custom-element nested reset reentered ${resets.reentrant.calls}x`,
    );
  }
  if (
    resets.reentrant.reports.reset?.status !== 'unknown' ||
    !['canvas-reset', 'canvas-attribute-reset'].includes(
      resets.reentrant.reports.reset?.reason,
    )
  ) {
    failures.push(
      `reentrant exact reset: got ${resets.reentrant.reports.reset?.status}/${resets.reentrant.reports.reset?.reason}`,
    );
  }
  expectReport(
    'reentrant exact reset remains sticky',
    resets.reentrant.reports.sticky,
    'unknown',
    'canvas-state-unmodeled',
  );
}
console.log(JSON.stringify({ off, full, resets, failures }, null, 2));
console.log(failures.length === 0 ? 'PROBES: PASS' : 'PROBES: FAIL');
process.exitCode = failures.length === 0 ? 0 : 1;
