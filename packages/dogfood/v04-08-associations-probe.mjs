import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 5198; const url = `http://127.0.0.1:${port}`; let server; let browser; const failures = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const rangeOverlap = (entry, episode) => entry.startedAtTimestampMs <= episode.endedAtTimestampMs && episode.startedAtTimestampMs <= entry.endedAtTimestampMs;
const jsonOnly = value => value === null || ['string', 'number', 'boolean'].includes(typeof value) || Array.isArray(value) && value.every(jsonOnly) || Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(jsonOnly);
const forbiddenKeys = new Set(['value', 'textContent', 'innerText', 'id', 'className', 'attributes', 'parentElement', 'parentNode', 'clientX', 'clientY', 'pointerId', 'buttons', 'key', 'code', 'ctrlKey', 'target']);
function hasForbiddenKey(value) { return Array.isArray(value) ? value.some(hasForbiddenKey) : value && typeof value === 'object' ? Object.entries(value).some(([key, child]) => forbiddenKeys.has(key) || hasForbiddenKey(child)) : false; }
async function stop() { if (!server?.pid) return; try { process.kill(-server.pid, 'SIGTERM'); } catch {} await Promise.race([once(server, 'exit'), wait(5000)]); }
async function ready() { for (let end = Date.now() + 60000; Date.now() < end; await wait(250)) try { if ((await fetch(url)).ok) return; } catch {} throw new Error('server did not start'); }
function check(condition, name, checks) { checks[name] = Boolean(condition); if (!condition) failures.push(`failed check: ${name}`); }

