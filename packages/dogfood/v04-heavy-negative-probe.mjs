import { createHash, randomUUID } from 'node:crypto';
import { copyFile, readFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { checkArtifact, checkTargetedRun } from './v04-heavy-negative-probe-check.mjs';
import { createEvidenceRun, sha256 as manifestSha256, verifyReleaseManifest, writeFinalArtifact, writeRunIndex } from './v04-evidence-run.mjs';
import { releaseManifest } from './v04-release-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const dropKeys = ['canvasWindowReports', 'canvasLifetimes', 'resetEvents', 'lifecycleEvents', 'documentEvents', 'eventTiming', 'userMarks', 'longAnimationFrames'];
const diagnostics = () => ({ warnings: [], consoleErrors: [], pageErrors: [], requestFailures: [], instrumentationKills: [], unsupportedEvidence: [] });
const pageBrowserContract = page => page.evaluate(() => {
  const scripts = [...document.scripts].map(script => {
    const rawSrc = script.getAttribute('src');
    const resolved = rawSrc === null ? null : new URL(script.src);
    const kind = rawSrc === null ? script.type ? `${script.type}-inline` : 'classic-inline' : script.type === 'module' ? 'module-external' : 'classic-external';
    const resolvedPath = resolved?.origin === location.origin ? resolved.pathname : resolved?.href ?? null;
    const role = kind === 'classic-inline' && rawSrc === null ? 'options'
      : kind === 'classic-external' && rawSrc === '/canvas-scan.iife.js' && resolvedPath === '/canvas-scan.iife.js' ? 'canvas-scan'
        : kind === 'module-external' && rawSrc === '/src/v04-lab-main.tsx' && resolvedPath === '/src/v04-lab-main.tsx' ? 'application'
          : 'unexpected';
    return {
      role,
      kind,
      rawSrc,
      resolvedPath,
      query: resolved?.search ?? '',
      fragment: resolved?.hash ?? '',
    };
  });
  const descriptor = Object.getOwnPropertyDescriptor(window, '__CANVAS_SCAN_OPTS');
  const optionValue = descriptor?.value;
  const fixture = window.__CANVAS_LAB_FIXTURE__;
  return {
    scripts,
    options: {
      own: Object.hasOwn(window, '__CANVAS_SCAN_OPTS'),
      frozen: Object.isFrozen(optionValue),
      writable: descriptor?.writable ?? null,
      configurable: descriptor?.configurable ?? null,
      keys: optionValue && typeof optionValue === 'object' ? Object.keys(optionValue) : [],
      overlay: optionValue?.overlay ?? null,
    },
    ready: {
      canvasScan: Boolean(window.__CANVAS_SCAN__),
      fixture: fixture?.ready === true,
      capabilityValidated: fixture?.snapshot()?.capabilityValidated === true,
    },
  };
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const wait = timeout => new Promise(resolve => setTimeout(resolve, timeout));
const exited = child => !child || child.exitCode !== null || child.signalCode !== null;
const appendErrors = (primary, errors) => {
  if (!errors.length) return primary;
  const message = [primary?.message, ...errors.map(error => error.message)].filter(Boolean).join('; ');
  return Object.assign(new Error(message), { cause: primary ?? errors[0] });
};
export function portListeners(runLsof = () => execFileSync('/usr/sbin/lsof', ['-nP', '-iTCP@127.0.0.1:5190', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })) {
  try { return String(runLsof()).trim().split('\n').filter(Boolean); }
  catch (error) { if (error?.status === 1) return []; throw error; }
}
export function exactZeroDrops(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === dropKeys.length && dropKeys.every(key => Number.isInteger(value[key]) && value[key] === 0);
}
export const changedReportFromEntry = entry => Array.isArray(entry) ? entry[1] : undefined;
export async function drainThenStartMeasured(driver) {
  const transitions = ['idle'];
  const before = structuredClone(await driver.snapshotReports());
  await driver.startRecording('drain'); transitions.push('drain-started');
  await driver.sendDrainOperations(17); transitions.push('operations-sent');
  const changed = await driver.waitForChangedReport(before, 17, 5000);
  if (!changed || changed.rasterOperationCount !== 17) throw new Error('drain report was not acknowledged');
  transitions.push('report-acknowledged');
  const stopped = await driver.stopRecording('drain'); transitions.push('drain-stopped');
  const windows = stopped?.windows ?? stopped?.canvasWindows ?? [];
  if (!windows.some(window => window?.rasterOperationCount === 17)) throw new Error('drain stop lacks the 17-operation window');
  transitions.push('drain-proven');
  await driver.startRecording('measured'); transitions.push('measured-started');
  return { transitions, before, changed, stopped };
}
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
export function validateProbeExit(artifact) {
  if (!plain(artifact)) return ['artifact schema'];
  return checkArtifact(artifact, {
    modules: artifact.modules,
    manifestSha256: artifact.manifestSha256,
    chromeRevision: artifact.chromeRevision,
    gitSha: artifact.gitSha,
    bundleSha256: artifact.bundleSha256,
  }, artifact.port?.listenersAfter ?? []);
}
const waitForExit = async (child, timeout = 5000) => {
  if (exited(child)) return true;
  await Promise.race([once(child, 'exit'), wait(timeout)]);
  return exited(child);
};
export async function stopOwned(child, isOwned, signal = process.kill, waitForExitFn = waitForExit) {
  if (!child?.pid || exited(child)) return;
  const ownership = () => { try { return isOwned(child.pid); } catch (error) { if (error?.code === 'ESRCH') return undefined; throw error; } };
  const beforeTerm = ownership();
  if (beforeTerm === undefined) return;
  if (!beforeTerm) throw new Error('owned Vite process lost ownership');
  try { signal(-child.pid, 'SIGTERM'); } catch (error) { if (error?.code === 'ESRCH') return; throw error; }
  if (await waitForExitFn(child)) return;
  const beforeKill = ownership();
  if (beforeKill === undefined) return;
  if (!beforeKill) throw new Error('owned Vite process lost ownership before SIGKILL');
  try { signal(-child.pid, 'SIGKILL'); } catch (error) { if (error?.code === 'ESRCH') return; throw error; }
  if (!(await waitForExitFn(child))) throw new Error('owned Vite cleanup failed');
}
export async function runWithCleanup(operation, resources) {
  let result; let primary;
  try { result = await operation(); } catch (error) { primary = error; }
  const cleanup = [];
  for (const action of [resources.closeBrowser, resources.stopVite, resources.checkPort]) {
    try {
      const value = await action?.();
      if (action === resources.checkPort && Array.isArray(value) && value.length) throw new Error('port 5190 remains live');
    } catch (error) { cleanup.push(error); }
  }
  if (primary || cleanup.length) throw appendErrors(primary, cleanup);
  return result;
}
export async function writeWithFinalPortProof(write, checkPort) {
  let primary;
  try { await write(); } catch (error) { primary = error; }
  let portError;
  try { if ((await checkPort()).length) throw new Error('port 5190 remains live'); } catch (error) { portError = error; }
  if (primary || portError) throw appendErrors(primary, portError ? [portError] : []);
}
const processGroup = pid => Number(execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim());
const waitForVite = async child => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (exited(child)) throw new Error('Vite exited before ready');
    try {
      const response = await fetch('http://127.0.0.1:5190/v04-lab.html');
      if (response.ok && portListeners().length && portListeners().every(pid => processGroup(pid) === child.pid)) return;
    } catch {}
    await wait(100);
  }
  throw new Error('Vite readiness timeout');
};
const median = values => { const sorted = [...values].sort((left, right) => left - right); return (sorted[4] + sorted[5]) / 2; };
const safeRequest = request => { const url = new URL(request.url()); return `${request.method()} ${url.origin}${url.pathname}`.slice(0, 500); };
const pageDriver = page => ({
  snapshotReports: () => page.evaluate(() => structuredClone(window.__CANVAS_SCAN__.getReports())),
  startRecording: () => page.evaluate(() => window.__CANVAS_SCAN__.startRecording()),
  sendDrainOperations: count => page.evaluate(count => { const canvas = document.querySelector('[data-lab-role="primary"]'); const context = canvas?.getContext('2d'); for (let index = 0; index < count; index++) context?.clearRect(-1000 - index, -1000, 1, 1); }, count),
  waitForChangedReport: async (before, count, timeoutMs) => {
    const entry = await (await page.waitForFunction(({ before, count }) => {
    const reports = window.__CANVAS_SCAN__.getReports();
    return Object.entries(reports).find(([canvasId, report]) => JSON.stringify(before[canvasId]) !== JSON.stringify(report) && report.rasterOperationCount === count) ?? false;
    }, { before, count }, { timeout: timeoutMs })).jsonValue();
    return changedReportFromEntry(entry);
  },
  stopRecording: () => page.evaluate(() => window.__CANVAS_SCAN__.stopRecording()),
});
async function main() {
  if (portListeners().length) throw new Error('port 5190 already has a listener');
  const run = await createEvidenceRun('targeted');
  const modules = await verifyReleaseManifest();
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'run', 'build'], { cwd: root, stdio: 'inherit' });
  await copyFile(path.join(root, 'packages/core/dist/canvas-scan.iife.js'), path.join(root, 'apps/workbench/public/canvas-scan.iife.js'));
  const vite = spawn('pnpm', ['--filter', 'workbench', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5190', '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
  let browser; const startedAt = new Date().toISOString(); const diagnostic = diagnostics(); const runs = []; let browserContract;
  await runWithCleanup(async () => {
    await waitForVite(vite);
    browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    for (let iteration = 1; iteration <= 10; iteration++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const page = await context.newPage();
      page.on('console', message => { if (message.type() === 'warning') diagnostic.warnings.push('browser-warning'); if (message.type() === 'error') diagnostic.consoleErrors.push('browser-console-error'); if (/instrumentation.*(?:disabled|kill)|(?:disabled|kill).*instrumentation/i.test(message.text())) diagnostic.instrumentationKills.push('instrumentation-kill'); });
      page.on('pageerror', () => diagnostic.pageErrors.push('browser-page-error'));
      page.on('requestfailed', request => diagnostic.requestFailures.push(safeRequest(request)));
      await page.goto('http://127.0.0.1:5190/v04-lab.html?scenario=heavy-burst&variant=nearest-negative&mode=negative');
      await page.waitForFunction(() => window.__CANVAS_SCAN__ && window.__CANVAS_LAB_FIXTURE__?.ready);
      const currentBrowserContract = await pageBrowserContract(page);
      if (browserContract && JSON.stringify(currentBrowserContract) !== JSON.stringify(browserContract)) throw new Error('browser contract changed between captures');
      browserContract = currentBrowserContract;
      await drainThenStartMeasured(pageDriver(page));
      await page.locator('#lab-trigger').click();
      await page.evaluate(() => Promise.race([window.__CANVAS_LAB_FIXTURE__.completed, new Promise((_, reject) => setTimeout(() => reject(new Error('fixture timeout')), 30000))]));
      const result = await page.evaluate(() => ({ session: window.__CANVAS_SCAN__.stopRecording(), fixture: window.__CANVAS_LAB_FIXTURE__.snapshot(true) }));
      const canvas = Object.values(result.session.canvases).sort((left, right) => right.canvasApiSelfTimeMs - left.canvasApiSelfTimeMs)[0];
      const run = { iteration, canvasApiSelfTimeMs: canvas?.canvasApiSelfTimeMs, acceptedRunCount: result.fixture.acceptedRunCount, droppedEntryCounts: result.session.droppedEntryCounts, calibration: result.fixture.heavyCalibration };
      if (!exactZeroDrops(run.droppedEntryCounts)) diagnostic.unsupportedEvidence.push('unsupported-evidence'); else runs.push(run);
      await context.close();
    }
  }, { closeBrowser: () => browser?.close(), stopVite: () => stopOwned(vite, pid => processGroup(pid) === pid), checkPort: () => portListeners() });
  const values = runs.map(item => item.canvasApiSelfTimeMs);
  const artifact = { schemaVersion: 2, runId: run.runId, startedAt, endedAt: new Date().toISOString(), coordinate: { scenario: 'heavy-burst', variant: 'nearest-negative', mode: 'negative' }, band: { minimumInclusiveMs: 7, maximumExclusiveMs: 8 }, runCount: 10, runs, values, minimum: Math.min(...values), maximum: Math.max(...values), median: median(values), chromeRevision: execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--version'], { encoding: 'utf8' }).match(/(\d+\.\d+\.\d+\.\d+)/)?.[1], gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), bundleSha256: sha256(await readFile(path.join(root, 'apps/workbench/public/canvas-scan.iife.js'))), manifestSha256: manifestSha256(await readFile(path.join(root, 'packages/dogfood/v04-release-manifest.mjs'))), modules, browserContract, diagnostics: diagnostic, port: { number: 5190, listenersBefore: [], listenersAfter: portListeners() } };
  const failures = validateProbeExit(artifact);
  if (failures.length) throw new Error(failures.join(', '));
  await writeWithFinalPortProof(async () => { const item = await writeFinalArtifact(run, 'targeted.json', `${JSON.stringify(artifact)}\n`); await writeRunIndex(run, { schemaVersion: 1, issue: 'SIDPROJ-102', kind: 'targeted', runId: run.runId, startedAt, endedAt: artifact.endedAt, directory: { mode: '0700', ...run.directoryIdentity }, source: { gitSha: artifact.gitSha, chromeRevision: artifact.chromeRevision, bundleSha256: artifact.bundleSha256, manifestSha256: artifact.manifestSha256, modules }, artifacts: [{ name: item.name, role: 'targeted-evidence', device: item.device, inode: item.inode, size: item.size, sha256: item.sha256 }] }); }, () => portListeners());
  await checkTargetedRun(run.directory, run);
  if (!process.exitCode) { console.log(`SIDPROJ_102_TARGETED_RUN_DIR: ${run.directory}`); console.log('SIDPROJ_102_TARGETED_PROBE: PASS'); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
