import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const port = 5193;
const baseUrl = `http://127.0.0.1:${port}`;
const sourceBundle = path.join(repoRoot, 'packages/core/dist/canvas-scan.iife.js');
const workbenchBundle = path.join(repoRoot, 'apps/workbench/public/canvas-scan.iife.js');
let server;
let browser;
let browserVersion = null;
let bundleSha256 = null;
const failures = [];
const checks = { servedCandidateBundle: false, publicApi: false, manualStop: false, manualArtifact: false, maxDuration: false, maxDurationArtifact: false, recordingActive: false, canvasUnavailable: false, deepCopy: false, jsonOnly: false };
const explanations = { manual: null, maxDuration: null };
const collectionLimits = { maxDurationMs: 10000, maxSelectedCanvases: 1, maxActiveWindows: 120, maxCommandEntries: 5000, maxArgumentsPerCommand: 20, maxValueTokens: 1024, maxStackSamples: 8, maxFramesPerStack: 20, maxSourceMapLookups: 8, maxSourceMapResponseBytes: 2097152 };
const droppedEntryCounts = { durationStops: 0, selectedCanvasRejections: 0, activeWindows: 0, commandEntries: 0, commandArguments: 0, valueTokens: 0, stackSamples: 0, stackFrames: 0, sourceMapLookups: 0, sourceMapResponses: 0 };
const limitResults = [
  ['duration-ms', 10000], ['selected-canvases', 1], ['active-windows', 120], ['command-entries', 5000], ['arguments-per-command', 20],
  ['value-tokens', 1024], ['stack-samples', 8], ['frames-per-stack', 20], ['source-map-lookups', 8], ['source-map-response-bytes', 2097152],
].map(([name, maximum]) => ({ name, maximum, rejectedCount: 0, reason: null, firstAffected: null }));

const hasExactArtifact = ({ artifact, followUp, source, stopReason }) => artifact?.schemaVersion === 1 &&
  typeof artifact.explanationId === 'string' && artifact.explanationId.length > 0 &&
  typeof artifact.startedAt === 'string' && typeof artifact.endedAt === 'string' &&
  Number.isFinite(artifact.durationMs) && artifact.stopReason === stopReason && artifact.canvasScanVersion === '0.4.0' &&
  artifact.source.sessionId === source.session.sessionId && artifact.source.findingIndex === source.findingIndex &&
  artifact.source.findingType === source.session.findings[source.findingIndex].type && artifact.source.canvasId === source.session.findings[source.findingIndex].canvasId &&
  artifact.followUp.sessionId === followUp?.sessionId && artifact.followUp.canvasId === artifact.source.canvasId &&
  JSON.stringify(artifact.collectionLimits) === JSON.stringify(collectionLimits) &&
  JSON.stringify(artifact.droppedEntryCounts) === JSON.stringify(stopReason === 'max-duration' ? { ...droppedEntryCounts, durationStops: 1 } : droppedEntryCounts) &&
  JSON.stringify(artifact.limitResults) === JSON.stringify(stopReason === 'max-duration' ? [{ ...limitResults[0], rejectedCount: 1, reason: 'max-duration', firstAffected: { scope: 'explanation', windowIndex: null, commandOrdinal: null } }, ...limitResults.slice(1)] : limitResults) &&
  JSON.stringify(artifact.callsiteCoverage) === JSON.stringify({ status: 'complete', incompleteReasons: [] }) &&
  Array.isArray(artifact.windows) && artifact.windows.length === 0 && Array.isArray(artifact.comparisons) && artifact.comparisons.length === 0 &&
  artifact.firstDifference === null && Array.isArray(artifact.stacks) && artifact.stacks.length === 0 && artifact.firstGap === null;

