import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = 5197; const url = `http://127.0.0.1:${port}`; let server; let browser;
const failures = []; const consoleErrors = []; const consoleWarnings = []; const pageErrors = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stop() { if (!server?.pid) return; try { process.kill(-server.pid, 'SIGTERM'); } catch {} await Promise.race([once(server, 'exit'), wait(5000)]); }
async function ready() { for (let end = Date.now() + 60000; Date.now() < end; await wait(250)) { try { if ((await fetch(url)).ok) return; } catch {} } throw new Error('server did not start'); }
const inspect = session => {
  const events = session.lifecycleEvents ?? [];
  const byId = Object.groupBy(events, event => event.canvasId);
  return { events, byId, retired: Object.entries(byId).filter(([, value]) => value.some(event => event.type === 'retired')) };
};
let mainSession; let soakCreationSession; let soakCleanupSession; let mainFacts; let soakFacts; let mainCopyInvariant; let soakCopyInvariant; let browserVersion; let bundleHash; let viewport;
try {
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'run', 'build'], { cwd: root, stdio: 'inherit' });
  const bundle = path.join(root, 'packages/core/dist/canvas-scan.iife.js'); await copyFile(bundle, path.join(root, 'apps/workbench/public/canvas-scan.iife.js')); bundleHash = createHash('sha256').update(await readFile(bundle)).digest('hex');
  server = spawn('pnpm', ['--filter', 'workbench', 'exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, detached: true, stdio: 'inherit' }); await ready();
  browser = await chromium.launch({ channel: 'chrome', headless: true }); browserVersion = browser.version(); viewport = { width: 1280, height: 720 };
  for (const [suffix, set] of [['', value => { mainSession = value.session; mainFacts = value.facts; mainCopyInvariant = value.copyInvariant; }], ['?soak=1', value => { soakCreationSession = value.creationSession; soakCleanupSession = value.session; soakFacts = value.facts; soakCopyInvariant = value.copyInvariant; }]]) {
    const page = await browser.newPage({ viewport });
    page.on('console', item => { if (item.type() === 'error') consoleErrors.push(item.text()); if (item.type() === 'warning') consoleWarnings.push(item.text()); }); page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`${url}/v04-07-lifecycle.html${suffix}`, { waitUntil: 'load' }); await page.waitForFunction(() => window.__LIFECYCLE_V04_07_FIXTURE__?.done, null, { timeout: 180000 });
    const facts = await page.evaluate(() => window.__LIFECYCLE_V04_07_FIXTURE__);
    const stopped = await page.evaluate(() => {
      const session = window.__CANVAS_SCAN__.stopRecording();
      const originalType = session.lifecycleEvents[0]?.type;
      if (session.lifecycleEvents[0]) session.lifecycleEvents[0].type = 'retired';
      const stored = window.__CANVAS_SCAN__.getLastSession();
      return { session: stored, creationSession: window.__LIFECYCLE_V04_07_SOAK_CREATION_SESSION__, copyInvariant: stored.lifecycleEvents[0]?.type === originalType };
    });
    set({ facts, ...stopped }); await page.close();
  }
} catch (error) { failures.push(error instanceof Error ? error.message : String(error)); } finally { await browser?.close(); await stop(); }
const main = inspect(mainSession ?? {}); const soakCreation = inspect(soakCreationSession ?? {}); const soakCleanup = inspect(soakCleanupSession ?? {});
const eventEntry = prefix => Object.entries(main.byId).find(([canvasId]) => canvasId.startsWith(prefix));
const windowEntry = (canvasId, windowIndex) => mainSession?.windows.find(window => window.canvasId === canvasId && window.windowIndex === windowIndex);
const retiredCache = eventEntry('retired-cache#'); const retainedCache = eventEntry('retained-cache#'); const disconnected = eventEntry('disconnect-once#'); const destination = eventEntry('destination#');
const retiredCacheEvents = retiredCache?.[1] ?? []; const retainedCacheEvents = retainedCache?.[1] ?? []; const disconnectedEvents = disconnected?.[1] ?? [];
const retiredEvents = retiredCacheEvents.filter(event => event.type === 'retired'); const reactivatedEvents = retiredCacheEvents.filter(event => event.type === 'reactivated');
const firstRetirement = retiredEvents[0]; const firstReactivation = reactivatedEvents[0]; const resetReactivation = reactivatedEvents.at(-1);
const firstPostReactivation = retiredCache && firstReactivation ? windowEntry(retiredCache[0], firstReactivation.windowIndex) : undefined;
const unchangedRetiredSource = destination && firstRetirement && firstReactivation
  ? mainSession?.windows.find(window => window.canvasId === destination[0] && window.windowIndex > firstRetirement.windowIndex && window.windowIndex < firstReactivation.windowIndex)
  : undefined;
