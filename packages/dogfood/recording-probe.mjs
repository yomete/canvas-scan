import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const port = 5187;
const url = `http://127.0.0.1:${port}`;
let server;
let browser;
let browserVersion = null;
let failures = [];
const checks = {
  publicApi: false, manualStop: false, jsonRoundTrip: false, deepCopy: false,
  overlayHydration: false, maxDuration: false, secondSession: false, jsonOnly: false,
};
const sessions = { manual: null, maxDuration: null, second: null };

const waitForServer = async () => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (server.exitCode != null) throw new Error(`demo server exited with ${server.exitCode}`);
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('demo server did not start');
};

const stopServer = async () => {
  if (!server?.pid) return;
  const waitForExit = async timeout => {
    if (server.exitCode != null || server.signalCode != null) return;
    await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, timeout))]);
  };
  try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await waitForExit(5000);
  if (server.exitCode == null && server.signalCode == null) {
    try { process.kill(-server.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await waitForExit(5000);
  }
  if (server.exitCode == null && server.signalCode == null) throw new Error('demo server did not exit after cleanup signals');
};

try {
  server = spawn('pnpm', ['--filter', 'demo', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: repoRoot, stdio: 'inherit', detached: true,
  });
  await waitForServer();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  browserVersion = browser.version();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__CANVAS_SCAN__ != null, null, { timeout: 15000 });
  checks.publicApi = await page.evaluate(() => ['startRecording', 'stopRecording', 'getLastSession'].every(key => typeof window.__CANVAS_SCAN__[key] === 'function'));
  const draw = () => page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const context = canvas.getContext('2d');
    context.fillRect(0, 0, 10, 10);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.evaluate(() => window.__CANVAS_SCAN__.startRecording());
  await draw();
  sessions.manual = await page.evaluate(() => window.__CANVAS_SCAN__.stopRecording());
  checks.manualStop = sessions.manual?.stopReason === 'manual' && sessions.manual.windows.length > 0 &&
    sessions.manual.windows.every((window, index, windows) => Number.isFinite(window.windowIndex) && Number.isFinite(window.timestampMs) && (index === 0 || window.windowIndex >= windows[index - 1].windowIndex) && window.timestampMs >= windows[Math.max(0, index - 1)].timestampMs) &&
    sessions.manual.windows.every(window => sessions.manual.canvases.some(canvas => canvas.canvasId === window.canvasId)) &&
    sessions.manual.collectionLimits.maxDurationMs === 30000 && sessions.manual.collectionLimits.maxCanvasWindowReports === 10000 && sessions.manual.collectionLimits.maxCanvasLifetimes === 128;
  checks.jsonRoundTrip = await page.evaluate(() => {
    const session = window.__CANVAS_SCAN__.getLastSession();
    return JSON.stringify(session) === JSON.stringify(JSON.parse(JSON.stringify(session)));
  });
  checks.deepCopy = await page.evaluate(() => {
    const first = window.__CANVAS_SCAN__.getLastSession();
    first.windows[0].canvasId = 'changed';
    return window.__CANVAS_SCAN__.getLastSession().windows[0].canvasId !== 'changed';
  });
  checks.jsonOnly = await page.evaluate(() => {
    const check = value => value === null || ['string', 'number', 'boolean'].includes(typeof value) ||
      (Array.isArray(value) && value.every(check)) ||
      (Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(check));
    return check(window.__CANVAS_SCAN__.getLastSession());
  });
  await page.evaluate(() => window.__CANVAS_SCAN__.startRecording());
  await page.evaluate(() => document.body.replaceChildren());
  await page.waitForFunction(() => document.querySelector('[data-canvas-scan]')?.shadowRoot?.querySelector('.stop-recording:not(:disabled)') != null, null, { timeout: 5000 });
  checks.overlayHydration = true;
  sessions.maxDuration = await page.evaluate(() => new Promise(resolve => {
    const poll = () => { const session = window.__CANVAS_SCAN__.getLastSession(); if (session) resolve(session); else setTimeout(poll, 50); };
    poll();
  }));
  checks.maxDuration = sessions.maxDuration?.stopReason === 'max-duration' && sessions.maxDuration.durationMs >= 30000;
  await page.evaluate(() => window.__CANVAS_SCAN__.startRecording());
  await draw();
  sessions.second = await page.evaluate(() => window.__CANVAS_SCAN__.stopRecording());
  checks.secondSession = sessions.second?.sessionId !== sessions.maxDuration?.sessionId && sessions.second?.stopReason === 'manual' &&
    sessions.second?.windows.every(window => !sessions.maxDuration.windows.some(previous => previous.windowIndex === window.windowIndex && previous.timestampMs === window.timestampMs && previous.canvasId === window.canvasId));
  await page.close();
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  try { await browser?.close(); } catch (error) { failures.push(String(error)); }
  try { await stopServer(); } catch (error) { failures.push(String(error)); }
}

const pass = failures.length === 0 && Object.values(checks).every(Boolean);
if (!pass && failures.length === 0) failures.push(`failed checks: ${Object.entries(checks).filter(([, value]) => !value).map(([key]) => key).join(', ')}`);
const result = { probeVersion: 1, status: pass ? 'PASS' : 'FAIL', browserVersion, gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(), checks, sessions, failures };
await writeFile('/private/tmp/sidproj-47-recording-probe.json', `${JSON.stringify(result, null, 2)}\n`);
if (pass) console.log('CANVAS_RECORDING_V04_02: PASS');
else console.error(`CANVAS_RECORDING_V04_02: FAIL ${failures.join('; ')}`);
process.exitCode = pass ? 0 : 1;