const waitForServer = async () => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (server.exitCode != null) throw new Error(`workbench server exited with ${server.exitCode}`);
    try { if ((await fetch(`${baseUrl}/v04-02-recording.html`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('workbench server did not start');
};
const stopServer = async () => {
  if (!server?.pid) return;
  const wait = timeout => Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, timeout))]);
  try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await wait(5000);
  if (server.exitCode == null && server.signalCode == null) {
    try { process.kill(-server.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await wait(5000);
  }
  if (server.exitCode == null && server.signalCode == null) throw new Error('workbench server did not stop');
};

try {
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  await copyFile(sourceBundle, workbenchBundle);
  server = spawn('pnpm', ['--filter', 'workbench', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: repoRoot, stdio: 'inherit', detached: true });
  await waitForServer();
  const [sourceBytes, served] = await Promise.all([readFile(sourceBundle), fetch(`${baseUrl}/canvas-scan.iife.js`)]);
  const bytes = Buffer.from(await served.arrayBuffer());
  bundleSha256 = createHash('sha256').update(bytes).digest('hex');
  checks.servedCandidateBundle = bundleSha256 === createHash('sha256').update(sourceBytes).digest('hex');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  browserVersion = browser.version();
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/v04-02-recording.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__CANVAS_SCAN__ != null, null, { timeout: 15000 });
  checks.publicApi = await page.evaluate(() => ['startRecording', 'stopRecording', 'getLastSession', 'mark', 'startExplanation', 'stopExplanation', 'getLastExplanation'].every(key => typeof window.__CANVAS_SCAN__[key] === 'function'));
  const createSource = () => page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.id = `explanation-source-${document.querySelectorAll('canvas').length}`;
    document.body.append(canvas);
    const context = canvas.getContext('2d');
    window.__CANVAS_SCAN__.startRecording();
    for (let index = 0; index < 6; index++) {
      context.fillRect(0, 0, 10, 10);
      context.fillRect(10, 0, 10, 10);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    await new Promise(resolve => requestAnimationFrame(resolve));
    const session = window.__CANVAS_SCAN__.stopRecording();
    const findingIndex = session.findings.findIndex(finding => finding.canvasId.startsWith(`${canvas.id}#`));
    if (findingIndex < 0) throw new Error(`source recording did not create a selected finding: ${JSON.stringify(session.windows)}`);
    return { session, findingIndex, elementId: canvas.id };
  });
  const sourceSession = await createSource();
  explanations.manual = await page.evaluate(({ session, findingIndex }) => {
    const start = window.__CANVAS_SCAN__.startExplanation({ sessionId: session.sessionId, findingIndex });
    const second = window.__CANVAS_SCAN__.startExplanation({ sessionId: session.sessionId, findingIndex });
    const explanation = window.__CANVAS_SCAN__.stopExplanation();
    return { start, second, explanation, followUp: window.__CANVAS_SCAN__.getLastSession() };
  }, sourceSession);
  checks.manualStop = explanations.manual.start.status === 'started' && explanations.manual.second.status === 'already-active' && explanations.manual.explanation?.stopReason === 'manual' && explanations.manual.followUp?.sessionId === explanations.manual.explanation?.followUp.sessionId;
  checks.manualArtifact = hasExactArtifact({ artifact: explanations.manual.explanation, followUp: explanations.manual.followUp, source: sourceSession, stopReason: 'manual' });
  checks.deepCopy = await page.evaluate(() => { const artifact = window.__CANVAS_SCAN__.getLastExplanation(); artifact.source.canvasId = 'changed'; return window.__CANVAS_SCAN__.getLastExplanation().source.canvasId !== 'changed'; });
  checks.jsonOnly = await page.evaluate(() => {
    const isPlain = value => value === null || ['string', 'number', 'boolean'].includes(typeof value) || (Array.isArray(value) && value.every(isPlain)) || (Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(isPlain));
    return isPlain(window.__CANVAS_SCAN__.getLastExplanation());
  });
  const automaticSource = await createSource();
  await page.evaluate(({ session, findingIndex }) => window.__CANVAS_SCAN__.startExplanation({ sessionId: session.sessionId, findingIndex }), automaticSource);
  await page.waitForFunction(() => window.__CANVAS_SCAN__.getLastExplanation()?.stopReason === 'max-duration', null, { timeout: 15000 });
  explanations.maxDuration = await page.evaluate(() => window.__CANVAS_SCAN__.getLastExplanation());
  checks.maxDuration = explanations.maxDuration?.durationMs >= 10000;
  checks.maxDurationArtifact = hasExactArtifact({ artifact: explanations.maxDuration, followUp: await page.evaluate(() => window.__CANVAS_SCAN__.getLastSession()), source: automaticSource, stopReason: 'max-duration' });
  checks.recordingActive = await page.evaluate(() => { window.__CANVAS_SCAN__.startRecording(); const result = window.__CANVAS_SCAN__.startExplanation({ sessionId: 'no', findingIndex: 0 }); const stillActive = window.__CANVAS_SCAN__.stopExplanation() === undefined; window.__CANVAS_SCAN__.stopRecording(); return result.reason === 'recording-active' && stillActive; });
  const absentSource = await createSource();
  checks.canvasUnavailable = await page.evaluate(async ({ session, findingIndex, elementId }) => {
    document.getElementById(elementId)?.remove();
    for (let index = 0; index < 120; index++) await new Promise(resolve => requestAnimationFrame(resolve));
    return window.__CANVAS_SCAN__.startExplanation({ sessionId: session.sessionId, findingIndex }).reason === 'canvas-unavailable';
  }, absentSource);
  await page.close();
} catch (error) { failures.push(error instanceof Error ? error.message : String(error));
} finally {
  try { await browser?.close(); } catch (error) { failures.push(String(error)); }
  try { await stopServer(); } catch (error) { failures.push(String(error)); }
}

const pass = failures.length === 0 && Object.values(checks).every(Boolean);
if (!pass && failures.length === 0) failures.push(`failed checks: ${Object.entries(checks).filter(([, value]) => !value).map(([key]) => key).join(', ')}`);
const result = { schemaVersion: 1, probeVersion: 1, status: pass ? 'PASS' : 'FAIL', browserVersion, gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(), dirty: execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim().length > 0, bundleSha256, checks, explanations, failures, environmentErrors: failures.filter(failure => /Chrome|server|EADDRINUSE|ECONNREFUSED/i.test(failure)) };
await writeFile('/private/tmp/sidproj-63-explanation-probe.json', `${JSON.stringify(result, null, 2)}\n`);
if (pass) console.log('SIDPROJ_63_EXPLANATION_STATE: PASS');
else console.error(`SIDPROJ_63_EXPLANATION_STATE: FAIL ${failures.join('; ')}`);
process.exitCode = pass ? 0 : 1;
