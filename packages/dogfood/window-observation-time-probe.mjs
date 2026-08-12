import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { checkWindowObservationTimeEvidence } from './window-observation-time-truth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidencePath = '/private/tmp/sidproj-87-window-observation-time.json';
const callbackOffsetMs = 1000;
const bundle = path.join(root, 'packages/core/dist/canvas-scan.iife.js');
const chromeExecutable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sourceFiles = ['packages/core/src/frame-loop.ts', 'packages/core/src/types.ts'].map(file => path.join(root, file));
const harnessFiles = ['packages/dogfood/window-observation-time-probe.mjs', 'packages/dogfood/window-observation-time-truth.mjs', 'packages/dogfood/window-observation-time-truth.test.mjs'].map(file => path.join(root, file));
async function hashFiles(files) {
  const digest = createHash('sha256');
  for (const file of [...files].sort()) {
    digest.update(path.relative(root, file)); digest.update('\0'); digest.update(await readFile(file)); digest.update('\0');
  }
  return digest.digest('hex');
}
function installedChromeRevision() {
  const output = execFileSync(chromeExecutable, ['--version'], { encoding: 'utf8' }).trim();
  const revision = output.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (!revision) throw new Error('installed Chrome revision is unavailable');
  return revision;
}
async function currentIdentity() {
  return {
    chromeRevision: installedChromeRevision(),
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    bundleSha256: createHash('sha256').update(await readFile(bundle)).digest('hex'),
    sourceSha256: await hashFiles(sourceFiles),
    harnessSha256: await hashFiles(harnessFiles),
  };
}
const listeners = () => {
  try {
    const value = execFileSync('/usr/sbin/lsof', ['-nP', '-iTCP@127.0.0.1:5190', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim();
    return value ? [...new Set(value.split('\n').map(Number))] : [];
  } catch (error) { if (error.status === 1) return []; throw error; }
};
async function writeEvidence(value) {
  const temporary = `${evidencePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, evidencePath);
}
async function checkDisk() {
  const stat = await lstat(evidencePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe evidence file');
  const failures = checkWindowObservationTimeEvidence(JSON.parse(await readFile(evidencePath, 'utf8')), await currentIdentity());
  if (failures.length) throw new Error(failures.join('; '));
  console.log('WINDOW_OBSERVATION_TIME_EVIDENCE: PASS');
}
async function run() {
  const listenersBefore = listeners();
  if (listenersBefore.length) throw new Error('port 5190 already has a listener');
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'run', 'build'], { cwd: root, stdio: 'inherit' });
  const identity = await currentIdentity();
  const startedAt = new Date().toISOString(); const diagnostics = { warnings: [], consoleErrors: [], pageErrors: [] };
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let result; let chromeRevision;
  try {
    chromeRevision = browser.version();
    const page = await browser.newPage();
    page.on('console', message => { if (message.type() === 'warning') diagnostics.warnings.push(message.text()); if (message.type() === 'error') diagnostics.consoleErrors.push(message.text()); });
    page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
    await page.setContent(`<canvas id="target" width="100" height="50"></canvas><script>
      window.__RAF_EVIDENCE__ = [];
      const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = callback => nativeRequestAnimationFrame(timestampMs => {
        const executionStartedAtTimestampMs = performance.now();
        const deliveredTimestampMs = timestampMs - ${callbackOffsetMs};
        const evidence = { nativeTimestampMs: timestampMs, deliveredTimestampMs, executionStartedAtTimestampMs, executionEndedAtTimestampMs: null };
        window.__RAF_EVIDENCE__.push(evidence);
        callback(deliveredTimestampMs);
        evidence.executionEndedAtTimestampMs = performance.now();
      });
    </script>`);
    await page.addScriptTag({ path: bundle });
    result = await page.evaluate(async () => {
      const canvas = document.querySelector('#target');
      const context = canvas.getContext('2d');
      const evidenceStart = window.__RAF_EVIDENCE__.length;
      window.__CANVAS_SCAN__.startRecording();
      const interactionStartedAtTimestampMs = performance.now();
      context.fillRect(0, 0, 1, 1);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const session = window.__CANVAS_SCAN__.stopRecording();
      const windowEvidence = session.windows.find(item => item.rasterOperationCount === 1);
      const callback = window.__RAF_EVIDENCE__.slice(evidenceStart).find(item => item.deliveredTimestampMs < interactionStartedAtTimestampMs && item.executionStartedAtTimestampMs >= interactionStartedAtTimestampMs && item.executionStartedAtTimestampMs <= windowEvidence.endedAtTimestampMs && windowEvidence.endedAtTimestampMs <= item.executionEndedAtTimestampMs);
      return { browserTimeOriginEpochMs: performance.timeOrigin, interactionStartedAtTimestampMs, callback, window: windowEvidence, episode: session.episodes[0], droppedEntryCounts: session.droppedEntryCounts };
    });
  } finally { await browser.close(); }
  const artifact = {
    schemaVersion: 1, runId: randomUUID(), startedAt, endedAt: new Date().toISOString(), ...identity, injectedCallbackOffsetMs: callbackOffsetMs,
    browserTimeOriginEpochMs: result.browserTimeOriginEpochMs, interactionStartedAtTimestampMs: result.interactionStartedAtTimestampMs,
    callback: result.callback,
    window: { startedAtTimestampMs: result.window.startedAtTimestampMs, endedAtTimestampMs: result.window.endedAtTimestampMs, rasterOperationCount: result.window.rasterOperationCount },
    episode: { startedAtTimestampMs: result.episode.startedAtTimestampMs, endedAtTimestampMs: result.episode.endedAtTimestampMs, rasterOperationCount: result.episode.rasterOperationCount },
    droppedEntryCounts: result.droppedEntryCounts, diagnostics, port: { number: 5190, listenersBefore, listenersAfter: listeners() },
  };
  if (chromeRevision !== identity.chromeRevision) throw new Error('launched Chrome does not match installed Chrome');
  const failures = checkWindowObservationTimeEvidence(artifact, identity);
  if (failures.length) throw new Error(failures.join('; '));
  await writeEvidence(artifact);
  console.log(evidencePath);
  console.log('WINDOW_OBSERVATION_TIME: PASS');
}

if (process.argv.length === 3 && process.argv[2] === '--check') checkDisk().catch(error => { console.error(`WINDOW_OBSERVATION_TIME: FAIL ${error.message}`); process.exitCode = 1; });
else if (process.argv.length === 2) run().catch(error => { console.error(`WINDOW_OBSERVATION_TIME: FAIL ${error.message}`); process.exitCode = 1; });
else { console.error('WINDOW_OBSERVATION_TIME: FAIL unsupported arguments'); process.exitCode = 1; }
