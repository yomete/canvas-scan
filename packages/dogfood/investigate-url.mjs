// Run one guided canvas-scan investigation against a URL.
//
// Opens Chrome on an explicit http(s) URL with canvas-scan installed before
// any application script, leaves the browser open for you to drive the overlay
// — record, explain, keep a baseline, record a candidate, compare — and writes
// everything you produced, plus a report of what it observed, to a directory it
// names on exit.
//
// It is not a profiler. It measures no GPU time, diagnoses no CPU, sends
// nothing anywhere, and touches no browser profile of yours.
//
// Usage:
//   node investigate-url.mjs --url=https://example.com [--out=DIR] [--tag=NAME] [--timeout=MINUTES]
//                             [--handoff=json|jsonl|both|none] [--block-external]
//
// --tag names the build or run, for example --tag=baseline and --tag=candidate.
// It goes into every file name the run writes, so two tagged runs can share one
// --out directory. A run never replaces an earlier one: when the directory
// already holds a report under the same name, the run moves to DIR-2, DIR-3, ….
//   node investigate-url.mjs --url=... --drive=./path/to/module.mjs   (unattended)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { buildHandoff, toJson, toJsonl } from './agent-handoff.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const iife = path.join(root, 'packages/core/dist/canvas-scan.iife.js');

export class UsageError extends Error {}

// A wrong target is worth refusing loudly. file: and data: cannot carry the
// application this tool exists to investigate, and two targets mean the caller
// does not yet know which one they meant.
export function parseArguments(argv) {
  const options = {};
  const positional = [];
  for (const argument of argv) {
    if (!argument.startsWith('--')) { positional.push(argument); continue; }
    const index = argument.indexOf('=');
    const name = index === -1 ? argument.slice(2) : argument.slice(2, index);
    const value = index === -1 ? true : argument.slice(index + 1);
    if (name in options) throw new UsageError(`--${name} was given more than once. Pass exactly one target.`);
    options[name] = value;
  }
  if (positional.length) throw new UsageError(`unexpected argument ${JSON.stringify(positional[0])}. Pass the target as --url=https://example.com`);
  if (typeof options.url !== 'string' || options.url.length === 0) throw new UsageError('--url=https://example.com is required.');
  let url;
  try { url = new URL(options.url); }
  catch { throw new UsageError(`--url is not a URL: ${options.url}`); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UsageError(`--url must be http or https, not ${url.protocol.replace(':', '')}. A local file cannot host the application this investigates.`);
  const handoff = options.handoff === undefined ? 'both' : options.handoff;
  if (!['json', 'jsonl', 'both', 'none'].includes(handoff)) throw new UsageError(`--handoff must be json, jsonl, both or none, not ${handoff}`);
  if (options.tag !== undefined && (typeof options.tag !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(options.tag))) throw new UsageError(`--tag must be 1 to 64 letters, digits, dots, dashes or underscores, starting with a letter or digit, not ${options.tag}`);
  const timeoutMinutes = options.timeout === undefined ? 60 : Number(options.timeout);
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) throw new UsageError(`--timeout must be a positive number of minutes, not ${options.timeout}`);
  return {
    url: url.href,
    origin: url.origin,
    out: typeof options.out === 'string' ? options.out : null,
    tag: typeof options.tag === 'string' ? options.tag : null,
    drive: typeof options.drive === 'string' ? options.drive : null,
    blockExternal: options['block-external'] === true || options['block-external'] === 'true',
    handoff,
    timeoutMs: timeoutMinutes * 60_000,
  };
}

// Runs after the bundle, still before any application script. It records where
// in the document's life the install happened, and keeps every artifact the
// overlay copies so the run report can hold them without asking the user for
// anything.
const OBSERVER = `
  window.__CANVAS_SCAN_RUN__ = {
    readyStateAtInstall: document.readyState,
    hadDocumentElement: !!document.documentElement,
    copied: [],
  };
  const clipboard = navigator.clipboard;
  if (clipboard && typeof clipboard.writeText === 'function') {
    const writeText = clipboard.writeText.bind(clipboard);
    clipboard.writeText = text => {
      try {
        const value = JSON.parse(text);
        if (value && typeof value === 'object' && typeof value.schemaVersion === 'number') {
          window.__CANVAS_SCAN_RUN__.copied.push(value);
        }
      } catch { /* not an artifact; the overlay copies plain text too */ }
      return writeText(text);
    };
  }
`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stable = value => `${JSON.stringify(value, null, 2)}\n`;
const digest = value => createHash('sha256').update(value).digest('hex');

