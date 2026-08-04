import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..'); const port = 5194; const baseUrl = `http://127.0.0.1:${port}`;
let server; let browser; let browserVersion = null; let bundleHash = null; const failures = []; const warnings = []; const consoleErrors = []; const pageErrors = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const stopServer = async () => { if (!server?.pid) return; try { process.kill(-server.pid, 'SIGTERM'); } catch {} await Promise.race([once(server, 'exit'), wait(5000)]); };
const waitForServer = async () => { for (let deadline = Date.now() + 60000; Date.now() < deadline; await wait(250)) { if (server.exitCode != null) throw new Error(`workbench server exited with ${server.exitCode}`); try { if ((await fetch(baseUrl)).ok) return; } catch {} } throw new Error('workbench server did not start'); };
const shadowClick = (page, selector) => page.evaluate(selector => { const button = document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector(selector); if (!(button instanceof HTMLElement)) throw new Error(`missing ${selector}`); button.click(); }, selector);
const run = async mode => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  page.on('pageerror', error => pageErrors.push(`${mode}: ${error.message}`)); page.on('console', message => { if (message.type() === 'warning') warnings.push(`${mode}: ${message.text()}`); if (message.type() === 'error') consoleErrors.push(`${mode}: ${message.text()}`); });
  try {
    await page.goto(`${baseUrl}/v04-06-backing-store.html?mode=${mode}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__CANVAS_SCAN__ && window.__BACKING_STORE_PROBE__?.ticks >= 3);
    await shadowClick(page, '.record'); await page.click('#draw'); await page.waitForFunction(() => window.__BACKING_STORE_PROBE__?.pendingDraws === 0); await page.waitForTimeout(200); await shadowClick(page, '.stop-recording');
    const session = await page.evaluate(() => window.__CANVAS_SCAN__.getLastSession());
    const facts = await page.evaluate(() => {
      const probe = window.__BACKING_STORE_PROBE__;
      const seeded = document.querySelector('#seeded-canvas'); const rect = seeded.getBoundingClientRect();
      const plain = value => value === null || ['string', 'number', 'boolean'].includes(typeof value) || (Array.isArray(value) && value.every(plain)) || (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(plain));
      return { ...probe, measuredCssWidth: rect.width, measuredCssHeight: rect.height, idleTracked: Object.values(window.__CANVAS_SCAN__.getReports()).some(report => report.canvasId.startsWith('idle-canvas#')), plainJson: plain(window.__CANVAS_SCAN__.getLastSession()) };
    });
    const viewport = page.viewportSize(); const pixelHash = createHash('sha256').update(await page.locator('#seeded-canvas').screenshot()).digest('hex');
    const finding = session.findings.find(item => item.type === 'backing-store-mismatch' && item.canvasId.startsWith('seeded-canvas#'));
    await shadowClick(page, '.counts');
    if (finding) await page.waitForFunction(id => [...document.querySelector('[data-canvas-scan]').shadowRoot.querySelectorAll('.repeated-finding')].some(card => card.dataset.canvasId === id), finding.canvasId);
    const cardText = finding ? await page.evaluate(id => {
      const root = document.querySelector('[data-canvas-scan]')?.shadowRoot;
      const element = [...(root?.querySelectorAll('.repeated-finding') ?? [])].find(card => card.dataset.canvasId === id);
      if (!(element instanceof HTMLElement)) return null;
      element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      element.click();
      return element.textContent ?? '';
    }, finding.canvasId) : null;
    if (finding) await page.waitForTimeout(300);
    const actions = finding ? await page.evaluate(id => {
      const root = document.querySelector('[data-canvas-scan]')?.shadowRoot;
      return {
        locateWorks: root?.querySelector(`[data-canvas-id="${CSS.escape(id)}"].outline`)?.classList.contains('locate') ?? false,
        inspectWorks: Boolean(root?.querySelector('.popover-owner')?.textContent),
      };
    }, finding.canvasId) : { locateWorks: false, inspectWorks: false };
    return { session, facts, finding, cardText: cardText ?? '', ...actions, pixelHash, viewport };
  } finally { await page.close(); }
};
let bad; let fixed;
try {
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  await copyFile(path.join(repoRoot, 'packages/core/dist/canvas-scan.iife.js'), path.join(repoRoot, 'apps/workbench/public/canvas-scan.iife.js'));
  bundleHash = createHash('sha256').update(await readFile(path.join(repoRoot, 'apps/workbench/public/canvas-scan.iife.js'))).digest('hex');
  server = spawn('pnpm', ['--filter', 'workbench', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: repoRoot, detached: true, stdio: 'inherit' }); await waitForServer();
  browser = await chromium.launch({ channel: 'chrome', headless: true }); browserVersion = browser.version(); bad = await run('bad'); fixed = await run('fixed');
} catch (error) { failures.push(error instanceof Error ? error.message : String(error)); } finally { try { await browser?.close(); } catch (error) { failures.push(String(error)); } try { await stopServer(); } catch (error) { failures.push(String(error)); } }
const badSeededFindings = bad?.session?.findings.filter(item => item.type === 'backing-store-mismatch' && item.canvasId.startsWith('seeded-canvas#')) ?? []; const fixedWindow = fixed?.session?.windows.find(window => window.canvasId.startsWith('seeded-canvas#')); const idleFinding = bad?.session?.findings.find(item => item.type === 'backing-store-mismatch' && item.canvasId.startsWith('idle-canvas#')); const idleWindow = bad?.session?.windows.find(window => window.canvasId.startsWith('idle-canvas#'));
const checks = {
  viewportAndDpr: bad?.viewport?.width === 1280 && bad?.viewport?.height === 720 && fixed?.viewport?.width === 1280 && fixed?.viewport?.height === 720 && bad?.facts?.devicePixelRatio === 2 && fixed?.facts?.devicePixelRatio === 2 && bad?.facts?.qualityTargetDpr === 2 && fixed?.facts?.qualityTargetDpr === 2,
  sameScene: JSON.stringify(bad?.facts?.scene) === JSON.stringify(fixed?.facts?.scene) && bad?.facts?.measuredCssWidth === 240 && bad?.facts?.measuredCssHeight === 120 && fixed?.facts?.measuredCssWidth === 240 && fixed?.facts?.measuredCssHeight === 120 && bad?.pixelHash === fixed?.pixelHash,
  badFinding: badSeededFindings.length === 1 && bad?.finding?.affectedWindowCount >= 2 && bad?.finding?.affectedWindows?.length === bad?.finding?.affectedWindowCount && bad?.finding?.affectedWindows?.every(window => window.backingWidth === 960 && window.backingHeight === 480 && window.expectedBackingWidth === 480 && window.expectedBackingHeight === 240 && window.expectedPixelArea === 115200 && window.actualToExpectedAreaRatio === 4 && window.rasterOperationCount > 0),
  idleHasNoFinding: bad?.facts?.idleTracked === true && !idleWindow && !idleFinding,
  fixedNoFinding: !fixed?.session?.findings.some(item => item.type === 'backing-store-mismatch' && item.canvasId.startsWith('seeded-canvas#')) && fixedWindow?.geometry?.backingWidth === 480 && fixedWindow?.geometry?.backingHeight === 240 && fixedWindow?.geometry?.expectedBackingWidth === 480 && fixedWindow?.geometry?.expectedBackingHeight === 240 && fixedWindow?.geometry?.expectedPixelArea === 115200 && fixedWindow?.geometry?.actualToExpectedAreaRatio === 1,
  plainJson: bad?.facts?.plainJson === true && fixed?.facts?.plainJson === true,
  safeCard: Boolean(bad?.cardText.includes('candidate') && bad?.cardText.includes(`${bad?.finding?.affectedWindowCount} affected windows`) && bad?.cardText.includes('Actual 960×480') && bad?.cardText.includes('expected 480×240') && bad?.cardText.includes('area ratio 4') && bad?.cardText.includes('Raster operations') && bad?.cardText.includes('Canvas2D API self-time') && bad?.cardText.includes('GPU cost') && bad?.cardText.includes('Check the canvas sizing policy and the required image quality.')),
  actionsWork: bad?.locateWorks === true && bad?.inspectWorks === true,
  noWarningsOrPageErrors: warnings.length === 0 && consoleErrors.length === 0 && pageErrors.length === 0, browserVersionCaptured: Boolean(browserVersion), bundleHashCaptured: Boolean(bundleHash),
};
if (!Object.values(checks).every(Boolean)) failures.push(`failed checks: ${Object.entries(checks).filter(([, value]) => !value).map(([key]) => key).join(', ')}`);
await writeFile('/private/tmp/sidproj-50-bad-session.json', `${JSON.stringify(bad?.session ?? null, null, 2)}\n`); await writeFile('/private/tmp/sidproj-50-fixed-session.json', `${JSON.stringify(fixed?.session ?? null, null, 2)}\n`); await writeFile('/private/tmp/sidproj-50-finding-card.txt', `${bad?.cardText ?? ''}\n`);
const result = { status: failures.length ? 'FAIL' : 'PASS', browserVersion, gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(), bundleHash, checks, warnings, consoleErrors, pageErrors, failures, bad, fixed }; await writeFile('/private/tmp/sidproj-50-comparison.json', `${JSON.stringify(result, null, 2)}\n`);
if (result.status === 'PASS') console.log('CANVAS_BACKING_STORE_V04_06: PASS'); else console.error(`CANVAS_BACKING_STORE_V04_06: FAIL ${failures.join('; ')}`); process.exitCode = result.status === 'PASS' ? 0 : 1;