const changedRetiredSource = destination && firstReactivation ? windowEntry(destination[0], firstReactivation.windowIndex) : undefined;
const resetSource = retiredCache && resetReactivation ? windowEntry(retiredCache[0], resetReactivation.windowIndex) : undefined;
const resetDependent = destination && resetReactivation ? windowEntry(destination[0], resetReactivation.windowIndex) : undefined;
const creationMaximum = Math.max(0, ...soakCreation.events.map(event => event.activeRegistrySize));
const finalActive = soakCleanup.events.at(-1)?.activeRegistrySize ?? 0;
const checks = {
  mainDone: mainFacts?.done === true && mainFacts.frame >= 484,
  firstObservedConnection: retiredCacheEvents[0]?.type === 'first-observed' && retiredCacheEvents[0]?.connected === false,
  oneDetachTransition: disconnectedEvents[0]?.type === 'first-observed' && disconnectedEvents[0]?.connected === true && disconnectedEvents.filter(event => event.type === 'detached' && event.connected === false).length === 1,
  detachedCacheRemainsActive: retainedCacheEvents.some(event => event.type === 'active') && !retainedCacheEvents.some(event => event.type === 'retired'),
  exactRetirementAndIdentity: Boolean(retiredCache && firstRetirement && firstReactivation && firstReactivation.canvasId === firstRetirement.canvasId && firstReactivation.windowIndex > firstRetirement.windowIndex),
  sessionHistorySurvivesRetirement: retiredEvents.length === 2 && reactivatedEvents.length === 2 && mainCopyInvariant === true,
  noStaleSameAfterReactivation: firstPostReactivation?.signatureStatus === 'unknown' && firstPostReactivation?.unknownReason === 'first-window',
  retiredTrackedSourceToken: unchangedRetiredSource?.signatureStatus === 'changed' && unchangedRetiredSource?.unknownReason === null && unchangedRetiredSource.windowIndex > firstRetirement?.windowIndex && unchangedRetiredSource.windowIndex < firstReactivation?.windowIndex,
  changedTokenBeforeDependent: changedRetiredSource?.signatureStatus === 'changed' && changedRetiredSource?.unknownReason === null,
  resetTokenBeforeDependent: resetSource?.signatureStatus === 'unknown' && resetSource?.unknownReason === 'canvas-reset' && resetDependent?.signatureStatus === 'unknown' && resetDependent?.unknownReason === 'canvas-source-reset',
  measuredNotFinding: main.events.length > 0 && main.events.every(event => event.evidenceLevel === 'measured') && !(mainSession?.findings ?? []).some(finding => String(finding.type).includes('lifecycle')),
  soakDone: soakFacts?.done === true && soakFacts.frame === 840 && soakFacts.created === 2880,
  soakLifetimes: (soakCreationSession?.droppedEntryCounts?.canvasLifetimes ?? 0) > 0 && (soakCreationSession?.droppedEntryCounts?.lifecycleEvents ?? 0) > 0 && (soakCleanupSession?.droppedEntryCounts?.canvasLifetimes ?? 0) > 0,
  soakBound: creationMaximum === 480 && finalActive === 0 && soakCopyInvariant === true,
  errors: !consoleErrors.length && !consoleWarnings.length && !pageErrors.length,
  browserVersion: Boolean(browserVersion), bundleHash: Boolean(bundleHash),
};
if (!Object.values(checks).every(Boolean)) failures.push(`failed checks: ${Object.entries(checks).filter(([, value]) => !value).map(([key]) => key).join(', ')}`);
const result = { status: failures.length ? 'FAIL' : 'PASS', gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '', browserVersion, bundleHash, viewport, facts: mainFacts, checks, consoleErrors, consoleWarnings, pageErrors, failures };
const soakSummary = { facts: soakFacts, totalBoundaries: soakFacts?.frame ?? 0, creationMaximum, finalActive, creationDroppedEntryCounts: soakCreationSession?.droppedEntryCounts, cleanupDroppedEntryCounts: soakCleanupSession?.droppedEntryCounts, copyInvariant: soakCopyInvariant };
const registryCounts = { creationMaximum, finalActive, expectedMaximumAtCreationRate: 480, totalBoundaries: soakFacts?.frame ?? 0, creationDroppedEntryCounts: soakCreationSession?.droppedEntryCounts, cleanupDroppedEntryCounts: soakCleanupSession?.droppedEntryCounts, creationRetainedLifecycleEvents: soakCreation.events.map(event => ({ canvasId: event.canvasId, type: event.type, windowIndex: event.windowIndex, activeRegistrySize: event.activeRegistrySize })), cleanupRetainedLifecycleEvents: soakCleanup.events.map(event => ({ canvasId: event.canvasId, type: event.type, windowIndex: event.windowIndex, activeRegistrySize: event.activeRegistrySize })) };
await writeFile('/private/tmp/sidproj-52-lifecycle-session.json', `${JSON.stringify(mainSession ?? null, null, 2)}\n`); await writeFile('/private/tmp/sidproj-52-browser-result.json', `${JSON.stringify(result, null, 2)}\n`); await writeFile('/private/tmp/sidproj-52-soak-session.json', `${JSON.stringify({ creation: soakCreationSession ?? null, cleanup: soakCleanupSession ?? null }, null, 2)}\n`); await writeFile('/private/tmp/sidproj-52-soak-summary.json', `${JSON.stringify(soakSummary, null, 2)}\n`); await writeFile('/private/tmp/sidproj-52-registry-counts.json', `${JSON.stringify(registryCounts, null, 2)}\n`);
if (!failures.length) console.log('CANVAS_LIFECYCLE_V04_07: PASS'); else { console.error(`CANVAS_LIFECYCLE_V04_07: FAIL ${failures.join('; ')}`); process.exitCode = 1; }