let supported; let unsupported; let browserVersion; let bundleHash;
try {
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'run', 'build'], { cwd: root, stdio: 'inherit' });
  const bundle = path.join(root, 'packages/core/dist/canvas-scan.iife.js'); await copyFile(bundle, path.join(root, 'apps/workbench/public/canvas-scan.iife.js')); bundleHash = createHash('sha256').update(await readFile(bundle)).digest('hex');
  server = spawn('pnpm', ['--filter', 'workbench', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, detached: true, stdio: 'inherit' }); await ready();
  browser = await chromium.launch({ channel: 'chrome', headless: true }); browserVersion = browser.version();
  const run = async disabled => {
    const context = await browser.newContext(); const consoleWarnings = []; const consoleErrors = []; const pageErrors = [];
    if (disabled) await context.addInitScript(() => {
      const NativeObserver = window.PerformanceObserver;
      class DisabledObserver extends NativeObserver { static get supportedEntryTypes() { return NativeObserver.supportedEntryTypes.filter(type => type !== 'event' && type !== 'long-animation-frame'); } }
      Object.defineProperty(window, 'PerformanceObserver', { configurable: true, value: DisabledObserver });
    });
    const page = await context.newPage(); page.on('console', message => { if (message.type() === 'warning') consoleWarnings.push(message.text()); if (message.type() === 'error') consoleErrors.push(message.text()); }); page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`${url}/v04-08-associations.html`, { waitUntil: 'load' });
    const api = await page.evaluate(async () => { window.__CANVAS_SCAN__.startRecording(); window.__CANVAS_SCAN__.mark('  nearby   mark  '); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return typeof window.__CANVAS_SCAN__.mark === 'function'; });
    await page.locator('#burst').click(); await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)));
    const result = await page.evaluate(() => window.__CANVAS_SCAN__.stopRecording()); await context.close(); return { api, result, consoleWarnings, consoleErrors, pageErrors };
  };
  supported = await run(false); unsupported = await run(true);
  const checks = {};
  const entries = supported.result?.browserEntries ?? []; const associations = supported.result?.episodeAssociations ?? [];
  const mark = entries.find(entry => entry.kind === 'user-mark'); const pointer = entries.find(entry => entry.kind === 'document-event' && entry.eventType === 'pointerdown'); const timing = entries.find(entry => entry.kind === 'event-timing'); const loaf = entries.find(entry => entry.kind === 'long-animation-frame');
  const pointerAssociations = pointer ? associations.filter(item => item.entryId === pointer.entryId) : []; const loafAssociations = loaf ? associations.filter(item => item.entryId === loaf.entryId) : [];
  check(supported.api && unsupported.api, 'markApi', checks);
  check(supported.result?.browserFeatures.eventTiming === true && supported.result?.browserFeatures.longAnimationFrames === true, 'supportedFeatures', checks);
  check(unsupported.result?.browserFeatures.eventTiming === false && unsupported.result?.browserFeatures.longAnimationFrames === false, 'disabledFeatures', checks);
  check(mark?.label === 'nearby mark' && entries.filter(entry => entry.kind === 'user-mark').length === 1 && !associations.some(item => item.entryId === mark?.entryId), 'nearbyMarkUnassociated', checks);
  check(Boolean(pointer) && pointerAssociations.length > 0 && pointerAssociations.every(item => { const episode = supported.result.episodes.find(candidate => candidate.episodeId === item.episodeId); return episode && rangeOverlap(pointer, episode) && item.startedAtTimestampMs === Math.max(pointer.startedAtTimestampMs, episode.startedAtTimestampMs) && item.endedAtTimestampMs === Math.min(pointer.endedAtTimestampMs, episode.endedAtTimestampMs); }), 'pointerRangeOverlap', checks);
  check(Boolean(timing) && ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'keydown', 'keyup', 'wheel', 'input', 'change'].includes(timing.eventType) && Number.isFinite(timing.durationMs) && (timing.interactionId === null || Number.isFinite(timing.interactionId)) && typeof timing.targetTagName === 'string' && [...timing.targetTagName].length <= 80, 'eventTimingFields', checks);
  check(Boolean(loaf) && Number.isFinite(loaf?.durationMs) && Number.isFinite(loaf?.blockingDurationMs) && loaf.scripts.length <= 20 && loaf.scripts.every(script => Object.values(script).every(value => value === null || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 200) && !/[?#]/.test(script.sourceURL ?? '')), 'longAnimationFrameBounded', checks);
  check(Boolean(loaf) && loaf.scripts.every(script => !/[#\[]/.test(script.invoker ?? '') && !/(?:^|[.])burst(?:[.]|$)/i.test(script.invoker ?? '')), 'longAnimationFrameInvokerPrivacy', checks);
  check(Boolean(loaf) && loafAssociations.length > 0 && loafAssociations.every(item => { const episode = supported.result.episodes.find(candidate => candidate.episodeId === item.episodeId); return episode && rangeOverlap(loaf, episode) && item.startedAtTimestampMs === Math.max(loaf.startedAtTimestampMs, episode.startedAtTimestampMs) && item.endedAtTimestampMs === Math.min(loaf.endedAtTimestampMs, episode.endedAtTimestampMs); }), 'longAnimationFrameOverlapOnly', checks);
  check(unsupported.result?.browserEntries?.some(entry => entry.kind === 'document-event' && entry.eventType === 'pointerdown'), 'disabledDocumentCapture', checks);
  check(jsonOnly(supported.result) && jsonOnly(unsupported.result) && !hasForbiddenKey(supported.result) && !hasForbiddenKey(unsupported.result), 'privacyAndJson', checks);
  check(supported.consoleWarnings.length === 0 && supported.consoleErrors.length === 0 && supported.pageErrors.length === 0 && unsupported.consoleWarnings.length === 0 && unsupported.consoleErrors.length === 0 && unsupported.pageErrors.length === 0, 'browserDiagnostics', checks);
  await writeFile('/private/tmp/sidproj-53-episode-associations.json', `${JSON.stringify(associations, null, 2)}\n`); await writeFile('/private/tmp/sidproj-53-chrome-loaf.json', `${JSON.stringify(loaf ?? null, null, 2)}\n`);
  supported.checks = checks; unsupported.checks = checks;
} catch (error) { failures.push(error instanceof Error ? error.message : String(error)); } finally { await browser?.close(); await stop(); }
await writeFile('/private/tmp/sidproj-53-supported-session.json', `${JSON.stringify(supported?.result ?? null, null, 2)}\n`); await writeFile('/private/tmp/sidproj-53-unsupported-session.json', `${JSON.stringify(unsupported?.result ?? null, null, 2)}\n`); await writeFile('/private/tmp/sidproj-53-associations-probe.json', `${JSON.stringify({ status: failures.length ? 'FAIL' : 'PASS', browserVersion, bundleHash, failures, checks: supported?.checks ?? {}, diagnostics: { supported: { consoleWarnings: supported?.consoleWarnings ?? [], consoleErrors: supported?.consoleErrors ?? [], pageErrors: supported?.pageErrors ?? [] }, unsupported: { consoleWarnings: unsupported?.consoleWarnings ?? [], consoleErrors: unsupported?.consoleErrors ?? [], pageErrors: unsupported?.pageErrors ?? [] } } }, null, 2)}\n`);
if (failures.length) { console.error(`CANVAS_ASSOCIATIONS_V04_08: FAIL ${failures.join('; ')}`); process.exitCode = 1; } else console.log('CANVAS_ASSOCIATIONS_V04_08: PASS');