// Every name the run writes, with the tag in it when there is one. Two builds
// recorded into one directory under different tags keep both sets of files.
export function outputNames(tag) {
  const suffix = tag ? `-${tag}` : '';
  const prefix = tag ? `${tag}-` : '';
  return {
    report: `run-report${suffix}.json`,
    handoffJson: `handoff${suffix}.json`,
    handoffJsonl: `handoff${suffix}.jsonl`,
    artifact: (kind, index) => `artifacts/${prefix}${kind}-${index}.json`,
  };
}

// Where the run writes. Without --out it is a fresh directory named for the
// tag and the time. With --out it is that directory, unless a report under the
// same name is already there: then the first free DIR-2, DIR-3, … is used, so a
// repeated run keeps the baseline it would otherwise have replaced.
export function resolveOutDir({ out, tag }, { now = new Date(), exists = existsSync } = {}) {
  const names = outputNames(tag);
  if (!out) return path.join(root, `.investigation-${tag ? `${tag}-` : ''}${now.toISOString().replaceAll(/[:.]/g, '-')}`);
  const base = path.resolve(out);
  if (!exists(path.join(base, names.report))) return base;
  for (let attempt = 2; ; attempt++) {
    const candidate = `${base}-${attempt}`;
    if (!exists(path.join(candidate, names.report))) return candidate;
  }
}

function summarizeSession(session) {
  return {
    sessionId: session.sessionId,
    durationMs: session.durationMs,
    stopReason: session.stopReason,
    captureEvery: session.captureEvery,
    windowCount: session.windows.length,
    episodeCount: session.episodes.length,
    canvasCount: session.canvases.length,
    summaryOnlyCanvasCount: session.canvases.filter(canvas => canvas.windowDetailDropped).length,
    droppedEntryCounts: session.droppedEntryCounts,
    findings: session.findings.map((finding, index) => ({
      rank: index + 1,
      type: finding.type,
      canvasId: finding.canvasId,
      owner: session.canvases.find(canvas => canvas.canvasId === finding.canvasId)?.nearestReactOwner ?? null,
      canvasApiSelfTimeMs: finding.canvasApiSelfTimeMs,
      evidenceLevel: finding.evidenceLevel,
      nextCheck: finding.nextCheck,
    })),
  };
}

// One row per step of the ritual. A step is complete only when the artifact it
// produces is in hand: the report says what the run did, never what it meant to
// do. "not-observed" is not a failure — an investigation that stopped after a
// baseline is a real investigation.
function steps(sessions, explanations, comparisons) {
  return [
    { id: 'early-load', status: 'complete', detail: 'canvas-scan installed before the first application script' },
    { id: 'record-baseline', status: sessions.length >= 1 ? 'complete' : 'not-observed' },
    { id: 'explain-baseline', status: explanations.length >= 1 ? 'complete' : 'not-observed' },
    { id: 'record-candidate', status: sessions.length >= 2 ? 'complete' : 'not-observed' },
    { id: 'compare', status: comparisons.length >= 1 ? 'complete' : 'not-observed' },
  ];
}

