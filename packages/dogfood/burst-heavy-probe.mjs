import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const port = 5191;
const baseUrl = `http://127.0.0.1:${port}`;
const sourceBundle = path.join(repoRoot, 'packages/core/dist/canvas-scan.iife.js');
const workbenchBundle = path.join(repoRoot, 'apps/workbench/public/canvas-scan.iife.js');
let server; let browser; let browserVersion = null; let bundleHash = null;
const failures = []; const pageErrors = []; const warnings = [];

const wait = timeout => new Promise(resolve => setTimeout(resolve, timeout));
const waitForServer = async () => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (server.exitCode != null || server.signalCode != null) throw new Error(`workbench server exited with ${server.exitCode ?? server.signalCode}`);
    try { if ((await fetch(baseUrl)).ok) return; } catch {}
    await wait(250);
  }
  throw new Error('workbench server did not start');
};
const stopServer = async () => {
  if (!server?.pid) return;
  const exited = () => server.exitCode != null || server.signalCode != null;
  try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (!exited()) await Promise.race([once(server, 'exit'), wait(5000)]);
  if (!exited()) {
    try { process.kill(-server.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await Promise.race([once(server, 'exit'), wait(5000)]);
  }
  if (!exited()) throw new Error('workbench server did not exit after cleanup signals');
};
const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);
const plain = value => value === null || ['string', 'number', 'boolean'].includes(typeof value) ||
  (Array.isArray(value) && value.every(plain)) ||
  (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(plain));
const imageHash = async page => page.evaluate(() => {
  const bytes = document.querySelector('#flamegraph-canvas').getContext('2d').getImageData(0, 0, 900, 500).data;
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(16);
});
const runMode = async mode => {
  const page = await browser.newPage();
  page.on('pageerror', error => pageErrors.push(`${mode}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'warning') warnings.push(`${mode}: ${message.text()}`); });
  try {
    await page.goto(`${baseUrl}/v04-03-burst.html?mode=${mode}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__CANVAS_SCAN__ && window.__BURST_PROBE__);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(() => window.__CANVAS_SCAN__.startRecording());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    await page.click('#draw');
    await page.waitForFunction(() => window.__BURST_PROBE__.drawComplete);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    const session = await page.evaluate(() => window.__CANVAS_SCAN__.stopRecording());
    const visibleHash = await imageHash(page);
    return { facts: await page.evaluate(() => window.__BURST_PROBE__), session, visibleHash };
  } finally { await page.close(); }
};
const canvasSumsMatch = session => session.canvases.every(canvas => {
  const reports = session.windows.filter(window => window.canvasId === canvas.canvasId);
  return Math.abs(canvas.canvasApiSelfTimeMs - sum(reports, 'canvasApiSelfTimeMs')) < 0.01 &&
    canvas.rasterOperationCount === sum(reports, 'rasterOperationCount');
});
const methodSumsMatch = (summary, reports) => {
  const methods = [...new Set(reports.flatMap(report => Object.keys(report.methodEvidence)))].sort();
  if (Object.keys(summary.methodEvidence).sort().join() !== methods.join()) return false;
  return methods.every(method => {
    const evidence = summary.methodEvidence[method];
    const values = reports.map(report => report.methodEvidence[method]).filter(Boolean);
    const timed = values.map(value => value.canvasApiSelfTimeMs).filter(value => value !== null);
    return evidence.count === sum(values, 'count') &&
      (evidence.canvasApiSelfTimeMs === null ? timed.length === 0 : Math.abs(evidence.canvasApiSelfTimeMs - timed.reduce((total, value) => total + value, 0)) < 0.01);
  });
};
const episodeSumsMatch = session => session.episodes.every(episode => {
  const reports = session.windows.filter(window => window.windowIndex >= episode.firstWindowIndex && window.windowIndex <= episode.lastWindowIndex);
  return Math.abs(episode.canvasApiSelfTimeMs - sum(reports, 'canvasApiSelfTimeMs')) < 0.01 &&
    episode.rasterOperationCount === sum(reports, 'rasterOperationCount') &&
    methodSumsMatch(episode, reports) &&
    episode.canvases.every(canvas => {
      const canvasReports = reports.filter(report => report.canvasId === canvas.canvasId);
      return Math.abs(canvas.canvasApiSelfTimeMs - sum(canvasReports, 'canvasApiSelfTimeMs')) < 0.01 &&
        canvas.rasterOperationCount === sum(canvasReports, 'rasterOperationCount') &&
        methodSumsMatch(canvas, canvasReports);
    });
});
let bad; let fixed;
try {
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'exec', 'esbuild', 'src/auto.ts', '--bundle', '--format=iife', '--outfile=dist/canvas-scan.iife.js', '--minify'], { cwd: repoRoot, stdio: 'inherit' });
  await copyFile(sourceBundle, workbenchBundle);
  bundleHash = createHash('sha256').update(await readFile(workbenchBundle)).digest('hex');
  server = spawn('pnpm', ['--filter', 'workbench', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: repoRoot, stdio: 'inherit', detached: true });
  await waitForServer();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  browserVersion = browser.version();
  bad = await runMode('bad');
  fixed = await runMode('fixed');
} catch (error) { failures.push(error instanceof Error ? error.message : String(error));
} finally {
  try { await browser?.close(); } catch (error) { failures.push(String(error)); }
  try { await stopServer(); } catch (error) { failures.push(String(error)); }
}
const badFlamegraph = bad?.session?.canvases?.[0];
const badFinding = bad?.session?.findings?.find(finding => finding.type === 'heavy-canvas-work' && finding.canvasId === badFlamegraph?.canvasId);
const checks = {
  sessionsNonEmpty: Boolean(bad?.session?.windows?.length && fixed?.session?.windows?.length),
  jsonOnly: Boolean(bad?.session && fixed?.session && plain(bad.session) && plain(fixed.session)),
  sameDataAndInteraction: bad?.facts?.checksum === fixed?.facts?.checksum && bad?.facts?.interactions === 1 && fixed?.facts?.interactions === 1,
  sameVisibleFlamegraph: bad?.visibleHash === fixed?.visibleHash,
  badRanksSeededCanvasFirst: bad?.session?.canvases?.length >= 2 && badFlamegraph?.canvasId?.startsWith('flamegraph-canvas#'),
  badFindingFields: Boolean(badFinding?.evidenceLevel === 'candidate' && badFinding?.canvasApiSelfTimeMs >= 8 && badFinding?.topMethods?.length && badFinding.topMethods.every(method => method.method && Number.isInteger(method.count) && (method.canvasApiSelfTimeMs === null || Number.isFinite(method.canvasApiSelfTimeMs))) && Object.keys(badFinding?.maximumWindow?.methodEvidence ?? {}).length && Number.isFinite(badFinding?.maximumWindow?.canvasApiSelfTimeMs) && badFinding?.claimBoundary?.observation?.includes('measured Canvas2D API self-time') && badFinding?.claimBoundary?.explanation?.includes('review candidate') && badFinding?.claimBoundary?.nonEstablishedFacts?.includes('does not establish GPU time') && badFinding?.nextCheck?.includes('top measured methods')),
  canvasSums: Boolean(bad?.session && canvasSumsMatch(bad.session) && canvasSumsMatch(fixed.session) && bad.session.canvases.every(canvas => methodSumsMatch(canvas, bad.session.windows.filter(window => window.canvasId === canvas.canvasId))) && fixed.session.canvases.every(canvas => methodSumsMatch(canvas, fixed.session.windows.filter(window => window.canvasId === canvas.canvasId)))),
  episodeSums: Boolean(bad?.session && episodeSumsMatch(bad.session) && episodeSumsMatch(fixed.session)),
  fixedHasNoSeededFinding: !fixed?.session?.findings?.some(finding => finding.type === 'heavy-canvas-work' && finding.canvasId.startsWith('flamegraph-canvas#')),
  idleWaitsAddNoActiveBoundary: bad?.session?.episodes?.length === 1 && bad.session.episodes[0].activeWindowCount === 1 && fixed?.session?.episodes?.length === 1 && fixed.session.episodes[0].activeWindowCount === 1,
  noWarningsOrPageErrors: warnings.length === 0 && pageErrors.length === 0,
  instrumentationStayedEnabled: !warnings.some(warning => /disabled|kill/i.test(warning)),
  browserVersionCaptured: Boolean(browserVersion),
};
if (!Object.values(checks).every(Boolean)) failures.push(`failed checks: ${Object.entries(checks).filter(([, value]) => !value).map(([key]) => key).join(', ')}`);
await writeFile('/private/tmp/sidproj-51-bad-session.json', `${JSON.stringify(bad?.session ?? null, null, 2)}\n`);
await writeFile('/private/tmp/sidproj-51-fixed-session.json', `${JSON.stringify(fixed?.session ?? null, null, 2)}\n`);
const result = { probeVersion: 1, status: failures.length ? 'FAIL' : 'PASS', browserVersion, gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(), bundleHash, checks, warnings, pageErrors, failures, bad, fixed };
await writeFile('/private/tmp/sidproj-51-burst-comparison.json', `${JSON.stringify(result, null, 2)}\n`);
if (result.status === 'PASS') console.log('CANVAS_BURST_V04_03: PASS');
else console.error(`CANVAS_BURST_V04_03: FAIL ${failures.join('; ')}`);
process.exitCode = result.status === 'PASS' ? 0 : 1;
