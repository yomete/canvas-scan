import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXCALIDRAW_REVISION, checkDirectory, createEvidence } from './excalidraw-v05-truth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 4385;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hashFile = file => sha256(readFileSync(file));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const plain = value => JSON.parse(JSON.stringify(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const listenerPids = () => { try { return execFileSync('lsof', ['-nP', `-iTCP@127.0.0.1:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch (error) { if (error.status === 1) return []; throw error; } };
const run = (bin, args, cwd) => execFileSync(bin, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const environmentError = error => /ENOTFOUND|EAI_AGAIN|ECONN|ETIMEDOUT|EADDRINUSE|browserType\.launch|Executable doesn't exist|yarn.*(?:cache|EACCES|EPERM)|server did not/i.test(String(error));
function write(directory, file, value) { writeFileSync(path.join(directory, file), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }); }
function startServer(repo) { return spawn('yarn', ['--cwd', 'excalidraw-app', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: repo, stdio: 'ignore', detached: true }); }
async function waitForServer(server) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode != null) throw new Error(`server stopped with exit ${server.exitCode}`);
    try { const response = await fetch(`http://127.0.0.1:${port}`); if (response.ok) return; } catch {}
    await sleep(250);
  }
  throw new Error('ENVIRONMENT_FAILURE: server did not answer before timeout');
}
async function stopServer(server) {
  if (!server) return;
  if (server.exitCode == null) { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
  for (let index = 0; index < 40 && listenerPids().length; index += 1) await sleep(100);
  if (listenerPids().length) { try { process.kill(-server.pid, 'SIGKILL'); } catch {} }
  for (let index = 0; index < 20 && listenerPids().length; index += 1) await sleep(100);
  if (listenerPids().length) throw new Error('owned server did not stop');
}
async function drag(page, x1, y1, x2, y2) { await page.mouse.move(x1, y1); await page.mouse.down(); for (let step = 1; step <= 10; step += 1) { await page.mouse.move(x1 + (x2 - x1) * step / 10, y1 + (y2 - y1) * step / 10); await sleep(30); } await page.mouse.up(); }
async function interaction(page, label) {
  await page.locator('canvas.excalidraw__canvas.static').waitFor({ timeout: 30_000 });
  await page.evaluate(() => window.__CANVAS_SCAN__.startRecording());
  await page.keyboard.press('r'); await drag(page, 400, 300, 550, 400); await sleep(400);
  await page.keyboard.press('r'); await drag(page, 600, 350, 750, 480); await sleep(400);
  await page.keyboard.press('h'); await drag(page, 500, 400, 320, 280); await sleep(600);
  const session = plain(await page.evaluate(() => window.__CANVAS_SCAN__.stopRecording()));
  const findingIndex = session.findings.findIndex(finding => finding.type === 'repeated-draw-work' && session.canvases.find(canvas => canvas.canvasId === finding.canvasId)?.nearestReactOwner === 'StaticCanvas');
  if (findingIndex < 0) throw new Error(`PRODUCT_FAILURE: ${label} did not contain an explicit StaticCanvas repeated-draw-work finding`);
  return { session, findingIndex };
}
function patchCheckout(repo, iife) {
  const packageJson = path.join(repo, 'package.json');
  writeFileSync(packageJson, readFileSync(packageJson, 'utf8').replace(/\s*"examples\/\*",?\n/g, '\n'));
  const publicDirectory = path.join(repo, 'excalidraw-app', 'public'); mkdirSync(publicDirectory, { recursive: true }); cpSync(iife, path.join(publicDirectory, 'canvas-scan.iife.js'), { dereference: false });
  const index = path.join(repo, 'excalidraw-app', 'index.html'); const html = readFileSync(index, 'utf8');
  if (!html.includes('/canvas-scan.iife.js')) writeFileSync(index, html.replace('<head>', '<head><script src="/canvas-scan.iife.js"></script><script>window.__SIDPROJ_70_EARLY__={scanLoaded:!!window.__CANVAS_SCAN__}</script>'));
}
async function main() {
  const evidenceDirectory = process.argv[2] ?? `/private/tmp/sidproj-70-excalidraw-evidence-${Date.now()}-${process.pid}`;
  if (!path.isAbsolute(evidenceDirectory) || path.resolve(evidenceDirectory) !== evidenceDirectory || existsSync(evidenceDirectory)) throw new Error('evidence directory must be a new absolute path');
  if (listenerPids().length) throw new Error('ENVIRONMENT_FAILURE: port 4385 already has a listener');
  const disposable = `/private/tmp/sidproj-70-excalidraw-${Date.now()}-${process.pid}`; mkdirSync(disposable, { recursive: false }); mkdirSync(evidenceDirectory, { recursive: false });
  const repo = path.join(disposable, 'repo'); const iife = path.join(root, 'packages/core/dist/canvas-scan.iife.js'); let browser; let server;
  const diagnostics = { warnings: 0, consoleErrors: 0, pageErrors: 0, failedRequests: 0, serverErrors: 0 };
  try {
    run('git', ['clone', '--no-checkout', 'https://github.com/excalidraw/excalidraw.git', repo], disposable);
    run('git', ['-C', repo, 'fetch', '--depth', '1', 'origin', EXCALIDRAW_REVISION], disposable);
    run('git', ['-C', repo, 'checkout', '--detach', EXCALIDRAW_REVISION], disposable);
    if (run('git', ['-C', repo, 'rev-parse', 'HEAD'], disposable) !== EXCALIDRAW_REVISION) throw new Error('PRODUCT_FAILURE: disposable checkout revision changed');
    if (!existsSync(iife) || lstatSync(iife).isSymbolicLink()) throw new Error('PRODUCT_FAILURE: frozen production IIFE is missing');
    patchCheckout(repo, iife); run('yarn', ['install', '--frozen-lockfile', '--ignore-scripts', '--network-timeout', '600000'], repo);
    server = startServer(repo); await waitForServer(server);
    if (!listenerPids().length) throw new Error('ENVIRONMENT_FAILURE: Excalidraw listener is missing');
    browser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    page.on('console', message => { if (message.type() === 'warning') diagnostics.warnings += 1; if (message.type() === 'error') diagnostics.consoleErrors += 1; });
    page.on('pageerror', () => { diagnostics.pageErrors += 1; }); page.on('requestfailed', () => { diagnostics.failedRequests += 1; });
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'load', timeout: 120_000 }); await page.waitForFunction(() => window.__CANVAS_SCAN__ != null, null, { timeout: 30_000 });
    const instrumentation = plain(await page.evaluate(() => window.__SIDPROJ_70_EARLY__));
    const baseline = await interaction(page, 'baseline');
    const start = plain(await page.evaluate(({ sessionId, findingIndex }) => window.__CANVAS_SCAN__.startExplanation({ sessionId, findingIndex }), { sessionId: baseline.session.sessionId, findingIndex: baseline.findingIndex }));
    if (start?.status !== 'started') throw new Error('PRODUCT_FAILURE: explanation did not start');
    await page.keyboard.press('h'); await drag(page, 500, 400, 320, 280); await sleep(500);
    const explanation = plain(await page.evaluate(() => window.__CANVAS_SCAN__.stopExplanation()));
    const candidate = await interaction(page, 'candidate');
    const comparison = plain(await page.evaluate(({ baseline, candidate, pairing }) => window.__CANVAS_SCAN__.compareSessions(baseline, candidate, pairing), { baseline: baseline.session, candidate: candidate.session, pairing: { baselineFindingIndex: baseline.findingIndex, candidateFindingIndex: candidate.findingIndex } }));
    writeFileSync(path.join(evidenceDirectory, 'screenshot.png'), await page.screenshot(), { flag: 'wx' });
    write(evidenceDirectory, 'baseline.json', baseline.session); write(evidenceDirectory, 'candidate.json', candidate.session); write(evidenceDirectory, 'explanation.json', explanation); write(evidenceDirectory, 'comparison.json', comparison); write(evidenceDirectory, 'diagnostics.json', diagnostics);
    const identity = { gitSha: git(['rev-parse', 'HEAD']), iifeSha256: hashFile(iife), packageSha256: hashFile(path.join(root, 'packages/core/package.json')), harnessSha256: hashFile(fileURLToPath(import.meta.url)), chromeRevision: browser.version(), v04ReferenceSha256: hashFile(path.join(root, 'packages/dogfood/results/2026-08-07-excalidraw-v04-post-release.json')) };
    const evidence = createEvidence({ baseline: baseline.session, baselineFindingIndex: baseline.findingIndex, candidate: candidate.session, candidateFindingIndex: candidate.findingIndex, explanation, comparison, diagnostics, instrumentation, identity });
    write(evidenceDirectory, 'evidence.json', evidence);
    const files = ['baseline.json', 'candidate.json', 'comparison.json', 'diagnostics.json', 'evidence.json', 'explanation.json', 'screenshot.png'];
    writeFileSync(path.join(evidenceDirectory, 'manifest-sha256.txt'), `${files.map(file => `${hashFile(path.join(evidenceDirectory, file))}  ${file}`).join('\n')}\n`, { flag: 'wx' });
    checkDirectory(evidenceDirectory); console.log(evidenceDirectory);
  } catch (error) { const prefix = environmentError(error) ? 'ENVIRONMENT_FAILURE' : 'PRODUCT_FAILURE'; console.error(`${prefix}: ${error instanceof Error ? error.stack : error}`); process.exitCode = 1; }
  finally { await browser?.close(); await stopServer(server); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