export async function investigate(options, { log = console.log } = {}) {
  if (!existsSync(iife)) throw new UsageError(`build the bundle first: pnpm --filter canvas-scan run build (${iife})`);
  const names = outputNames(options.tag ?? null);
  const outDir = resolveOutDir({ out: options.out ?? null, tag: options.tag ?? null });
  mkdirSync(path.join(outDir, 'artifacts'), { recursive: true });

  // Playwright's Chrome runs from a directory made for this run alone, so the
  // browser you use every day keeps its profile, its extensions and its
  // sessions. Naming it in the report is the only way a reader can check that.
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'canvas-scan-profile-'));
  const browser = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: options.drive !== null,
    viewport: null,
    args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
  });
  await browser.addInitScript({ path: iife });
  await browser.addInitScript(OBSERVER);

  const pageErrors = [];
  const consoleFromCanvasScan = [];
  // The claim "no telemetry, no upload" has to be checked, not asserted. Every
  // request that leaves the target's own origin is recorded, and a body-bearing
  // one is called out by name.
  const offOriginRequests = [];
  // Every request, not only the suspicious ones. The classification contract in
  // network-silence.mjs needs the whole list to say a run made nothing else.
  const requests = [];
  const blockedExternalRequests = [];
  let droppedRequestRecords = 0;
  const MAX_RECORDED_REQUESTS = 20_000;
  // Listened for on the context, not per page. A persistent context already
  // has its first page when it launches, so a page-level listener would miss
  // every request that page makes — including the navigation itself.
  browser.on('request', request => {
    const record = { method: request.method(), url: request.url().slice(0, 500), resourceType: request.resourceType(), hasBody: request.postData() !== null };
    if (requests.length < MAX_RECORDED_REQUESTS) requests.push(record); else droppedRequestRecords++;
    const requestOrigin = (() => { try { return new URL(record.url).origin; } catch { return null; } })();
    if (requestOrigin !== options.origin) offOriginRequests.push(record);
  });
  const watchPage = page => {
    page.on('pageerror', error => pageErrors.push(String(error)));
    page.on('console', message => { if (message.text().includes('[canvas-scan]')) consoleFromCanvasScan.push({ type: message.type(), text: message.text() }); });
  };
  browser.pages().forEach(watchPage);
  browser.on('page', watchPage);

  const page = browser.pages()[0] ?? await browser.newPage();
  const report = {
    schemaVersion: 1,
    issue: 'SIDPROJ-108',
    target: options.url,
    tag: options.tag ?? null,
    outDir,
    startedAt: new Date().toISOString(),
    endedAt: null,
    browserVersion: browser.browser()?.version() ?? null,
    profile: { isolated: true, userDataDir },
    install: null,
    steps: [],
    artifacts: [],
    sessions: [],
    offOriginRequests: [],
    requests: [],
    droppedRequestRecords: 0,
    blockedExternalRequests: [],
    handoffPaths: { json: null, jsonl: null },
    handoffRecordCount: 0,
    pageErrors: [],
    consoleFromCanvasScan: [],
    notes: [],
  };

  const sessions = [];
  const explanations = [];
  const comparisons = [];
  let closed = false;
  browser.on('close', () => { closed = true; });
  page.on('close', () => { closed = true; });

  try {
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    report.install = await page.evaluate(() => ({
      readyStateAtInstall: window.__CANVAS_SCAN_RUN__?.readyStateAtInstall ?? null,
      hadDocumentElement: window.__CANVAS_SCAN_RUN__?.hadDocumentElement ?? null,
      installed: !!window.__CANVAS_SCAN__,
      version: window.__CANVAS_SCAN__?.version ?? null,
      overlayMounted: !!document.querySelector('[data-canvas-scan]'),
      getContextWrapped: !/native code/.test(HTMLCanvasElement.prototype.getContext.toString()),
    }));
    if (!report.install.installed) throw new Error('canvas-scan did not install on this page. Nothing further can be recorded.');

    // Cutting external access once the application has loaded turns "sends
    // nothing anywhere" from a claim into a condition the run has to survive.
    // If any part of the investigation needed the network, it fails here.
    if (options.blockExternal) {
      await browser.route('**', route => {
        const requestUrl = route.request().url();
        const sameOrigin = (() => { try { return new URL(requestUrl).origin === options.origin; } catch { return false; } })();
        if (sameOrigin) return route.continue();
        blockedExternalRequests.push({ method: route.request().method(), url: requestUrl.slice(0, 500) });
        return route.abort('blockedbyclient');
      });
    }

    // Only the latest session and explanation are readable from the page, so
    // the collector has to run alongside the investigation rather than after
    // it. A baseline read only at the end is a baseline already overwritten by
    // the candidate.
    const collect = async () => {
      try {
        const observed = await page.evaluate(() => ({
          session: window.__CANVAS_SCAN__?.getLastSession?.() ?? null,
          explanation: window.__CANVAS_SCAN__?.getLastExplanation?.() ?? null,
          copied: window.__CANVAS_SCAN_RUN__?.copied ?? [],
        }));
        if (observed.session && !sessions.some(item => item.sessionId === observed.session.sessionId)) sessions.push(observed.session);
        if (observed.explanation && !explanations.some(item => item.explanationId === observed.explanation.explanationId)) explanations.push(observed.explanation);
        for (const artifact of observed.copied) {
          if (artifact.comparisonId && !comparisons.some(item => item.comparisonId === artifact.comparisonId)) comparisons.push(artifact);
          if (artifact.explanationId && !explanations.some(item => item.explanationId === artifact.explanationId)) explanations.push(artifact);
        }
      } catch {
        // A navigation or a closing page makes evaluate throw. Neither is an
        // error in the run: keep what was collected and let the caller notice.
      }
    };

    let collecting = true;
    const collector = (async () => { while (collecting && !closed) { await collect(); await sleep(400); } })();

    const deadline = Date.now() + options.timeoutMs;
    if (options.drive) {
      const module = await import(path.isAbsolute(options.drive) ? options.drive : path.resolve(process.cwd(), options.drive));
      await module.default({ page, browser });
    } else {
      log(`\ncanvas-scan ${report.install.version} is installed on ${options.url}.`);
      log('Drive the overlay: Record, then Explain, Keep as baseline, Record again, Compare.');
      log('Close the browser window when you are done. Everything you produce is saved.\n');
      while (!closed && Date.now() < deadline) await sleep(500);
      if (!closed) report.notes.push(`the ${options.timeoutMs / 60_000}-minute timeout ended the run; anything recorded up to that point is below`);
    }
    collecting = false;
    await collector;
    await collect();
  } catch (error) {
    report.notes.push(`the run stopped early: ${String(error)}`);
  } finally {
    const write = (id, file, value) => {
      const contents = stable(value);
      writeFileSync(path.join(outDir, file), contents);
      report.artifacts.push({ id, path: file, sha256: digest(contents) });
    };
    for (const [index, session] of sessions.entries()) write(index === 0 ? 'baseline-session' : `session-${index + 1}`, names.artifact('session', index + 1), session);
    for (const [index, explanation] of explanations.entries()) write(`explanation-${index + 1}`, names.artifact('explanation', index + 1), explanation);
    for (const [index, comparison] of comparisons.entries()) write(`comparison-${index + 1}`, names.artifact('comparison', index + 1), comparison);

    report.endedAt = new Date().toISOString();
    report.steps = steps(sessions, explanations, comparisons);
    report.sessions = sessions.map(summarizeSession);
    report.offOriginRequests = offOriginRequests;
    report.requests = requests;
    report.droppedRequestRecords = droppedRequestRecords;
    report.blockedExternalRequests = blockedExternalRequests;
    report.pageErrors = pageErrors;
    report.consoleFromCanvasScan = consoleFromCanvasScan;
    if (offOriginRequests.some(request => request.hasBody)) report.notes.push('a request carrying a body left the target origin — check offOriginRequests before trusting this run');
    report.reportPath = path.join(outDir, names.report);
    writeFileSync(report.reportPath, stable(report));

    // The handoff is built from the same records the report is, and validated
    // before it is written. A handoff that would not survive its own reader is
    // not written at all.
    if (options.handoff !== 'none') {
      try {
        const records = buildHandoff(report, { sessions, explanations, comparisons });
        if (options.handoff === 'json' || options.handoff === 'both') { writeFileSync(path.join(outDir, names.handoffJson), toJson(records)); report.handoffPaths.json = path.join(outDir, names.handoffJson); }
        if (options.handoff === 'jsonl' || options.handoff === 'both') { writeFileSync(path.join(outDir, names.handoffJsonl), toJsonl(records)); report.handoffPaths.jsonl = path.join(outDir, names.handoffJsonl); }
        report.handoffRecordCount = records.length;
      } catch (error) {
        report.notes.push(`the agent handoff was not written: ${String(error)}`);
      }
      writeFileSync(report.reportPath, stable(report));
    }

    await browser.close().catch(() => {});
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
  log(`\nreport: ${report.reportPath}`);
  for (const file of Object.values(report.handoffPaths)) if (file) log(`handoff: ${file}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await investigate(parseArguments(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof UsageError) { console.error(`canvas-scan: ${error.message}`); process.exit(2); }
    throw error;
  }
}
