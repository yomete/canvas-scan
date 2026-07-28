import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const failures = [];

function record(state, stateFailures) {
  failures.push(...stateFailures.map((failure) => `${state}: ${failure}`));
  console.log(`${state.toUpperCase()}: ${stateFailures.length === 0 ? 'PASS' : 'FAIL'}`);
}

await page.goto('http://localhost:5173', { waitUntil: 'load' });
await page.waitForFunction(() => window.__CANVAS_SCAN__ != null, null, { timeout: 15000 });
await page.waitForTimeout(1200);
await page.click('text=force same-signature redraw');
await page.waitForTimeout(120);
await page.click('text=force same-signature redraw');
await page.waitForTimeout(350);
await page.screenshot({ path: `${out}/v2-toolbar.png` });

const inShadow = (fn, arg) =>
  page.evaluate(
    ([body, a]) => new Function('root', 'arg', body)(
      document.querySelector('[data-canvas-scan]').shadowRoot, a),
    [fn, arg ?? null],
  );

const toolbarCount = await inShadow(`return root.querySelectorAll('.toolbar').length`);
record('toolbar', toolbarCount === 1 ? [] : [`expected one toolbar, found ${toolbarCount}`]);

// open flyout
await inShadow(`root.querySelector('.control.counts').dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}))`);
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/v2-flyout.png` });
const flyoutState = await inShadow(`
  const flyout = root.querySelector('.flyout');
  return {
    hidden: flyout?.hidden ?? true,
    rowCount: flyout?.querySelectorAll('.row').length ?? 0,
    text: flyout?.textContent ?? 'NO FLYOUT',
  };
`);
console.log('FLYOUT:', flyoutState.text);
record(
  'flyout',
  [
    flyoutState.hidden ? 'flyout is hidden' : null,
    flyoutState.rowCount < 1 ? 'expected at least one row' : null,
  ].filter(Boolean),
);

// inspect mode + click the effect canvas outline
await inShadow(`root.querySelector('.control.inspect').dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}))`);
await page.waitForTimeout(400);
const outlineInfo = await inShadow(`return [...root.querySelectorAll('.outline')].map(o => o.className + '|' + getComputedStyle(o).pointerEvents).join(' ; ')`);
console.log('OUTLINES IN INSPECT:', outlineInfo);
const inspectState = await inShadow(`
  const outlines = [...root.querySelectorAll('.outline')];
  const target = outlines[outlines.length - 1];
  if (!target) return { outlineCount: 0, owner: '' };
  const owner = target.querySelector('.label')?.textContent?.split(' · ')[0] ?? '';
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  return { outlineCount: outlines.length, owner };
`);
record(
  'inspect',
  [
    inspectState.outlineCount < 1 ? 'expected at least one outline' : null,
    inspectState.owner.length === 0 ? 'target outline has no owner name' : null,
  ].filter(Boolean),
);
let sourceWaitFailure = null;
try {
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-canvas-scan]')?.shadowRoot;
    const text = root?.querySelector('.popover')?.textContent ?? '';
    return /source: .+:\d+/.test(text);
  }, null, { timeout: 8000 });
} catch (error) {
  sourceWaitFailure = `source did not resolve before timeout: ${error.message}`;
}
await page.waitForTimeout(300);
const popoverState = await inShadow(`
  const popover = root.querySelector('.popover');
  return {
    hidden: popover?.hidden ?? true,
    text: popover?.textContent ?? 'NO POPOVER',
  };
`);
console.log('POPOVER:', popoverState.text);
record(
  'popover',
  [
    popoverState.hidden ? 'popover is hidden' : null,
    !inspectState.owner || !popoverState.text.includes(inspectState.owner)
      ? `missing owner name ${JSON.stringify(inspectState.owner)}`
      : null,
    !/source: .+:\d+/.test(popoverState.text)
      ? 'missing resolved source matching /source: .+:\\d+/'
      : null,
    sourceWaitFailure,
  ].filter(Boolean),
);
await page.screenshot({ path: `${out}/v2-inspect-popover.png` });
await browser.close();

console.log(JSON.stringify({ flyoutState, inspectState, popoverState, failures }, null, 2));
console.log(failures.length === 0 ? 'V2 SHOTS: PASS' : 'V2 SHOTS: FAIL');
process.exitCode = failures.length === 0 ? 0 : 1;
