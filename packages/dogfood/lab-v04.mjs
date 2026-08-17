import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { applyMutation, checkMatrixCoverage, checkNearestNegatives, checkScenarioResult, checkVariantInvariance, expectedMatrixRows } from './lab-v04-truth.mjs';
import { checkBrowserContract } from './v04-heavy-negative-probe-check.mjs';
import { checkRunDirectory, checkRunIndex, createEvidenceRun, readCurrentArtifact, sha256, verifyReleaseManifest, writeFinalArtifact, writeRunIndex } from './v04-evidence-run.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baseUrl = 'http://127.0.0.1:5190';
const artifactNames = ['canvas-lab-v0.4.json', 'variant-matrix.json', 'nearest-negatives.json', 'console-summary.txt', 'integrated-continuous.png', 'integrated-burst.png', 'mutation-output.txt', 'idle-boundary.json', 'release-evidence.json', 'sha256.txt'];
const evidenceNames = artifactNames.slice(0, -1);
const normalNames = artifactNames.slice(0, 6);
const mutationName = 'mutation-output.txt';
const idleArtifactName = 'idle-boundary.json';
const releaseArtifactName = 'release-evidence.json';
const hashName = 'sha256.txt';
let activeRun;
const useEvidenceRun = run => { activeRun = run; return run; };
const requireRun = () => { if (!activeRun) throw new Error('run directory'); return activeRun; };
const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');
const manifestPath = path.join(root, 'packages/dogfood/v04-release-manifest.mjs');
const sessionDropKeys = ['canvasWindowReports', 'canvasLifetimes', 'resetEvents', 'lifecycleEvents', 'documentEvents', 'eventTiming', 'userMarks', 'longAnimationFrames'];
const collectionLimitValues = { maxDurationMs: 30000, maxCanvasWindowReports: 10000, maxCanvasLifetimes: 128, maxResetEvents: 10000, maxLifecycleEvents: 10000, maxBrowserEvidenceEntries: 2000, maxLongFrameScriptAttributions: 20 };
const missingHeavyFinding = 'heavy-burst:heavy-canvas-work: missing finding';
const wait = timeout => new Promise(resolve => setTimeout(resolve, timeout));

export function parseArgs(args) {
  if (args[0] === '--') {
    if (args.length === 1) throw new Error('unsupported lab arguments');
    args = args.slice(1);
  }
  if (!args.length) return { mode: 'idle-release' };
  if (args.length === 1 && args[0] === '--idle-release') return { mode: 'idle-release' };
  if (args.length === 2 && args[0] === '--check-evidence') return { mode: 'check', directory: args[1] };
  throw new Error('unsupported lab arguments');
}
export const orderedRuns = () => expectedMatrixRows();
export const collectDiagnostics = (value = {}) => ({
  warnings: [...(value.warnings ?? [])], consoleErrors: [...(value.consoleErrors ?? [])], pageErrors: [...(value.pageErrors ?? [])],
  requestFailures: [...(value.requestFailures ?? [])], instrumentationKills: [...(value.instrumentationKills ?? [])], unsupportedEvidence: [...(value.unsupportedEvidence ?? [])],
});
export function evaluateCapture(manifest, session = {}, fixture = {}, browser = {}) {
  const diagnostics = collectDiagnostics(browser.diagnostics);
  const checked = checkScenarioResult(manifest, {
    session,
    idleDrawCount: fixture.idleDrawCount,
    interactionStartedAt: fixture.interactionStartedAt,
    fixtureBoundaryCount: fixture.fixtureBoundaryCount,
    acceptedRunCount: fixture.acceptedRunCount,
  });
  const prohibited = Object.entries(diagnostics).filter(([, values]) => values.length).map(([name]) => name);
  const limits = session.droppedEntryCounts;
  const dropped = limits ? Object.entries(limits).filter(([, count]) => count !== 0).map(([name, count]) => `${name}:${count}`) : [];
  const failures = [...checked.failures, ...prohibited, ...dropped.map(item => `dropped evidence:${item}`)];
  if (manifest.scenario !== 'integrated-burst' && fixture.acceptedRunCount !== 1) failures.push(`fixture accepted run count must equal 1 (received ${fixture.acceptedRunCount ?? 0})`);
  return { pass: failures.length === 0, failures, diagnostics, expectationResults: checked.expectationResults };
}
export function buildLabResult({ runId, startedAt, endedAt, scenarios = [], browser = {}, product = {}, gitSha = null, dirty = null, diagnostics = {} }) {
  const matrixCoverage = checkMatrixCoverage(scenarios.length ? scenarios : orderedRuns());
  const collected = collectDiagnostics(diagnostics);
  const prohibited = Object.values(collected).some(values => values.length);
  return { schemaVersion: 1, lab: 'canvas-performance-lab-v0.4', runId, startedAt, endedAt, gitSha, dirty, browser, product, scenarios, matrixCoverage, diagnostics: collected, pass: scenarios.length === 53 && scenarios.every(row => row.pass) && matrixCoverage.pass && !prohibited };
}
export const buildMatrixArtifact = (runId, rows) => ({ schemaVersion: 1, lab: 'canvas-performance-lab-v0.4', runId, rows: rows.map(matrixRow) });
export const buildNearestNegativeArtifact = (runId, rows) => ({ schemaVersion: 1, lab: 'canvas-performance-lab-v0.4', runId, rows: rows.filter(row => row.mode === 'negative').map(negativeRow) });
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const failureOrder = ['manifest schema', 'trusted module set', 'trusted module order', 'trusted module digest', 'run directory', 'artifact identity', 'artifact set', 'artifact schema', 'browser scripts', 'browser options', 'bootstrap ready', 'calibration', 'runtime counts', 'artifact truth', 'unknown support', 'diagnostics', 'port'];
const orderedFailures = failures => [...new Set(failures)].sort((left, right) => failureOrder.indexOf(left) - failureOrder.indexOf(right));
const validUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const zeroSessionDrops = value => exactKeys(value, sessionDropKeys) && sessionDropKeys.every(key => Number.isInteger(value[key]) && value[key] === 0);
const validRunTimes = (startedAt, endedAt, now) => isIso(startedAt) && isIso(endedAt) && Date.parse(startedAt) < Date.parse(endedAt) && Date.parse(endedAt) - Date.parse(startedAt) <= 30 * 60 * 1000 && Date.parse(startedAt) <= now && Date.parse(endedAt) <= now && now - Date.parse(startedAt) < 24 * 60 * 60 * 1000 && now - Date.parse(endedAt) < 24 * 60 * 60 * 1000;
const idleRowManifest = index => index % 2 === 0
  ? { scenario: 'backing-store-mismatch', variant: 'variant-c', mode: 'bad', schedule: 'continuous' }
  : { scenario: 'heavy-burst', variant: 'variant-a', mode: 'fixed', schedule: 'interaction' };
export function checkIdleEvidence(value, truth, now = Date.now()) {
  value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  truth = truth && typeof truth === 'object' && !Array.isArray(truth) ? truth : {};
  const failures = [];
  if (!exactKeys(value, ['schemaVersion', 'runId', 'matrixRunId', 'startedAt', 'endedAt', 'chromeRevision', 'gitSha', 'bundleSha256', 'harnessSha256', 'counterexample', 'rows', 'diagnostics', 'port']) || value.schemaVersion !== 1) failures.push('artifact schema');
  if (!validUuid(value.runId) || !validUuid(value.matrixRunId) || value.runId === value.matrixRunId || !validRunTimes(value.startedAt, value.endedAt, now) || !isIso(truth.matrixStartedAt) || Date.parse(value.endedAt) > Date.parse(truth.matrixStartedAt)) failures.push('artifact schema');
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(value.chromeRevision ?? '') || !/^[0-9a-f]{40}$/.test(value.gitSha ?? '') || !/^[0-9a-f]{64}$/.test(value.bundleSha256 ?? '') || !/^[0-9a-f]{64}$/.test(value.harnessSha256 ?? '') || value.matrixRunId !== truth.matrixRunId || value.chromeRevision !== truth.chromeRevision || value.gitSha !== truth.gitSha || value.bundleSha256 !== truth.bundleSha256 || value.harnessSha256 !== truth.harnessSha256) failures.push('artifact identity');
  const counterexample = value.counterexample ?? {};
  if (!exactKeys(counterexample, ['scenario', 'variant', 'mode', 'pass', 'failures', 'droppedEntryCounts']) || counterexample.scenario !== 'backing-store-mismatch' || counterexample.variant !== 'variant-c' || counterexample.mode !== 'bad' || counterexample.pass !== false || !sameJson(counterexample.failures, ['idle capture contains draw activity']) || !zeroSessionDrops(counterexample.droppedEntryCounts)) failures.push('artifact truth');
  if (!Array.isArray(value.rows) || value.rows.length !== 20) failures.push('artifact truth');
  for (const [index, row] of (Array.isArray(value.rows) ? value.rows : []).entries()) {
    const expected = idleRowManifest(index);
    const manifest = orderedRuns().find(item => item.scenario === expected.scenario && item.variant === expected.variant && item.mode === expected.mode);
    const combined = { scenario: row.scenario, variant: row.variant, mode: row.mode, productResult: row.productResult, primitiveProof: row.primitiveProof };
    if (!exactKeys(row, ['iteration', 'scenario', 'variant', 'mode', 'schedule', 'productResult', 'primitiveProof', 'handshake']) || row.iteration !== index + 1 || row.scenario !== expected.scenario || row.variant !== expected.variant || row.mode !== expected.mode || row.schedule !== expected.schedule || !manifest || checkCombinedRow(combined, manifest).length) failures.push('artifact truth');
    const handshake = row.handshake;
    if (!exactKeys(handshake, ['probeOperations', 'beforeDrawCount', 'afterDrawCount', 'beforeAcceptedRunCount', 'afterAcceptedRunCount', 'afterInteractionStartedAt', 'drainWindowCount', 'drainRasterOperationCount']) || handshake.probeOperations !== IDLE_BOUNDARY_PROBE_OPERATIONS || handshake.beforeDrawCount !== 0 || handshake.afterDrawCount !== 0 || handshake.beforeAcceptedRunCount !== 0 || handshake.afterAcceptedRunCount !== 0 || handshake.afterInteractionStartedAt !== null || !boundedInteger(handshake.drainWindowCount, 1, 10000) || handshake.drainRasterOperationCount !== IDLE_BOUNDARY_PROBE_OPERATIONS) failures.push('artifact truth');
  }
  if (!exactKeys(value.diagnostics, ['warnings', 'consoleErrors', 'pageErrors', 'requestFailures', 'instrumentationKills', 'unsupportedEvidence']) || Object.values(value.diagnostics ?? {}).some(items => !Array.isArray(items) || items.length)) failures.push('diagnostics');
  if (!exactKeys(value.port, ['number', 'listenersAfter']) || value.port.number !== 5190 || !Array.isArray(value.port.listenersAfter) || value.port.listenersAfter.length) failures.push('port');
  return orderedFailures(failures);
}
export function safeArtifactPath(value) { if (!artifactNames.includes(value)) throw new Error('unexpected artifact path'); return file(value); }
export const hashEntries = async names => Promise.all(names.map(async name => `${sha256(await readCurrentArtifact(requireRun(), name))}  ${name}`));
export const idleReleaseArtifactPaths = () => [...evidenceNames];
export const closedArtifactPaths = () => [...artifactNames];
async function harnessSha256() {
  return sha256(await readFile(manifestPath));
}
function installedChromeRevision() {
  const output = execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--version'], { encoding: 'utf8' }).trim();
  const match = output.match(/(?:Google Chrome|Chromium) (\d+\.\d+\.\d+\.\d+)$/);
  if (!match) throw new Error('installed Chrome revision is unavailable');
  return match[1];
}
const gitHead = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const fileSha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex');

const writtenArtifacts = new Map();
async function writeArtifact(name, value) {
  safeArtifactPath(name);
  const item = await writeFinalArtifact(requireRun(), name, value);
  writtenArtifacts.set(name, item);
  return item;
}
export async function releaseRunFromDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('run directory');
  const match = /^\/private\/tmp\/sidproj-102-idle-release-([0-9a-f-]{36})$/.exec(directory);
  if (!match || !validUuid(match[1])) throw new Error('run directory');
  let stat;
  try { stat = await lstat(directory); } catch { throw new Error('run directory'); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) throw new Error('run directory');
  return { kind: 'idle-release', runId: match[1], directory, directoryIdentity: { device: String(stat.dev), inode: String(stat.ino) } };
}
const isIso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const rowKey = row => `${row.scenario}:${row.variant}:${row.mode}`;
export function parseExactJson(text) {
  if (typeof text !== 'string') throw new Error('invalid JSON text');
  let offset = 0;
  const whitespace = () => { while (/[\t\n\r ]/.test(text[offset] ?? '')) offset++; };
  const string = () => {
    if (text[offset] !== '"') throw new Error('invalid JSON string');
    const start = offset++;
    while (offset < text.length) {
      const character = text[offset++];
      if (character === '"') {
        let parsed;
        try { parsed = JSON.parse(text.slice(start, offset)); }
        catch { throw new Error('invalid JSON string'); }
        for (let index = 0; index < parsed.length; index++) {
          const code = parsed.charCodeAt(index);
          if (code >= 0xd800 && code <= 0xdbff) {
            const next = parsed.charCodeAt(++index);
            if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('invalid JSON Unicode escape');
          } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('invalid JSON Unicode escape');
        }
        return parsed;
      }
      if (character === '\\') offset++;
      else if (character.charCodeAt(0) < 0x20) throw new Error('invalid JSON string');
    }
    throw new Error('invalid JSON string');
  };
  const value = () => {
    whitespace();
    if (text[offset] === '{') {
      offset++; whitespace();
      const keys = new Set();
      if (text[offset] === '}') { offset++; return; }
      while (true) {
        const key = string();
        if (keys.has(key)) throw new Error(`duplicate JSON key: ${key}`);
        keys.add(key); whitespace();
        if (text[offset++] !== ':') throw new Error('invalid JSON object');
        value(); whitespace();
        const separator = text[offset++];
        if (separator === '}') return;
        if (separator !== ',') throw new Error('invalid JSON object');
        whitespace();
      }
    }
    if (text[offset] === '[') {
      offset++; whitespace();
      if (text[offset] === ']') { offset++; return; }
      while (true) {
        value(); whitespace();
        const separator = text[offset++];
        if (separator === ']') return;
        if (separator !== ',') throw new Error('invalid JSON array');
      }
    }
    if (text[offset] === '"') { string(); return; }
    for (const literal of ['true', 'false', 'null']) if (text.startsWith(literal, offset)) { offset += literal.length; return; }
    const number = text.slice(offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!number) throw new Error('invalid JSON value');
    offset += number[0].length;
  };
  value(); whitespace();
  if (offset !== text.length) throw new Error('invalid JSON suffix');
  return JSON.parse(text);
}
const json = async name => {
  const bytes = await readCurrentArtifact(requireRun(), name);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('artifact is too large');
  return parseExactJson(bytes.toString('utf8'));
};
function assert(condition, message) { if (!condition) throw new Error(message); }
const crc32 = bytes => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};
export function validPng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 58 || bytes.length > 8 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return false;
  let offset = 8; let state = 'ihdr'; const idat = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) return false;
    const length = bytes.readUInt32BE(offset); const type = bytes.subarray(offset + 4, offset + 8).toString('ascii'); const dataStart = offset + 8; const dataEnd = dataStart + length; const end = dataEnd + 4;
    if (end > bytes.length || crc32(bytes.subarray(offset + 4, dataEnd)) !== bytes.readUInt32BE(dataEnd)) return false;
    if (state === 'ihdr') {
      if (type !== 'IHDR' || length !== 13 || bytes.readUInt32BE(dataStart) !== 1440 || bytes.readUInt32BE(dataStart + 4) !== 1000 || !bytes.subarray(dataStart + 8, dataEnd).equals(Buffer.from([8, 2, 0, 0, 0]))) return false;
      state = 'idat';
    } else if (state === 'idat') {
      if (type === 'IDAT' && length > 0) idat.push(bytes.subarray(dataStart, dataEnd));
      else if (type === 'IEND' && length === 0 && idat.length && end === bytes.length) {
        try {
          const compressed = Buffer.concat(idat);
          const result = inflateSync(compressed, { info: true });
          const raw = result.buffer;
          if (result.engine.bytesWritten !== compressed.length) return false;
          if (raw.length !== (1440 * 3 + 1) * 1000) return false;
          for (let index = 0; index < raw.length; index += 1440 * 3 + 1) if (raw[index] > 4) return false;
          return true;
        } catch { return false; }
      } else return false;
    }
    offset = end;
  }
  return false;
}
function sameDeclaredRow(actual, expected, combined) {
  if (rowKey(actual) !== rowKey(expected)) return false;
  for (const key of ['behavior', 'application', 'factors', 'changedFactors', 'baseFactors', 'invariant']) if (!sameJson(actual[key], expected[key])) return false;
  return sameJson(actual.expectations, expectationResults(expected, combined));
}

const claimText = {
  'heavy-canvas-work': ['The canvas spent the measured Canvas2D API self-time in the named draw episode.', 'The episode contains concentrated synchronous Canvas2D API work and is a review candidate.', 'The evidence does not establish GPU time, presentation or render time, or avoidable work.', 'Check the top measured methods and the application code that calls them.'],
  'repeated-draw-work': ['The canvas sent repeated commands in the recorded windows and spent the measured Canvas2D API self-time shown here.', 'The repeated commands are a review candidate.', 'The evidence does not establish that the output stayed unchanged or that the work can be removed.', 'Check whether the application needs to send these repeated commands for the same scene and interaction.'],
  'resize-churn': ['canvas-scan observed the stated resets in windows with raster work.', 'Repeated resets overlapped active canvas work and are a review candidate.', 'The evidence does not show that resets made the application slow or that the application can remove them.', 'Check whether sizing or reset calls can run only when dimensions or state need to change.'],
  'backing-store-mismatch': ['The recorded backing area is larger than the DPR-adjusted expected area in the named active windows.', 'The recorded dimensions are a review candidate.', 'The evidence does not establish GPU cost, render cost, or the required image quality.', 'Check the canvas sizing policy and the required image quality.'],
};
const claimDigest = parts => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const expectedClaimDigests = Object.fromEntries(Object.entries(claimText).map(([type, parts]) => [type, claimDigest(parts)]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const integers = values => Array.isArray(values) && values.every(Number.isInteger);
const lowerHex64 = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const digestId = value => createHash('sha256').update(String(value)).digest('hex');
const normalizedTimes = values => {
  const origin = values.length ? Math.min(...values) : 0;
  return value => value - origin;
};
export const associationKinds = ['document-event', 'long-animation-frame'];
const lifecycleOrder = (left, right) => left.windowIndex - right.windowIndex || left.type.localeCompare(right.type) || left.canvasId.localeCompare(right.canvasId);

export function selectProductLifecycleEvents(canvases = [], lifecycleEvents = []) {
  const events = lifecycleEvents.filter(item => item?.evidenceLevel === 'measured');
  const unique = events.filter((item, index) => events.findIndex(other => other.type === item.type && other.canvasId === item.canvasId && other.windowIndex === item.windowIndex) === index);
  const primaryCanvasId = canvases[0]?.canvasId;
  const retired = unique.filter(item => item.canvasId === primaryCanvasId && item.type === 'retired');
  const reactivated = unique.filter(item => item.canvasId === primaryCanvasId && item.type === 'reactivated');
  const pairs = retired.flatMap(before => reactivated.filter(after => after.windowIndex > before.windowIndex).map(after => ({ before, after })));
  const latest = pairs.sort((left, right) => right.after.windowIndex - left.after.windowIndex || right.before.windowIndex - left.before.windowIndex)[0];
  const selected = latest ? [latest.before, latest.after] : retired.sort((left, right) => right.windowIndex - left.windowIndex)[0] ? [retired.sort((left, right) => right.windowIndex - left.windowIndex)[0]] : [];
  const detached = unique.filter(item => item.type === 'detached' && canvases.some(canvas => canvas.canvasId !== item.canvasId)).sort((left, right) => right.windowIndex - left.windowIndex || String(left.canvasId).localeCompare(String(right.canvasId)))[0];
  if (detached) selected.push(detached);
  return selected.sort(lifecycleOrder);
}

// These projectors deliberately take disjoint source sets. Keep this boundary so a
// checked product result cannot manufacture its own primitive support.
export function projectProductResult({ canvases = [], findings = [], lifecycleEvents = [], episodeAssociations = [] }) {
  const selectedAssociations = episodeAssociations.filter(item => associationKinds.includes(item.entryKind));
  const productFindings = findings.map(item => {
    const relatedEpisodeIds = item.type === 'heavy-canvas-work' || item.type === 'repeated-draw-work' ? [item.episodeId] : item.affectedEpisodeIds;
    const claim = [item.claimBoundary?.observation, item.claimBoundary?.explanation, item.claimBoundary?.nonEstablishedFacts, item.nextCheck];
    const metrics = item.type === 'heavy-canvas-work'
      ? { canvasApiSelfTimeMs: item.canvasApiSelfTimeMs, rasterOperationCount: item.rasterOperationCount, maximumWindowSelfTimeMs: item.maximumWindow?.canvasApiSelfTimeMs, topMethodCount: item.topMethods?.length ?? 0 }
      : item.type === 'repeated-draw-work'
        ? { repeatedWindowCount: item.repeatedWindowCount, rasterOperationCount: item.rasterOperationCount, repeatedWindowIndexes: (item.repeatedWindows ?? []).map((window, index) => window.windowIndex ?? index), repeatedWindowRasterOperationCounts: (item.repeatedWindows ?? []).map(window => window.rasterOperationCount) }
        : item.type === 'resize-churn'
          ? { activeResetCount: item.activeResetCount, resetEventWindowIndexes: (item.resetEvents ?? []).map(event => event.windowIndex) }
          : { affectedWindowCount: item.affectedWindowCount, affectedWindowIndexes: (item.affectedWindows ?? []).map((window, index) => window.windowIndex ?? index), areaRatios: (item.affectedWindows ?? []).map(window => window.actualToExpectedAreaRatio) };
    return { type: item.type, evidenceLevel: item.evidenceLevel, claimSha256: claimDigest(claim), canvasKey: digestId(item.canvasId), relatedEpisodeKeys: (relatedEpisodeIds ?? []).map(digestId).sort(), metrics };
  }).sort((left, right) => `${left.type}:${left.canvasKey}:${left.relatedEpisodeKeys[0]}`.localeCompare(`${right.type}:${right.canvasKey}:${right.relatedEpisodeKeys[0]}`));
  return {
    findings: productFindings,
    lifecycleEvents: selectProductLifecycleEvents(canvases, lifecycleEvents).map(event => ({ type: event.type, canvasKey: digestId(event.canvasId), windowIndex: event.windowIndex, connected: event.connected, activeRegistrySize: event.activeRegistrySize, evidenceLevel: 'measured' })).sort((left, right) => left.windowIndex - right.windowIndex || left.type.localeCompare(right.type) || left.canvasKey.localeCompare(right.canvasKey)),
    episodeAssociations: selectedAssociations.map(item => {
      const kindRows = selectedAssociations.filter(other => other.entryKind === item.entryKind);
      const normalize = normalizedTimes(kindRows.flatMap(other => [other.startedAtTimestampMs, other.endedAtTimestampMs]).filter(finite));
      return { entryKey: digestId(item.entryId), entryKind: item.entryKind, episodeKey: digestId(item.episodeId), startedAtTimestampMs: normalize(item.startedAtTimestampMs), endedAtTimestampMs: normalize(item.endedAtTimestampMs), evidenceLevel: 'associated' };
    }).sort((left, right) => left.startedAtTimestampMs - right.startedAtTimestampMs || left.endedAtTimestampMs - right.endedAtTimestampMs || left.entryKey.localeCompare(right.entryKey) || left.episodeKey.localeCompare(right.episodeKey)),
  };
}
export function projectPrimitiveProof({ windows = [], episodes = [], resetEvents = [], browserEntries = [], browserFeatures = {}, collectionLimits, droppedEntryCounts }, fixture, idle, diagnostics) {
  const selectedEntries = browserEntries.filter(item => associationKinds.includes(item.kind));
  const times = [fixture.interactionStartedAt, ...windows.flatMap(item => [item.startedAtTimestampMs, item.endedAtTimestampMs]), ...episodes.flatMap(item => [item.startedAtTimestampMs, item.endedAtTimestampMs]), ...selectedEntries.flatMap(item => [item.startedAtTimestampMs, item.endedAtTimestampMs])].filter(finite);
  const normalize = normalizedTimes(times);
  return {
    windows: windows.map(item => ({ canvasKey: digestId(item.canvasId), windowIndex: item.windowIndex, startedAtTimestampMs: normalize(item.startedAtTimestampMs), endedAtTimestampMs: normalize(item.endedAtTimestampMs), canvasApiSelfTimeMs: item.canvasApiSelfTimeMs, rasterOperationCount: item.rasterOperationCount, signatureStatus: item.signatureStatus, unknownReason: item.unknownReason, sampled: item.sampled, comparisonGap: item.comparisonGap, actualToExpectedAreaRatio: item.geometry?.actualToExpectedAreaRatio ?? null })).sort((left, right) => left.windowIndex - right.windowIndex || left.canvasKey.localeCompare(right.canvasKey)),
    episodes: episodes.map(item => ({ episodeKey: digestId(item.episodeId), firstWindowIndex: item.firstWindowIndex, lastWindowIndex: item.lastWindowIndex, startedAtTimestampMs: normalize(item.startedAtTimestampMs), endedAtTimestampMs: normalize(item.endedAtTimestampMs), canvases: item.canvases.map(canvas => ({ canvasKey: digestId(canvas.canvasId), canvasApiSelfTimeMs: canvas.canvasApiSelfTimeMs, rasterOperationCount: canvas.rasterOperationCount, methodCount: Object.keys(canvas.methodEvidence ?? {}).length })).sort((left, right) => left.canvasKey.localeCompare(right.canvasKey)) })).sort((left, right) => left.firstWindowIndex - right.firstWindowIndex || left.episodeKey.localeCompare(right.episodeKey)),
    resetEvents: resetEvents.map(item => ({ canvasKey: digestId(item.canvasId), windowIndex: item.windowIndex, source: item.source, rasterOperationCount: item.rasterOperationCount, activeRasterOverlap: item.activeRasterOverlap })).sort((left, right) => left.windowIndex - right.windowIndex || left.canvasKey.localeCompare(right.canvasKey)),
    browser: { longAnimationFrames: browserFeatures.longAnimationFrames, entries: selectedEntries.map(item => ({ entryKey: digestId(item.entryId), kind: item.kind, eventType: item.kind === 'document-event' ? item.eventType : null, startedAtTimestampMs: normalize(item.startedAtTimestampMs), endedAtTimestampMs: normalize(item.endedAtTimestampMs) })).sort((left, right) => left.startedAtTimestampMs - right.startedAtTimestampMs || left.endedAtTimestampMs - right.endedAtTimestampMs || left.entryKey.localeCompare(right.entryKey)) },
    fixture: { interactionStartedAtTimestampMs: normalize(fixture.interactionStartedAt), boundaryCount: fixture.boundaryCount, acceptedRunCount: fixture.acceptedRunCount, drawCount: fixture.drawCount, actions: [...fixture.actions], visibleChecksum: fixture.visibleChecksum, visibleImageHash: fixture.visibleImageHash },
    idle: { idleDrawCount: idle.drawCount, preInteractionWindowCount: windows.filter(item => item.endedAtTimestampMs < fixture.interactionStartedAt).length, preInteractionEpisodeCount: episodes.filter(item => item.endedAtTimestampMs < fixture.interactionStartedAt).length, drainWindowCount: idle.drainWindowCount, drainRasterOperationCount: idle.drainRasterOperationCount },
    collectionLimits: { ...collectionLimits }, droppedEntryCounts: { ...droppedEntryCounts }, diagnostics: structuredClone(diagnostics),
  };
}

const boundedInteger = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
const boundedNumber = (value, low, high, inclusive = true) => finite(value) && (inclusive ? value >= low : value > low) && value <= high;
const sorted = (values, compare) => values.every((value, index) => !index || compare(values[index - 1], value) <= 0);
const exactEmptyDiagnostics = value => exactKeys(value, ['warnings', 'consoleErrors', 'pageErrors', 'requestFailures', 'instrumentationKills', 'unsupportedEvidence']) && Object.values(value).every(items => Array.isArray(items) && items.length === 0);
export const signatureUnknownReasons = Object.freeze(['argument-limit', 'array-accessor', 'array-element', 'array-hole', 'canvas-attribute-reset', 'canvas-dimensions-unmodeled', 'canvas-reset', 'canvas-source-reset', 'canvas-state-unmodeled', 'clip-unmodeled', 'command-limit', 'first-window', 'gradient-mutated', 'instrumentation-disabled', 'path-unmodeled', 'previous-window', 'sampling-gap', 'selected-head-state-unmodeled', 'tainted-source', 'transform-unmodeled', 'uncaptured-raster', 'unsupported-value', 'value-token-limit', 'window-limit']);
const signatureUnknownReasonSet = new Set(signatureUnknownReasons);
const validSignatureSupport = (item, windows = []) => typeof item?.sampled === 'boolean'
  && (item.signatureStatus === 'unknown'
    ? signatureUnknownReasonSet.has(item.unknownReason) && (item.comparisonGap === null || boundedInteger(item.comparisonGap, 1, 9999))
    : ['same', 'changed'].includes(item.signatureStatus) && item.unknownReason === null && boundedInteger(item.comparisonGap, 1, 9999) && windows.some(candidate => candidate !== item && candidate.canvasKey === item.canvasKey && candidate.windowIndex === item.windowIndex - item.comparisonGap));

function validProductResult(value) {
  if (!exactKeys(value, ['findings', 'lifecycleEvents', 'episodeAssociations']) || !Array.isArray(value.findings) || !Array.isArray(value.lifecycleEvents) || !Array.isArray(value.episodeAssociations) || value.findings.length > 3 || value.lifecycleEvents.length > 10000 || value.episodeAssociations.length > 2000) return false;
  const finding = item => {
    if (!exactKeys(item, ['type', 'evidenceLevel', 'claimSha256', 'canvasKey', 'relatedEpisodeKeys', 'metrics']) || !Object.hasOwn(expectedClaimDigests, item.type) || item.evidenceLevel !== 'candidate' || item.claimSha256 !== expectedClaimDigests[item.type] || !lowerHex64(item.canvasKey) || !Array.isArray(item.relatedEpisodeKeys) || item.relatedEpisodeKeys.length < 1 || item.relatedEpisodeKeys.length > 10000 || !item.relatedEpisodeKeys.every(lowerHex64) || new Set(item.relatedEpisodeKeys).size !== item.relatedEpisodeKeys.length || !sorted(item.relatedEpisodeKeys, (a, b) => a.localeCompare(b))) return false;
    const m = item.metrics;
    if (item.type === 'heavy-canvas-work') return exactKeys(m, ['canvasApiSelfTimeMs', 'rasterOperationCount', 'maximumWindowSelfTimeMs', 'topMethodCount']) && boundedNumber(m.canvasApiSelfTimeMs, 8, 30000) && boundedInteger(m.rasterOperationCount, 1, 10000000) && boundedNumber(m.maximumWindowSelfTimeMs, 0, m.canvasApiSelfTimeMs, false) && boundedInteger(m.topMethodCount, 1, 32);
    if (item.type === 'repeated-draw-work') return exactKeys(m, ['repeatedWindowCount', 'rasterOperationCount', 'repeatedWindowIndexes', 'repeatedWindowRasterOperationCounts']) && boundedInteger(m.repeatedWindowCount, 1, 10000) && boundedInteger(m.rasterOperationCount, 2, 10000000) && Array.isArray(m.repeatedWindowIndexes) && Array.isArray(m.repeatedWindowRasterOperationCounts) && m.repeatedWindowIndexes.length === m.repeatedWindowCount && m.repeatedWindowRasterOperationCounts.length === m.repeatedWindowCount && m.repeatedWindowIndexes.every(v => boundedInteger(v, 0, 9999)) && sorted(m.repeatedWindowIndexes, (a, b) => a - b) && new Set(m.repeatedWindowIndexes).size === m.repeatedWindowIndexes.length && m.repeatedWindowRasterOperationCounts.every(v => boundedInteger(v, 2, 10000000)) && m.repeatedWindowRasterOperationCounts.reduce((a, b) => a + b, 0) === m.rasterOperationCount;
    if (item.type === 'resize-churn') return exactKeys(m, ['activeResetCount', 'resetEventWindowIndexes']) && boundedInteger(m.activeResetCount, 2, 10000) && Array.isArray(m.resetEventWindowIndexes) && m.resetEventWindowIndexes.length === m.activeResetCount && m.resetEventWindowIndexes.every(v => boundedInteger(v, 0, 9999)) && new Set(m.resetEventWindowIndexes).size >= 2;
    return exactKeys(m, ['affectedWindowCount', 'affectedWindowIndexes', 'areaRatios']) && boundedInteger(m.affectedWindowCount, 2, 10000) && Array.isArray(m.affectedWindowIndexes) && Array.isArray(m.areaRatios) && m.affectedWindowIndexes.length === m.affectedWindowCount && m.areaRatios.length === m.affectedWindowCount && m.affectedWindowIndexes.every(v => boundedInteger(v, 0, 9999)) && sorted(m.affectedWindowIndexes, (a, b) => a - b) && new Set(m.affectedWindowIndexes).size === m.affectedWindowIndexes.length && m.areaRatios.every(v => boundedNumber(v, 2, 1000000));
  };
  const lifecycle = item => exactKeys(item, ['type', 'canvasKey', 'windowIndex', 'connected', 'activeRegistrySize', 'evidenceLevel']) && ['first-observed', 'active', 'detached', 'retired', 'reactivated'].includes(item.type) && lowerHex64(item.canvasKey) && boundedInteger(item.windowIndex, 0, 9999) && typeof item.connected === 'boolean' && boundedInteger(item.activeRegistrySize, 0, 128) && item.evidenceLevel === 'measured';
  const association = item => exactKeys(item, ['entryKey', 'entryKind', 'episodeKey', 'startedAtTimestampMs', 'endedAtTimestampMs', 'evidenceLevel']) && lowerHex64(item.entryKey) && lowerHex64(item.episodeKey) && associationKinds.includes(item.entryKind) && boundedNumber(item.startedAtTimestampMs, 0, 30000) && boundedNumber(item.endedAtTimestampMs, item.startedAtTimestampMs, 30000) && item.evidenceLevel === 'associated';
  const findingKeys = value.findings.map(item => `${item.type}:${item.canvasKey}:${item.relatedEpisodeKeys.join(',')}`);
  const lifecycleKeys = value.lifecycleEvents.map(item => `${item.windowIndex}:${item.type}:${item.canvasKey}`);
  const associationKeys = value.episodeAssociations.map(item => `${item.entryKey}:${item.episodeKey}`);
  return value.findings.every(finding) && value.lifecycleEvents.every(lifecycle) && value.episodeAssociations.every(association)
    && new Set(findingKeys).size === findingKeys.length && new Set(lifecycleKeys).size === lifecycleKeys.length && new Set(associationKeys).size === associationKeys.length
    && sorted(value.findings, (a, b) => `${a.type}:${a.canvasKey}:${a.relatedEpisodeKeys[0]}`.localeCompare(`${b.type}:${b.canvasKey}:${b.relatedEpisodeKeys[0]}`))
    && sorted(value.lifecycleEvents, (a, b) => a.windowIndex - b.windowIndex || a.type.localeCompare(b.type) || a.canvasKey.localeCompare(b.canvasKey))
    && sorted(value.episodeAssociations, (a, b) => a.startedAtTimestampMs - b.startedAtTimestampMs || a.endedAtTimestampMs - b.endedAtTimestampMs || a.entryKey.localeCompare(b.entryKey) || a.episodeKey.localeCompare(b.episodeKey))
    && (!value.episodeAssociations.length || Math.min(...value.episodeAssociations.map(item => item.startedAtTimestampMs)) === 0);
}

function validPrimitiveProof(value) {
  if (!exactKeys(value, ['windows', 'episodes', 'resetEvents', 'browser', 'fixture', 'idle', 'collectionLimits', 'droppedEntryCounts', 'diagnostics']) || !Array.isArray(value.windows) || !Array.isArray(value.episodes) || !Array.isArray(value.resetEvents) || value.windows.length > 10000 || value.episodes.length > 10000 || value.resetEvents.length > 10000 || !exactKeys(value.browser, ['longAnimationFrames', 'entries']) || value.browser.longAnimationFrames !== true || !Array.isArray(value.browser.entries) || value.browser.entries.length > 2000 || !sameJson(value.collectionLimits, collectionLimitValues) || !zeroSessionDrops(value.droppedEntryCounts) || !exactEmptyDiagnostics(value.diagnostics)) return false;
  const window = item => exactKeys(item, ['canvasKey', 'windowIndex', 'startedAtTimestampMs', 'endedAtTimestampMs', 'canvasApiSelfTimeMs', 'rasterOperationCount', 'signatureStatus', 'unknownReason', 'sampled', 'comparisonGap', 'actualToExpectedAreaRatio']) && lowerHex64(item.canvasKey) && boundedInteger(item.windowIndex, 0, 9999) && boundedNumber(item.startedAtTimestampMs, 0, 30000) && boundedNumber(item.endedAtTimestampMs, item.startedAtTimestampMs, 30000) && boundedNumber(item.canvasApiSelfTimeMs, 0, item.endedAtTimestampMs - item.startedAtTimestampMs) && boundedInteger(item.rasterOperationCount, 0, 10000000) && validSignatureSupport(item, value.windows) && (item.actualToExpectedAreaRatio === null || boundedNumber(item.actualToExpectedAreaRatio, 0, 1000000, false));
  const episode = item => exactKeys(item, ['episodeKey', 'firstWindowIndex', 'lastWindowIndex', 'startedAtTimestampMs', 'endedAtTimestampMs', 'canvases']) && lowerHex64(item.episodeKey) && boundedInteger(item.firstWindowIndex, 0, 9999) && boundedInteger(item.lastWindowIndex, item.firstWindowIndex, 9999) && boundedNumber(item.startedAtTimestampMs, 0, 30000) && boundedNumber(item.endedAtTimestampMs, item.startedAtTimestampMs, 30000) && Array.isArray(item.canvases) && item.canvases.length >= 1 && item.canvases.length <= 128 && item.canvases.every(canvas => exactKeys(canvas, ['canvasKey', 'canvasApiSelfTimeMs', 'rasterOperationCount', 'methodCount']) && lowerHex64(canvas.canvasKey) && boundedNumber(canvas.canvasApiSelfTimeMs, 0, item.endedAtTimestampMs - item.startedAtTimestampMs) && boundedInteger(canvas.rasterOperationCount, 0, 10000000) && boundedInteger(canvas.methodCount, 0, 32)) && new Set(item.canvases.map(canvas => canvas.canvasKey)).size === item.canvases.length && sorted(item.canvases, (a, b) => a.canvasKey.localeCompare(b.canvasKey));
  const reset = item => exactKeys(item, ['canvasKey', 'windowIndex', 'source', 'rasterOperationCount', 'activeRasterOverlap']) && lowerHex64(item.canvasKey) && boundedInteger(item.windowIndex, 0, 9999) && ['width-setter', 'height-setter', 'width-attribute', 'height-attribute', 'context-reset'].includes(item.source) && boundedInteger(item.rasterOperationCount, 0, 10000000) && typeof item.activeRasterOverlap === 'boolean';
  const entry = item => exactKeys(item, ['entryKey', 'kind', 'eventType', 'startedAtTimestampMs', 'endedAtTimestampMs']) && lowerHex64(item.entryKey) && associationKinds.includes(item.kind) && (item.kind === 'document-event' ? ['pointerdown', 'keydown', 'wheel'].includes(item.eventType) : item.eventType === null) && boundedNumber(item.startedAtTimestampMs, 0, 30000) && boundedNumber(item.endedAtTimestampMs, item.startedAtTimestampMs, 30000);
  const f = value.fixture; const i = value.idle;
  if (!value.windows.every(window) || !value.episodes.every(episode) || !value.resetEvents.every(reset) || !value.browser.entries.every(entry)
    || !exactKeys(f, ['interactionStartedAtTimestampMs', 'boundaryCount', 'acceptedRunCount', 'drawCount', 'actions', 'visibleChecksum', 'visibleImageHash']) || !boundedNumber(f.interactionStartedAtTimestampMs, 0, 30000) || (f.boundaryCount !== null && !boundedInteger(f.boundaryCount, 0, 120)) || ![0, 1].includes(f.acceptedRunCount) || !boundedInteger(f.drawCount, 0, 10000000) || !Array.isArray(f.actions) || ![0, 7].includes(f.actions.length) || f.actions.some((action, index) => action !== ['Load', 'Zoom', 'Pan', 'Hover', 'Search', 'Filter', 'Resize'][index]) || typeof f.visibleChecksum !== 'string' || f.visibleChecksum.length > 128 || !/^[0-9a-f]{8}$/.test(f.visibleImageHash)
    || !exactKeys(i, ['idleDrawCount', 'preInteractionWindowCount', 'preInteractionEpisodeCount', 'drainWindowCount', 'drainRasterOperationCount']) || i.idleDrawCount !== 0 || i.preInteractionWindowCount !== 0 || i.preInteractionEpisodeCount !== 0 || !boundedInteger(i.drainWindowCount, 1, 10000) || i.drainRasterOperationCount !== IDLE_BOUNDARY_PROBE_OPERATIONS) return false;
  const windowKeys = value.windows.map(item => `${item.canvasKey}:${item.windowIndex}`); const episodeKeys = value.episodes.map(item => item.episodeKey); const entryKeys = value.browser.entries.map(item => item.entryKey);
  const canvasKeys = new Set([...value.windows.map(item => item.canvasKey), ...value.episodes.flatMap(item => item.canvases.map(canvas => canvas.canvasKey)), ...value.resetEvents.map(item => item.canvasKey)]);
  if (new Set(windowKeys).size !== windowKeys.length || new Set(episodeKeys).size !== episodeKeys.length || new Set(entryKeys).size !== entryKeys.length || canvasKeys.size < 1 || canvasKeys.size > 128) return false;
  if (!sorted(value.windows, (a, b) => a.windowIndex - b.windowIndex || a.canvasKey.localeCompare(b.canvasKey)) || !sorted(value.episodes, (a, b) => a.firstWindowIndex - b.firstWindowIndex || a.episodeKey.localeCompare(b.episodeKey)) || !sorted(value.resetEvents, (a, b) => a.windowIndex - b.windowIndex || a.canvasKey.localeCompare(b.canvasKey)) || !sorted(value.browser.entries, (a, b) => a.startedAtTimestampMs - b.startedAtTimestampMs || a.endedAtTimestampMs - b.endedAtTimestampMs || a.entryKey.localeCompare(b.entryKey))) return false;
  const windows = new Set(windowKeys);
  if (value.resetEvents.some(item => !windows.has(`${item.canvasKey}:${item.windowIndex}`))) return false;
  if (value.episodes.some(item => item.canvases.some(canvas => !value.windows.some(window => window.canvasKey === canvas.canvasKey && window.windowIndex >= item.firstWindowIndex && window.windowIndex <= item.lastWindowIndex)))) return false;
  if (value.resetEvents.some(item => value.windows.find(window => window.canvasKey === item.canvasKey && window.windowIndex === item.windowIndex)?.rasterOperationCount !== item.rasterOperationCount)) return false;
  for (const item of value.episodes) {
    const episodeWindows = value.windows.filter(window => window.windowIndex >= item.firstWindowIndex && window.windowIndex <= item.lastWindowIndex);
    if (!episodeWindows.length || Math.min(...episodeWindows.map(window => window.windowIndex)) !== item.firstWindowIndex || Math.max(...episodeWindows.map(window => window.windowIndex)) !== item.lastWindowIndex || Math.min(...episodeWindows.map(window => window.startedAtTimestampMs)) !== item.startedAtTimestampMs || Math.max(...episodeWindows.map(window => window.endedAtTimestampMs)) !== item.endedAtTimestampMs) return false;
    for (const canvas of item.canvases) {
      const canvasWindows = episodeWindows.filter(window => window.canvasKey === canvas.canvasKey);
      const selfTime = canvasWindows.reduce((total, window) => total + window.canvasApiSelfTimeMs, 0);
      const operations = canvasWindows.reduce((total, window) => total + window.rasterOperationCount, 0);
      if (Math.abs(selfTime - canvas.canvasApiSelfTimeMs) > 0.001 || operations !== canvas.rasterOperationCount) return false;
    }
  }
  const timeValues = [f.interactionStartedAtTimestampMs, ...value.windows.flatMap(item => [item.startedAtTimestampMs, item.endedAtTimestampMs]), ...value.episodes.flatMap(item => [item.startedAtTimestampMs, item.endedAtTimestampMs]), ...value.browser.entries.flatMap(item => [item.startedAtTimestampMs, item.endedAtTimestampMs])];
  return Math.min(...timeValues) === 0;
}

const expectedActions = manifest => manifest.scenario === 'integrated-burst' ? ['Load', 'Zoom', 'Pan', 'Hover', 'Search', 'Filter', 'Resize'] : [];
const expectedImageHash = manifest => manifest.scenario === 'integrated-continuous' ? 'e6d09891' : manifest.scenario === 'backing-store-mismatch' && manifest.variant === 'variant-c' ? '90241abe' : manifest.scenario === 'resize-churn' && manifest.mode === 'negative' ? '19e53d85' : manifest.variant === 'variant-b' ? '6beb92ce' : 'c46f0c01';
const expectedEventType = manifest => manifest.factors.eventSource === 'keyboard' ? 'keydown' : manifest.factors.eventSource === 'wheel' ? 'wheel' : 'pointerdown';
const intervalOverlap = (left, right) => left.startedAtTimestampMs <= right.endedAtTimestampMs && left.endedAtTimestampMs >= right.startedAtTimestampMs;

function productFindingActual(product, type) {
  return product.findings.some(item => item.type === type);
}

function productLifecycleActual(product) {
  return product.lifecycleEvents.some(retired => retired.type === 'retired' && product.lifecycleEvents.some(reactivated => reactivated.type === 'reactivated' && reactivated.canvasKey === retired.canvasKey && reactivated.windowIndex > retired.windowIndex));
}

function productReplacementActual(product) {
  return product.lifecycleEvents.some(item => item.type === 'detached');
}

function productAssociationActual(product) {
  return product.episodeAssociations.some(item => item.entryKind === 'long-animation-frame');
}

function lifecycleBinding(product, proof) {
  const pairs = product.lifecycleEvents.flatMap(retired => retired.type !== 'retired' ? [] : product.lifecycleEvents.filter(reactivated => reactivated.type === 'reactivated' && reactivated.canvasKey === retired.canvasKey && reactivated.windowIndex > retired.windowIndex).map(reactivated => ({ retired, reactivated })));
  return pairs.some(({ retired, reactivated }) => {
    const working = proof.windows.filter(window => window.canvasKey === retired.canvasKey && window.rasterOperationCount > 0);
    return working.some(before => before.windowIndex < retired.windowIndex) && working.some(after => after.windowIndex === reactivated.windowIndex) && reactivated.windowIndex - Math.min(...working.map(window => window.windowIndex)) >= proof.fixture.boundaryCount;
  });
}

function replacementBinding(product, proof) {
  const working = proof.windows.filter(window => window.rasterOperationCount > 0);
  if (new Set(working.map(window => window.canvasKey)).size < 2) return false;
  const firstWindow = Math.min(...working.map(window => window.windowIndex));
  return product.lifecycleEvents.some(event => event.type === 'detached' && working.some(window => window.canvasKey === event.canvasKey && window.windowIndex === firstWindow) && working.some(window => window.canvasKey !== event.canvasKey && window.windowIndex >= event.windowIndex));
}

function primaryCanvas(episode) {
  return [...episode.canvases].sort((left, right) => right.canvasApiSelfTimeMs - left.canvasApiSelfTimeMs || left.canvasKey.localeCompare(right.canvasKey))[0];
}

function workingAssociationPair(entry, episode, proof) {
  if (entry.kind !== 'long-animation-frame' || !intervalOverlap(entry, episode)) return false;
  const canvas = primaryCanvas(episode);
  return canvas.canvasApiSelfTimeMs > 0 && canvas.rasterOperationCount > 0 && proof.windows.some(window => window.canvasKey === canvas.canvasKey && window.windowIndex >= episode.firstWindowIndex && window.windowIndex <= episode.lastWindowIndex && window.rasterOperationCount > 0);
}

const loafPairKey = (entryKey, episodeKey) => `${entryKey}:${episodeKey}`;

function qualifyingPrimitiveLoafPairs(proof) {
  return proof.browser.entries.filter(entry => entry.kind === 'long-animation-frame').flatMap(entry => proof.episodes.filter(episode => workingAssociationPair(entry, episode, proof)).map(episode => ({ pairKey: loafPairKey(entry.entryKey, episode.episodeKey), entryKey: entry.entryKey, episodeKey: episode.episodeKey, startedAtTimestampMs: Math.max(entry.startedAtTimestampMs, episode.startedAtTimestampMs), endedAtTimestampMs: Math.min(entry.endedAtTimestampMs, episode.endedAtTimestampMs) }))).sort((left, right) => left.pairKey.localeCompare(right.pairKey));
}

function selectedProductLoafPairs(product) {
  return product.episodeAssociations.filter(item => item.entryKind === 'long-animation-frame').map(item => ({ pairKey: loafPairKey(item.entryKey, item.episodeKey), entryKey: item.entryKey, episodeKey: item.episodeKey, startedAtTimestampMs: item.startedAtTimestampMs, endedAtTimestampMs: item.endedAtTimestampMs })).sort((left, right) => left.pairKey.localeCompare(right.pairKey));
}

function associationsBound(product, proof) {
  const entries = new Map(proof.browser.entries.map(item => [item.entryKey, item]));
  const episodes = new Map(proof.episodes.map(item => [item.episodeKey, item]));
  const loafProduct = selectedProductLoafPairs(product);
  const loafPrimitive = qualifyingPrimitiveLoafPairs(proof);
  if (new Set(loafProduct.map(item => item.pairKey)).size !== loafProduct.length || loafProduct.length !== loafPrimitive.length || !sameJson(loafProduct.map(item => item.pairKey), loafPrimitive.map(item => item.pairKey))) return false;
  const origin = loafPrimitive.length ? Math.min(...loafPrimitive.map(item => item.startedAtTimestampMs)) : 0;
  if (loafProduct.some((item, index) => item.startedAtTimestampMs !== loafPrimitive[index].startedAtTimestampMs - origin || item.endedAtTimestampMs !== loafPrimitive[index].endedAtTimestampMs - origin)) return false;
  const documentAssociations = product.episodeAssociations.filter(item => item.entryKind === 'document-event');
  const documentPairs = [];
  for (const association of documentAssociations) {
    const entry = entries.get(association.entryKey);
    const episode = episodes.get(association.episodeKey);
    if (!entry || !episode || entry.kind !== association.entryKind || !intervalOverlap(entry, episode)) return false;
    documentPairs.push({ association, startedAtTimestampMs: Math.max(entry.startedAtTimestampMs, episode.startedAtTimestampMs), endedAtTimestampMs: Math.min(entry.endedAtTimestampMs, episode.endedAtTimestampMs) });
  }
  const documentOrigin = documentPairs.length ? Math.min(...documentPairs.map(item => item.startedAtTimestampMs)) : 0;
  if (documentPairs.some(item => item.association.startedAtTimestampMs !== item.startedAtTimestampMs - documentOrigin || item.association.endedAtTimestampMs !== item.endedAtTimestampMs - documentOrigin)) return false;
  return true;
}

function primitiveFindingActual(proof, type) {
  if (type === 'heavy-canvas-work') return proof.episodes.some(episode => episode.canvases.some(canvas => {
    const windows = proof.windows.filter(window => window.canvasKey === canvas.canvasKey && window.windowIndex >= episode.firstWindowIndex && window.windowIndex <= episode.lastWindowIndex);
    return canvas.canvasApiSelfTimeMs >= 8 && canvas.rasterOperationCount > 0 && canvas.methodCount > 0 && windows.some(window => window.canvasApiSelfTimeMs > 0);
  }));
  if (type === 'repeated-draw-work') return proof.episodes.some(episode => episode.canvases.some(canvas => proof.windows.some(window => window.canvasKey === canvas.canvasKey && window.windowIndex >= episode.firstWindowIndex && window.windowIndex <= episode.lastWindowIndex && window.signatureStatus === 'same' && window.rasterOperationCount >= 2)));
  if (type === 'resize-churn') return [...new Set(proof.resetEvents.map(item => item.canvasKey))].some(canvasKey => new Set(proof.resetEvents.filter(item => item.canvasKey === canvasKey && item.activeRasterOverlap).map(item => item.windowIndex)).size >= 2);
  return [...new Set(proof.windows.map(item => item.canvasKey))].some(canvasKey => proof.windows.filter(item => item.canvasKey === canvasKey && item.rasterOperationCount > 0 && item.actualToExpectedAreaRatio >= 2).length >= 2);
}

function primitiveLifecycleActual(proof) {
  return proof.fixture.boundaryCount === 120 && [...new Set(proof.windows.map(item => item.canvasKey))].some(canvasKey => {
    const indexes = proof.windows.filter(item => item.canvasKey === canvasKey && item.rasterOperationCount > 0).map(item => item.windowIndex);
    return indexes.length >= 2 && Math.max(...indexes) - Math.min(...indexes) >= 120;
  });
}

function primitiveReplacementActual(proof) {
  return sameJson(proof.fixture.actions, expectedActions({ scenario: 'integrated-burst' })) && new Set(proof.windows.filter(item => item.rasterOperationCount > 0).map(item => item.canvasKey)).size >= 2;
}

function primitiveAssociationActual(proof, manifest) {
  const documentEvent = proof.browser.entries.some(item => item.kind === 'document-event' && item.eventType === expectedEventType(manifest));
  return documentEvent && qualifyingPrimitiveLoafPairs(proof).length > 0;
}

function actualFromProduct(product, manifest) {
  return manifest.expectations.map(expectation => expectation.kind === 'finding' ? productFindingActual(product, expectation.findingType) : expectation.kind === 'lifecycle' ? productLifecycleActual(product) : expectation.kind === 'replacement' ? productReplacementActual(product) : productAssociationActual(product));
}

function actualFromPrimitive(proof, manifest) {
  return manifest.expectations.map(expectation => expectation.kind === 'finding' ? primitiveFindingActual(proof, expectation.findingType) : expectation.kind === 'lifecycle' ? primitiveLifecycleActual(proof) : expectation.kind === 'replacement' ? primitiveReplacementActual(proof) : primitiveAssociationActual(proof, manifest));
}

function findingBound(finding, proof) {
  const episodes = proof.episodes.filter(item => finding.relatedEpisodeKeys.includes(item.episodeKey) && item.canvases.some(canvas => canvas.canvasKey === finding.canvasKey));
  if (!episodes.length) return false;
  const windows = proof.windows.filter(window => window.canvasKey === finding.canvasKey && episodes.some(episode => window.windowIndex >= episode.firstWindowIndex && window.windowIndex <= episode.lastWindowIndex));
  const metrics = finding.metrics;
  if (finding.type === 'heavy-canvas-work') return episodes.some(episode => episode.canvases.some(canvas => canvas.canvasKey === finding.canvasKey && canvas.canvasApiSelfTimeMs === metrics.canvasApiSelfTimeMs && canvas.rasterOperationCount === metrics.rasterOperationCount && canvas.methodCount === metrics.topMethodCount)) && Math.max(...windows.map(window => window.canvasApiSelfTimeMs)) === metrics.maximumWindowSelfTimeMs;
  if (finding.type === 'repeated-draw-work') {
    const repeated = windows.filter(window => window.signatureStatus === 'same' && window.rasterOperationCount >= 2);
    return sameJson(repeated.map(window => window.windowIndex), metrics.repeatedWindowIndexes) && sameJson(repeated.map(window => window.rasterOperationCount), metrics.repeatedWindowRasterOperationCounts);
  }
  if (finding.type === 'resize-churn') return sameJson(proof.resetEvents.filter(item => item.canvasKey === finding.canvasKey && item.activeRasterOverlap).map(item => item.windowIndex), metrics.resetEventWindowIndexes);
  const affected = proof.windows.filter(item => item.canvasKey === finding.canvasKey && item.rasterOperationCount > 0 && item.actualToExpectedAreaRatio >= 2);
  return sameJson(affected.map(item => item.windowIndex), metrics.affectedWindowIndexes) && sameJson(affected.map(item => item.actualToExpectedAreaRatio), metrics.areaRatios);
}

function validNegativeBoundary(product, proof, manifest) {
  if (manifest.mode !== 'negative') return true;
  if (product.findings.length || productAssociationActual(product) || productLifecycleActual(product) || productReplacementActual(product)) return false;
  if (manifest.scenario === 'heavy-burst' || manifest.scenario === 'non-react-burst') {
    const values = proof.episodes.flatMap(item => item.canvases.map(canvas => canvas.canvasApiSelfTimeMs));
    const maximum = Math.max(...values);
    return maximum >= (manifest.scenario === 'heavy-burst' ? 7 : 0) && maximum < 8;
  }
  if (manifest.scenario === 'repeated-continuous') {
    const same = proof.windows.filter(item => item.signatureStatus === 'same').map(item => item.rasterOperationCount);
    return same.length > 0 && Math.max(...same) === 1;
  }
  if (manifest.scenario === 'resize-churn') {
    const active = proof.resetEvents.filter(item => item.activeRasterOverlap);
    const canvasKey = active[0]?.canvasKey;
    return active.length === 2 && active.every(item => item.canvasKey === canvasKey) && new Set(active.map(item => item.windowIndex)).size === 1 && proof.windows.filter(item => item.canvasKey === canvasKey && item.rasterOperationCount > 0).length === 1 && product.lifecycleEvents.filter(item => item.canvasKey === canvasKey && item.type === 'retired').length === 1;
  }
  if (manifest.scenario === 'backing-store-mismatch') {
    const ratios = proof.windows.filter(item => item.rasterOperationCount > 0).map(item => item.actualToExpectedAreaRatio).filter(finite);
    return ratios.length === 2 && ratios.filter(value => value >= 2).length === 1 && ratios.filter(value => value < 2).length === 1;
  }
  if (manifest.scenario === 'lifecycle-reactivation') return proof.fixture.boundaryCount === 119 && !product.lifecycleEvents.some(item => item.type === 'retired');
  const event = proof.browser.entries.find(item => item.kind === 'document-event' && item.eventType === expectedEventType(manifest));
  const firstEpisode = proof.episodes[0];
  return Boolean(event && firstEpisode && event.endedAtTimestampMs < firstEpisode.startedAtTimestampMs && !product.episodeAssociations.some(item => item.entryKind === 'document-event'));
}

function checkCombinedRow(row, manifest) {
  const failures = [];
  if (Array.isArray(row?.primitiveProof?.windows) && row.primitiveProof.windows.some(item => !validSignatureSupport(item, row.primitiveProof.windows))) return ['unknown support'];
  if (!exactKeys(row, ['scenario', 'variant', 'mode', 'productResult', 'primitiveProof']) || rowKey(row) !== rowKey(manifest) || !validProductResult(row.productResult) || !validPrimitiveProof(row.primitiveProof)) return ['combined schema'];
  const productActual = actualFromProduct(row.productResult, manifest);
  const primitiveActual = actualFromPrimitive(row.primitiveProof, manifest);
  const expected = manifest.expectations.map(item => item.expected);
  if (!sameJson(productActual, primitiveActual) || !sameJson(productActual, expected)) failures.push('dual result');
  const expectedFindingTypes = manifest.expectations.filter(item => item.kind === 'finding' && item.expected).map(item => item.findingType).sort();
  if (!sameJson(row.productResult.findings.map(item => item.type).sort(), expectedFindingTypes)) failures.push('product findings');
  const canvasKeys = new Set([...row.primitiveProof.windows.map(item => item.canvasKey), ...row.primitiveProof.episodes.flatMap(item => item.canvases.map(canvas => canvas.canvasKey))]);
  const episodeKeys = new Set(row.primitiveProof.episodes.map(item => item.episodeKey));
  if (row.productResult.findings.some(item => !canvasKeys.has(item.canvasKey) || item.relatedEpisodeKeys.some(key => !episodeKeys.has(key)) || !findingBound(item, row.primitiveProof)) || row.productResult.lifecycleEvents.some(item => !canvasKeys.has(item.canvasKey)) || !associationsBound(row.productResult, row.primitiveProof)) failures.push('key binding');
  if (manifest.expectations.some(item => item.kind === 'lifecycle' && item.expected) && !lifecycleBinding(row.productResult, row.primitiveProof)) failures.push('lifecycle binding');
  if (manifest.expectations.some(item => item.kind === 'replacement' && item.expected) && !replacementBinding(row.productResult, row.primitiveProof)) failures.push('replacement binding');
  if (!validNegativeBoundary(row.productResult, row.primitiveProof, manifest)) failures.push('negative boundary');
  if (row.primitiveProof.fixture.acceptedRunCount !== (manifest.scenario === 'integrated-burst' ? 0 : 1) || row.primitiveProof.fixture.visibleChecksum !== `${manifest.scenario}|${manifest.variant}|18,24,82,44,132,56` || row.primitiveProof.fixture.visibleImageHash !== expectedImageHash(manifest) || !sameJson(row.primitiveProof.fixture.actions, expectedActions(manifest))) failures.push('fixture truth');
  return failures;
}

export function checkCombinedRows(rows) {
  const manifests = orderedRuns();
  if (!Array.isArray(rows) || rows.length !== manifests.length) return ['combined row count'];
  return rows.flatMap((row, index) => checkCombinedRow(row, manifests[index]).map(failure => `${index}:${failure}`));
}

export function checkMatrixProofs(values) { return checkCombinedRows(values); }

export function checkNonReactOwnership(product, proof, supporting) {
  const key = supporting?.canvasId === undefined ? null : digestId(supporting.canvasId);
  const finding = product?.findings?.find(item => item.type === 'heavy-canvas-work');
  return supporting?.nearestReactOwner === null && supporting?.attributionKind === 'unattributed' && finding?.canvasKey === key && proof?.episodes?.some(episode => episode.canvases.some(canvas => canvas.canvasKey === key));
}

const combinedRow = row => ({ scenario: row.scenario, variant: row.variant, mode: row.mode, productResult: row.productResult, primitiveProof: row.primitiveProof });
const expectationResults = (manifest, row) => {
  const productActual = actualFromProduct(row.productResult, manifest);
  const primitiveActual = actualFromPrimitive(row.primitiveProof, manifest);
  return manifest.expectations.map((expectation, index) => ({ ...expectation, actual: productActual[index], pass: productActual[index] === primitiveActual[index] && productActual[index] === expectation.expected, unsupported: false }));
};
export function compatibilityRow(row) {
  const manifest = orderedRuns().find(item => rowKey(item) === rowKey(row));
  if (!manifest) throw new Error(`unknown evidence row: ${rowKey(row)}`);
  const combined = combinedRow(row);
  const failures = checkCombinedRow(combined, manifest);
  if (failures.length) throw new Error(`combined evidence failed: ${rowKey(row)}:${failures.join(',')}`);
  return {
    ...manifest,
    expectations: expectationResults(manifest, combined),
    productResult: structuredClone(row.productResult),
    primitiveProof: structuredClone(row.primitiveProof),
    limits: { collectionLimits: { ...row.primitiveProof.collectionLimits }, droppedEntryCounts: { ...row.primitiveProof.droppedEntryCounts } },
    diagnostics: structuredClone(row.primitiveProof.diagnostics),
    pass: true,
    failures: [],
    visibleChecksum: row.primitiveProof.fixture.visibleChecksum,
    visibleImageHash: row.primitiveProof.fixture.visibleImageHash,
    actions: [...row.primitiveProof.fixture.actions],
  };
}

const compatibilityKeys = ['scenario', 'behavior', 'application', 'variant', 'mode', 'changedFactors', 'factors', 'baseFactors', 'invariant', 'expectations', 'productResult', 'primitiveProof', 'limits', 'diagnostics', 'pass', 'failures', 'visibleChecksum', 'visibleImageHash', 'actions'];
const matrixRow = row => ({ scenario: row.scenario, behavior: row.behavior, application: row.application, variant: row.variant, mode: row.mode, changedFactors: row.changedFactors, factors: row.factors, baseFactors: row.baseFactors, invariant: row.invariant, expectations: row.expectations, productResult: row.productResult, primitiveProof: row.primitiveProof, pass: row.pass });
const negativeRow = row => ({ scenario: row.scenario, variant: row.variant, mode: row.mode, productResult: row.productResult, primitiveProof: row.primitiveProof, pass: row.pass });
function validCompatibilityRow(row, manifest) {
  const combined = combinedRow(row);
  return exactKeys(row, compatibilityKeys)
    && sameDeclaredRow(row, manifest, combined)
    && checkCombinedRow(combined, manifest).length === 0
    && exactKeys(row.limits, ['collectionLimits', 'droppedEntryCounts'])
    && sameJson(row.limits.collectionLimits, collectionLimitValues)
    && sameJson(row.limits.droppedEntryCounts, row.primitiveProof.droppedEntryCounts)
    && sameJson(row.diagnostics, row.primitiveProof.diagnostics)
    && row.pass === true
    && sameJson(row.failures, [])
    && row.visibleChecksum === row.primitiveProof.fixture.visibleChecksum
    && row.visibleImageHash === row.primitiveProof.fixture.visibleImageHash
    && sameJson(row.actions, row.primitiveProof.fixture.actions);
}

export function checkLegacyProjections(combinedRows, primaryRows, matrixRows, negativeRows) {
  assert(checkCombinedRows(combinedRows).length === 0, 'combined evidence failed');
  const expectedPrimary = combinedRows.map(compatibilityRow);
  assert(sameJson(primaryRows, expectedPrimary), 'primary projection changed');
  assert(sameJson(matrixRows, expectedPrimary.map(matrixRow)), 'matrix projection changed');
  assert(sameJson(negativeRows, expectedPrimary.filter(row => row.mode === 'negative').map(negativeRow)), 'negative projection changed');
  return true;
}

export function checkReleaseEvidence(value, truth, now = Date.now()) {
  value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  truth = truth && typeof truth === 'object' && !Array.isArray(truth) ? truth : {};
  const failures = [];
  if (!exactKeys(value, ['schemaVersion', 'releaseRunId', 'startedAt', 'endedAt', 'environment', 'phases', 'diagnostics', 'port']) || value.schemaVersion !== 1 || !validUuid(value.releaseRunId) || !validRunTimes(value.startedAt, value.endedAt, now)) failures.push('artifact schema');
  const environment = value.environment;
  if (!exactKeys(environment, ['chromeRevision', 'gitSha', 'bundleSha256', 'harnessSha256', 'browserContract'])) failures.push('artifact schema');
  else {
    if (environment.chromeRevision !== truth.chromeRevision || environment.gitSha !== truth.gitSha || environment.bundleSha256 !== truth.bundleSha256 || environment.harnessSha256 !== truth.harnessSha256) failures.push('artifact identity');
    const browserFailure = checkBrowserContract(environment.browserContract); if (browserFailure) failures.push(browserFailure);
  }
  const phases = value.phases;
  const idle = phases?.idle; const matrix = phases?.matrix; const mutation = phases?.mutation;
  if (!exactKeys(phases, ['idle', 'matrix', 'mutation']) || !exactKeys(idle, ['runId', 'startedAt', 'endedAt', 'counterexample', 'rows']) || !exactKeys(matrix, ['runId', 'startedAt', 'endedAt', 'rows']) || !exactKeys(mutation, ['runId', 'startedAt', 'endedAt', 'failure'])) failures.push('artifact schema');
  else {
    const ids = [value.releaseRunId, idle.runId, matrix.runId, mutation.runId];
    if (ids.some(id => !validUuid(id)) || new Set(ids).size !== ids.length) failures.push('artifact schema');
    if (!validRunTimes(idle.startedAt, idle.endedAt, now) || !validRunTimes(matrix.startedAt, matrix.endedAt, now) || !validRunTimes(mutation.startedAt, mutation.endedAt, now) || value.startedAt !== idle.startedAt || idle.endedAt !== matrix.startedAt || matrix.endedAt !== mutation.startedAt || mutation.endedAt !== value.endedAt) failures.push('artifact schema');
    const identity = { chromeRevision: environment?.chromeRevision, gitSha: environment?.gitSha, bundleSha256: environment?.bundleSha256, harnessSha256: environment?.harnessSha256 };
    const idleValue = { schemaVersion: 1, runId: idle.runId, matrixRunId: matrix.runId, startedAt: idle.startedAt, endedAt: idle.endedAt, ...identity, counterexample: idle.counterexample, rows: idle.rows, diagnostics: value.diagnostics, port: value.port };
    failures.push(...checkIdleEvidence(idleValue, { ...identity, matrixRunId: matrix.runId, matrixStartedAt: matrix.startedAt }, now));
    const matrixFailures = checkMatrixProofs(matrix.rows); if (matrixFailures.some(failure => failure.endsWith(':unknown support'))) failures.push('unknown support'); if (matrixFailures.some(failure => !failure.endsWith(':unknown support'))) failures.push('artifact truth');
    if (mutation.failure !== missingHeavyFinding) failures.push('artifact truth');
  }
  if (!exactKeys(value.diagnostics, ['warnings', 'consoleErrors', 'pageErrors', 'requestFailures', 'instrumentationKills', 'unsupportedEvidence']) || Object.values(value.diagnostics ?? {}).some(items => !Array.isArray(items) || items.length)) failures.push('diagnostics');
  if (!exactKeys(value.port, ['number', 'listenersAfter']) || value.port.number !== 5190 || !Array.isArray(value.port.listenersAfter) || value.port.listenersAfter.length) failures.push('port');
  return orderedFailures(failures);
}

export function parseMutationText(text) {
  if (typeof text !== 'string' || !text.endsWith('\n')) throw new Error('invalid mutation text');
  const lines = text.slice(0, -1).split('\n');
  const keys = ['mutationRunId', 'parentRunId', 'startedAt', 'endedAt', 'failure'];
  if (lines.length !== keys.length) throw new Error('invalid mutation text');
  const result = {};
  for (const [index, key] of keys.entries()) {
    const prefix = `${key}=`;
    if (!lines[index].startsWith(prefix)) throw new Error('invalid mutation text');
    result[key] = lines[index].slice(prefix.length);
  }
  return result;
}

export function parseHashManifest(text) {
  if (typeof text !== 'string' || !text.endsWith('\n') || text.endsWith('\n\n')) throw new Error('invalid hash manifest');
  const lines = text.slice(0, -1).split('\n');
  if (!lines.length || lines.some(line => !/^[0-9a-f]{64}  [A-Za-z0-9][A-Za-z0-9_.-]*$/.test(line))) throw new Error('invalid hash manifest');
  return lines;
}

export function checkArtifactSet(paths, listed) {
  assert(Array.isArray(paths) && sameJson([...paths].sort(), [...artifactNames].sort()), 'combined artifact set is incomplete');
  if (listed !== undefined) {
    const expectedPaths = [...evidenceNames];
    assert(Array.isArray(listed) && listed.length === expectedPaths.length && new Set(listed).size === listed.length, 'artifact hash line count changed');
    assert(sameJson(listed.map(line => line.slice(66)), expectedPaths), 'artifact hash paths changed');
  }
  return true;
}

export function managedArtifactPaths(names) {
  return names.filter(name => artifactNames.includes(name));
}

export function validateEvidencePayload({ primary, matrix, negatives, summary, continuousPng, burstPng, truth, now = Date.now() }) {
  assert(exactKeys(primary, ['schemaVersion', 'lab', 'runId', 'startedAt', 'endedAt', 'gitSha', 'dirty', 'browser', 'product', 'scenarios', 'matrixCoverage', 'diagnostics', 'pass']) && primary.schemaVersion === 1 && primary.lab === 'canvas-performance-lab-v0.4' && primary.pass === true && validUuid(primary.runId), 'invalid primary evidence');
  assert(validRunTimes(primary.startedAt, primary.endedAt, now), 'invalid evidence timestamps');
  assert(exactKeys(primary.browser, ['name', 'version', 'channel', 'headless']) && primary.browser.name === 'Chrome' && /^\d+\.\d+\.\d+\.\d+$/.test(primary.browser.version ?? '') && primary.browser.channel === 'chrome' && primary.browser.headless === true, 'missing Chrome version');
  assert(exactKeys(primary.product, ['name', 'version', 'bundleSha256']) && primary.product.name === 'canvas-scan' && typeof primary.product.version === 'string' && primary.product.version.length <= 64 && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(primary.product.version) && /^[0-9a-f]{64}$/.test(primary.product.bundleSha256), 'missing product version or bundle hash');
  assert(/^[0-9a-f]{40}$/.test(primary.gitSha ?? '') && typeof primary.dirty === 'boolean', 'invalid Git identity');
  assert(exactKeys(primary.diagnostics, ['warnings', 'consoleErrors', 'pageErrors', 'requestFailures', 'instrumentationKills', 'unsupportedEvidence']) && Object.values(primary.diagnostics).every(items => Array.isArray(items) && items.length === 0), 'invalid primary diagnostics');
  assert(exactKeys(matrix, ['schemaVersion', 'lab', 'runId', 'rows']) && matrix.schemaVersion === 1 && matrix.lab === primary.lab && matrix.runId === primary.runId, 'invalid matrix schema or run ID');
  assert(exactKeys(negatives, ['schemaVersion', 'lab', 'runId', 'rows']) && negatives.schemaVersion === 1 && negatives.lab === primary.lab && negatives.runId === primary.runId, 'invalid negative schema or run ID');
  if (truth) assert(primary.browser.version === truth.chromeRevision && primary.gitSha === truth.gitSha && primary.product.bundleSha256 === truth.bundleSha256, 'evidence identity does not match current truth');
  const expectedRows = orderedRuns(); const expectedKeys = expectedRows.map(rowKey);
  assert(primary.scenarios?.length === 53 && matrix.rows?.length === 53 && negatives.rows?.length === 7, 'invalid evidence row count');
  assert(JSON.stringify(primary.scenarios.map(rowKey)) === JSON.stringify(expectedKeys) && JSON.stringify(matrix.rows.map(rowKey)) === JSON.stringify(expectedKeys), 'invalid evidence row order');
  assert(primary.scenarios.every((row, index) => validCompatibilityRow(row, expectedRows[index])), 'invalid evidence row declaration');
  checkLegacyProjections(primary.scenarios.map(combinedRow), primary.scenarios, matrix.rows, negatives.rows);
  assert(sameJson(primary.matrixCoverage, checkMatrixCoverage(primary.scenarios)), 'invalid matrix coverage');
  assert(checkMatrixCoverage(matrix.rows).pass && checkNearestNegatives(matrix.rows).pass && checkVariantInvariance(matrix.rows).pass, 'invalid matrix evidence');
  assert(validPng(continuousPng) && validPng(burstPng), 'invalid screenshot dimensions');
  assert(summary === summaryText(primary.runId, primary.startedAt, primary.endedAt, primary.scenarios, primary.diagnostics), 'invalid console summary');
  return true;
}
export function validateManifestEntries(listed, actual) { assert(JSON.stringify(listed) === JSON.stringify(actual), 'artifact hash mismatch'); return true; }
export function validateMutationPayload(mutation, primary, now = Date.now()) {
  assert(JSON.stringify(Object.keys(mutation).sort()) === JSON.stringify(['endedAt', 'failure', 'mutationRunId', 'parentRunId', 'startedAt']), 'invalid mutation fields');
  assert(validUuid(mutation.parentRunId) && validUuid(mutation.mutationRunId) && mutation.parentRunId === primary.runId && mutation.mutationRunId !== primary.runId, 'mutation run link mismatch');
  assert(validRunTimes(mutation.startedAt, mutation.endedAt, now) && mutation.failure === missingHeavyFinding, 'invalid mutation evidence');
  const started = Date.parse(mutation.startedAt); const ended = Date.parse(mutation.endedAt);
  assert(started <= ended && started >= Date.parse(primary.endedAt), 'invalid mutation timestamp order');
  return true;
}

export async function validateEvidence(run = requireRun(), checkIndex = true) {
  useEvidenceRun(run);
  const index = checkIndex ? await checkRunIndex(run) : null;
  const [primary, matrix, negatives, summaryBytes, continuousPng, burstPng] = await Promise.all([json(normalNames[0]), json(normalNames[1]), json(normalNames[2]), readCurrentArtifact(run, normalNames[3]), readCurrentArtifact(run, normalNames[4]), readCurrentArtifact(run, normalNames[5])]);
  const summary = summaryBytes.toString('utf8');
  const truth = { chromeRevision: installedChromeRevision(), gitSha: gitHead(), bundleSha256: await fileSha256(bundleTarget), harnessSha256: await harnessSha256() };
  if (index) {
    const modules = await verifyReleaseManifest();
    assert(index.source.chromeRevision === truth.chromeRevision && index.source.gitSha === truth.gitSha && index.source.bundleSha256 === truth.bundleSha256 && index.source.manifestSha256 === truth.harnessSha256 && sameJson(index.source.modules, modules), 'artifact identity');
  }
  validateEvidencePayload({ primary, matrix, negatives, summary, continuousPng, burstPng, truth });
  const idle = await json(idleArtifactName);
  const idleFailures = checkIdleEvidence(idle, { ...truth, matrixRunId: primary.runId, matrixStartedAt: primary.startedAt });
  if (idleFailures.length) throw new Error(idleFailures.join('; '));
  const release = await json(releaseArtifactName);
  const releaseFailures = checkReleaseEvidence(release, truth);
  if (releaseFailures.length) throw new Error(releaseFailures.join('; '));
  const listed = parseHashManifest((await readCurrentArtifact(run, hashName)).toString('utf8'));
  checkArtifactSet(artifactNames, listed);
  validateManifestEntries(listed, await hashEntries(evidenceNames));
  const mutation = parseMutationText((await readCurrentArtifact(run, mutationName)).toString('utf8'));
  validateMutationPayload(mutation, primary);
  assert(release.phases.idle.runId === idle.runId && release.phases.idle.startedAt === idle.startedAt && release.phases.idle.endedAt === idle.endedAt && sameJson(release.phases.idle.counterexample, idle.counterexample) && sameJson(release.phases.idle.rows, idle.rows), 'idle artifact does not match release evidence');
  assert(release.phases.matrix.runId === primary.runId && release.phases.matrix.startedAt === primary.startedAt && release.phases.matrix.endedAt === primary.endedAt && sameJson(release.phases.matrix.rows, primary.scenarios.map(combinedRow)), 'matrix artifact does not match release evidence');
  assert(sameJson(mutation, { mutationRunId: release.phases.mutation.runId, parentRunId: release.phases.matrix.runId, startedAt: release.phases.mutation.startedAt, endedAt: release.phases.mutation.endedAt, failure: release.phases.mutation.failure }), 'mutation artifact does not match release evidence');
  if (index) assert(index.startedAt === release.startedAt && index.endedAt === release.endedAt, 'artifact identity');
  return { primary, matrix, negatives, mutationExists: true, mutation, idleExists: true, idle, releaseExists: true, release };
}

function listeners() {
  try {
    const text = execFileSync('/usr/sbin/lsof', ['-nP', '-iTCP@127.0.0.1:5190', '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim();
    return text ? [...new Set(text.split('\n').map(Number))] : [];
  } catch (error) { if (error.status === 1) return []; throw error; }
}
function processGroup(pid) { return Number(execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim()); }
function exited(server) { return server.exitCode !== null || server.signalCode !== null; }
async function waitForExit(server, timeout) { if (exited(server)) return true; await Promise.race([once(server, 'exit'), wait(timeout)]); return exited(server); }
export async function stopOwnedServer(server, isOwned) {
  if (!server?.pid || exited(server)) return { stopped: false, forced: false };
  let owned;
  try { owned = isOwned(server.pid); } catch (error) { if (error.code === 'ESRCH') return { stopped: false, forced: false }; throw error; }
  if (!owned) throw new Error('Vite ownership changed before cleanup');
  try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (await waitForExit(server, 5000)) return { stopped: true, forced: false };
  if (!isOwned(server.pid)) throw new Error('Vite ownership changed before forced cleanup');
  try { process.kill(-server.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (!(await waitForExit(server, 5000))) throw new Error('Vite did not exit after cleanup signals');
  return { stopped: true, forced: true };
}
function ownedServer(pid) { try { return processGroup(pid) === pid; } catch { return false; } }
function listenerOwnership(pid) { const found = listeners(); return found.length > 0 && found.every(listener => processGroup(listener) === pid); }
async function waitForVite(server) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exited(server)) throw new Error(`Vite exited before ready: ${server.exitCode ?? server.signalCode}`);
    if (listenerOwnership(server.pid)) {
      const response = await fetch(`${baseUrl}/v04-lab.html`).catch(() => null);
      if (response?.ok && listenerOwnership(server.pid)) return;
    }
    await wait(250);
  }
  throw new Error('Vite did not become ready');
}
function startVite() { return spawn('pnpm', ['--filter', 'workbench', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5190', '--strictPort'], { cwd: root, detached: true, stdio: 'inherit' }); }
async function startMeasuredInteraction(page, manifest, startRecording) {
  return page.evaluate(({ eventSource, integratedBurst, start }) => {
    if (start) window.__CANVAS_SCAN__.startRecording();
    const idle = window.__CANVAS_LAB_FIXTURE__.snapshot();
    if (integratedBurst) document.querySelector('[data-burst-action="Load"]').click();
    else {
      const trigger = document.querySelector('#lab-trigger');
      if (eventSource === 'keyboard') trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      else if (eventSource === 'wheel') trigger.dispatchEvent(new WheelEvent('wheel', { deltaY: 12, bubbles: true }));
      else trigger.dispatchEvent(new PointerEvent('pointerdown', { button: 0, pointerType: 'mouse', bubbles: true }));
    }
    return idle;
  }, { eventSource: manifest.factors.eventSource, integratedBurst: manifest.scenario === 'integrated-burst', start: startRecording });
}
async function checkPointerClick(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/v04-lab.html?scenario=heavy-burst&variant=variant-a&mode=bad`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__CANVAS_LAB_FIXTURE__?.ready, undefined, { timeout: 10_000 });
    await page.locator('#lab-trigger').click();
    await page.waitForFunction(() => window.__CANVAS_LAB_FIXTURE__?.snapshot().interactionComplete === true, undefined, { timeout: 30_000 });
    const fixture = await page.evaluate(() => window.__CANVAS_LAB_FIXTURE__.snapshot());
    assert(fixture.acceptedRunCount === 1, `pointer click accepted run count must equal 1 (received ${fixture.acceptedRunCount})`);
  } finally { await context.close(); }
}
function supportingCanvas(session, manifest) {
  const findingTypes = new Set(manifest.expectations.filter(item => item.kind === 'finding').map(item => item.findingType));
  const finding = session.findings.find(item => findingTypes.has(item.type));
  if (finding) return session.canvases.find(canvas => canvas.canvasId === finding.canvasId) ?? null;
  if (manifest.scenario === 'lifecycle-reactivation') {
    const event = session.lifecycleEvents.find(item => item.type === 'retired');
    return session.canvases.find(canvas => canvas.canvasId === event?.canvasId) ?? session.canvases[0] ?? null;
  }
  if (manifest.scenario === 'interaction-association') {
    const association = session.episodeAssociations.find(item => item.entryKind === 'long-animation-frame') ?? session.episodeAssociations[0];
    const episode = session.episodes.find(item => item.episodeId === association?.episodeId);
    const canvasId = episode?.canvases.slice().sort((left, right) => right.canvasApiSelfTimeMs - left.canvasApiSelfTimeMs)[0]?.canvasId;
    return session.canvases.find(canvas => canvas.canvasId === canvasId) ?? session.canvases[0] ?? null;
  }
  return session.canvases[0] ?? null;
}
function negativeEvidence(session, manifest, fixture) {
  if (manifest.mode !== 'negative') return {};
  if (manifest.scenario === 'heavy-burst' || manifest.scenario === 'non-react-burst') return {
    boundary: { metric: 'canvasApiSelfTimeMs', threshold: 8, comparison: 'below' },
    observations: { maximumCanvasApiSelfTimeMs: Math.max(...session.canvases.map(canvas => canvas.canvasApiSelfTimeMs)) },
  };
  if (manifest.scenario === 'repeated-continuous') return {
    boundary: { metric: 'sameWindowRasterOperationCount', threshold: 2, comparison: 'one-below' },
    observations: { sameWindowRasterOperationCounts: session.windows.filter(window => window.signatureStatus === 'same').map(window => window.rasterOperationCount).sort((left, right) => left - right) },
  };
  if (manifest.scenario === 'resize-churn') return {
    boundary: { metric: 'activeResetWindowCount', threshold: 2, comparison: 'one-below' },
    observations: (() => {
      const active = session.resetEvents.filter(event => event.activeRasterOverlap);
      const canvasId = active[0]?.canvasId;
      return { activeResetCount: active.length, activeResetWindowCount: new Set(active.map(event => event.windowIndex)).size, observedResetCount: session.resetEvents.length, measuredWorkCount: session.windows.filter(window => window.canvasId === canvasId && window.rasterOperationCount > 0).length, retiredCount: session.lifecycleEvents.filter(event => event.canvasId === canvasId && event.type === 'retired').length };
    })(),
  };
  if (manifest.scenario === 'backing-store-mismatch') {
    const ratios = session.windows.filter(window => window.rasterOperationCount > 0).map(window => window.geometry.actualToExpectedAreaRatio).filter(value => typeof value === 'number').sort((left, right) => right - left);
    return { boundary: { metric: 'affectedWindowCount', windowThreshold: 2, areaRatioThreshold: 2, comparison: 'one-below' }, observations: { activeWindowAreaRatios: ratios, affectedWindowCount: ratios.filter(value => value >= 2).length } };
  }
  if (manifest.scenario === 'lifecycle-reactivation') return {
    boundary: { metric: 'inactiveBoundaries', threshold: 120, comparison: 'one-below' },
    observations: { inactiveBoundaries: fixture.boundaryCount, retiredCount: session.lifecycleEvents.filter(event => event.type === 'retired' && event.canvasId === session.canvases[0]?.canvasId).length },
  };
  const eventType = manifest.factors.eventSource === 'keyboard' ? 'keydown' : manifest.factors.eventSource === 'wheel' ? 'wheel' : 'pointerdown';
  const event = session.browserEntries.find(entry => entry.kind === 'document-event' && entry.eventType === eventType);
  const episode = session.episodes.slice().sort((left, right) => left.startedAtTimestampMs - right.startedAtTimestampMs)[0];
  return {
    boundary: { metric: 'monotonicRangeOverlap', comparison: 'event-before-episode' },
    observations: { eventEndedAtTimestampMs: event?.endedAtTimestampMs ?? null, episodeStartedAtTimestampMs: episode?.startedAtTimestampMs ?? null, gapMs: event && episode ? episode.startedAtTimestampMs - event.endedAtTimestampMs : null, associationCount: session.episodeAssociations.filter(item => item.entryId === event?.entryId).length },
  };
}
async function showFindings(page) {
  await page.evaluate(() => {
    const root = document.querySelector('[data-canvas-scan]')?.shadowRoot;
    const counts = root?.querySelector('.counts');
    if (counts instanceof HTMLButtonElement && counts.getAttribute('aria-expanded') !== 'true') counts.click();
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
const browserContractFor = page => page.evaluate(() => {
  const scripts = [...document.scripts].map(script => {
    const rawSrc = script.getAttribute('src');
    const resolved = rawSrc === null ? null : new URL(script.src);
    const kind = rawSrc === null ? script.type ? `${script.type}-inline` : 'classic-inline' : script.type === 'module' ? 'module-external' : 'classic-external';
    const resolvedPath = resolved?.origin === location.origin ? resolved.pathname : resolved?.href ?? null;
    const role = kind === 'classic-inline' && rawSrc === null ? 'options'
      : kind === 'classic-external' && rawSrc === '/canvas-scan.iife.js' && resolvedPath === '/canvas-scan.iife.js' ? 'canvas-scan'
        : kind === 'module-external' && rawSrc === '/src/v04-lab-main.tsx' && resolvedPath === '/src/v04-lab-main.tsx' ? 'application'
          : 'unexpected';
    return { role, kind, rawSrc, resolvedPath, query: resolved?.search ?? '', fragment: resolved?.hash ?? '' };
  });
  const descriptor = Object.getOwnPropertyDescriptor(window, '__CANVAS_SCAN_OPTS'); const value = descriptor?.value; const fixture = window.__CANVAS_LAB_FIXTURE__;
  return { scripts, options: { own: Object.hasOwn(window, '__CANVAS_SCAN_OPTS'), frozen: Object.isFrozen(value), writable: descriptor?.writable ?? null, configurable: descriptor?.configurable ?? null, keys: value && typeof value === 'object' ? Object.keys(value) : [], overlay: value?.overlay ?? null }, ready: { canvasScan: Boolean(window.__CANVAS_SCAN__), fixture: fixture?.ready === true, capabilityValidated: fixture?.snapshot()?.capabilityValidated === true } };
});
const IDLE_BOUNDARY_PROBE_OPERATIONS = 17;
async function crossIdleBoundary(page, drain) {
  const before = await page.evaluate(operations => {
    const fixture = window.__CANVAS_LAB_FIXTURE__.snapshot();
    const reports = window.__CANVAS_SCAN__.getReports();
    window.__CANVAS_SCAN__.startRecording();
    const canvas = document.querySelector('[data-lab-role="primary"]');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('idle boundary canvas is absent');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('idle boundary canvas context is absent');
    for (let index = 0; index < operations; index++) context.clearRect(-1000 - index, -1000, 1, 1);
    return { fixture, reports };
  }, IDLE_BOUNDARY_PROBE_OPERATIONS);
  await page.waitForFunction(({ operations, reports }) => Object.entries(window.__CANVAS_SCAN__.getReports()).some(([canvasId, report]) => report.rasterOperationCount === operations && JSON.stringify(report) !== JSON.stringify(reports[canvasId])), { operations: IDLE_BOUNDARY_PROBE_OPERATIONS, reports: before.reports }, { timeout: 5000 });
  if (!drain) return { before: before.fixture, after: await page.evaluate(() => window.__CANVAS_LAB_FIXTURE__.snapshot()), drainWindowCount: null, drainRasterOperationCount: null };
  const drained = await page.evaluate(() => window.__CANVAS_SCAN__.stopRecording());
  const probe = drained?.windows.find(window => window.rasterOperationCount === IDLE_BOUNDARY_PROBE_OPERATIONS);
  assert(probe, 'idle boundary drain did not contain the probe operations');
  const after = await page.evaluate(() => window.__CANVAS_LAB_FIXTURE__.snapshot());
  assert(before.fixture.drawCount === after.drawCount && after.interactionStartedAt === null && after.acceptedRunCount === 0, 'fixture changed during the idle boundary handshake');
  return { before: before.fixture, after, drainWindowCount: drained.windows.length, drainRasterOperationCount: probe.rasterOperationCount };
}
async function captureRow(browser, browserVersion, manifest, screenshot, idleMode = 'handshake') {
  const diagnostics = collectDiagnostics();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: manifest.factors.devicePixelRatio });
  const page = await context.newPage();
  page.on('console', message => {
    const text = message.text();
    if (message.type() === 'warning') diagnostics.warnings.push(text);
    if (message.type() === 'error') diagnostics.consoleErrors.push(text);
    if (/instrumentation.*(?:disabled|kill)|(?:disabled|kill).*instrumentation/i.test(text)) diagnostics.instrumentationKills.push(text);
  });
  page.on('pageerror', error => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', request => { const url = new URL(request.url()); diagnostics.requestFailures.push(`${request.method()} ${url.origin}${url.pathname}`.slice(0, 500)); });
  try {
    const query = new URLSearchParams({ scenario: manifest.scenario, variant: manifest.variant, mode: manifest.mode });
    if (manifest.mutation) query.set('mutation', manifest.mutation);
    await page.goto(`${baseUrl}/v04-lab.html?${query}`, { waitUntil: 'load' });
    try { await page.waitForFunction(() => window.__CANVAS_SCAN__ && window.__CANVAS_LAB_FIXTURE__?.ready, undefined, { timeout: 10_000 }); }
    catch (error) { throw new Error(`fixture readiness failed: ${error.message}; diagnostics=${JSON.stringify(diagnostics)}`); }
    const browserContract = await browserContractFor(page);
    const browserFailure = checkBrowserContract(browserContract);
    if (browserFailure) throw new Error(browserFailure);
    const idleHandshake = await crossIdleBoundary(page, idleMode !== 'counterexample');
    const idle = await startMeasuredInteraction(page, manifest, idleMode !== 'counterexample');
    if (manifest.scenario === 'integrated-burst') {
      await page.waitForFunction(() => window.__CANVAS_LAB_FIXTURE__.snapshot().actions.length === 1);
      for (const [index, action] of ['Zoom', 'Pan', 'Hover', 'Search', 'Filter', 'Resize'].entries()) {
        await page.evaluate(label => document.querySelector(`[data-burst-action="${label}"]`).click(), action);
        await page.waitForFunction(count => window.__CANVAS_LAB_FIXTURE__.snapshot().actions.length === count, index + 2);
      }
    } else {
      await page.waitForFunction(() => window.__CANVAS_LAB_FIXTURE__.snapshot().interactionStartedAt !== null, undefined, { timeout: 2000 });
    }
    const session = await page.evaluate(async () => {
      await Promise.race([
        window.__CANVAS_LAB_FIXTURE__.completed,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`fixture timeout phase=${window.__CANVAS_LAB_FIXTURE__.snapshot().phase}`)), 30_000)),
      ]);
      return window.__CANVAS_SCAN__.stopRecording();
    });
    const fixture = await page.evaluate(() => window.__CANVAS_LAB_FIXTURE__.snapshot(true));
    if (manifest.scenario === 'interaction-association' && manifest.mode === 'bad' && session.browserFeatures.longAnimationFrames === false) diagnostics.unsupportedEvidence.push({ feature: 'long-animation-frame', browserVersion, reason: 'Chrome did not expose Long Animation Frame entries', expectation: manifest.expectations[0].id });
    const evaluated = evaluateCapture(manifest, session, { idleDrawCount: idle.drawCount, interactionStartedAt: fixture.interactionStartedAt, fixtureBoundaryCount: fixture.boundaryCount, acceptedRunCount: fixture.acceptedRunCount }, { diagnostics });
    const productResult = projectProductResult(session);
    const primitiveProof = projectPrimitiveProof(session, fixture, { drawCount: idle.drawCount, drainWindowCount: idleHandshake.drainWindowCount, drainRasterOperationCount: idleHandshake.drainRasterOperationCount }, evaluated.diagnostics);
    const supporting = supportingCanvas(session, manifest);
    if (manifest.scenario === 'non-react-burst' && manifest.mode === 'bad' && !checkNonReactOwnership(productResult, primitiveProof, supporting)) throw new Error('non-React ownership binding failed');
    let screenshotBytes;
    if (screenshot) { await showFindings(page); screenshotBytes = await page.screenshot(); }
    const negative = negativeEvidence(session, manifest, fixture);
    return {
      ...manifest, expectations: evaluated.expectationResults, findings: session.findings,
      supportingCanvas: supporting, limits: { collectionLimits: session.collectionLimits, droppedEntryCounts: session.droppedEntryCounts },
      diagnostics: evaluated.diagnostics, pass: evaluated.pass, failures: evaluated.failures, associations: session.episodeAssociations,
      visibleChecksum: fixture.visibleChecksum, visibleImageHash: fixture.visibleImageHash, actions: fixture.actions, drawCount: fixture.drawCount,
      productResult, primitiveProof,
      browserContract,
      ...(screenshotBytes ? { screenshotBytes } : {}),
      ...(idleMode === 'evidence' ? { idleHandshake } : {}),
      ...negative,
    };
  } finally { await context.close(); }
}
function applyPairChecks(rows) {
  for (const bad of rows.filter(row => row.mode === 'bad' && row.variant !== 'integrated' || row.mode === 'bad' && row.variant === 'integrated')) {
    const fixed = rows.find(row => row.scenario === bad.scenario && row.variant === bad.variant && row.mode === 'fixed');
    if (!fixed) continue;
    const same = bad.visibleChecksum === fixed.visibleChecksum && bad.visibleImageHash === fixed.visibleImageHash && JSON.stringify(bad.actions) === JSON.stringify(fixed.actions);
    if (!same) for (const row of [bad, fixed]) { row.pass = false; row.failures.push('bad/fixed visible result or interaction mismatch'); }
  }
}
function aggregateDiagnostics(rows) {
  const result = collectDiagnostics();
  for (const row of rows) for (const key of Object.keys(result)) for (const item of row.diagnostics[key]) result[key].push({ row: rowKey(row), value: item });
  return result;
}
function summaryText(runId, startedAt, endedAt, rows, diagnostics) {
  const lines = [`runId=${runId}`, `startedAt=${startedAt}`, `endedAt=${endedAt}`];
  for (const row of rows) lines.push(`${rowKey(row)}: ${row.pass ? 'PASS' : `FAIL ${row.failures.join('; ')}`}`);
  for (const [name, values] of Object.entries(diagnostics)) lines.push(`${name}=${JSON.stringify(values)}`);
  lines.push(...normalNames);
  return `${lines.join('\n')}\n`;
}
async function launchLab(operation) {
  if (listeners().length) throw new Error('port 5190 already has a listener');
  const server = startVite();
  let browser; let browserDisconnected = false; let closingBrowser = false; let operationError; let value; let cleanupError;
  try {
    await waitForVite(server);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    browser.on('disconnected', () => { if (!closingBrowser) browserDisconnected = true; });
    value = await operation(browser, browser.version());
  } catch (error) { operationError = error; }
  try { closingBrowser = true; await browser?.close(); } catch (error) { cleanupError = error; }
  try {
    const stopped = await stopOwnedServer(server, ownedServer);
    if (stopped.forced) cleanupError = cleanupError ?? new Error('Vite required forced cleanup');
  } catch (error) { cleanupError = cleanupError ?? error; }
  if (listeners().length) cleanupError = cleanupError ?? new Error('Vite cleanup left a listener');
  if (browserDisconnected && !operationError) operationError = new Error('browser disconnected before capture completed');
  if (operationError) { if (cleanupError) operationError.message += `; cleanup: ${cleanupError.message}`; throw operationError; }
  if (cleanupError) throw cleanupError;
  return value;
}

async function captureMatrix(browser, browserVersion) {
  await checkPointerClick(browser);
  const rows = []; const screenshots = new Map(); let browserContract;
  for (const manifest of orderedRuns()) {
    const screenshot = manifest.scenario === 'integrated-continuous' && manifest.mode === 'bad' ? normalNames[4] : manifest.scenario === 'integrated-burst' && manifest.mode === 'bad' ? normalNames[5] : undefined;
    try {
      const row = await captureRow(browser, browserVersion, manifest, Boolean(screenshot));
      if (browserContract && !sameJson(browserContract, row.browserContract)) throw new Error('browser contract changed between captures');
      browserContract = row.browserContract;
      if (screenshot) screenshots.set(screenshot, row.screenshotBytes);
      delete row.screenshotBytes; delete row.browserContract;
      rows.push(row);
    }
    catch (error) { throw new Error(`${rowKey(manifest)}: ${error.message}`); }
  }
  if (screenshots.size !== 2) throw new Error('screenshot set');
  return { rows, screenshots, browserContract };
}
async function writeMatrixEvidence({ rows, screenshots, browserContract, browserVersion, runId, startedAt, endedAt, bundleTarget }) {
  applyPairChecks(rows);
  if (rows.some(row => !row.pass)) throw new Error(rows.filter(row => !row.pass).map(row => `${rowKey(row)}: ${row.failures.join('; ')}`).join(' | '));
  const combinedFailures = checkCombinedRows(rows.map(combinedRow));
  if (combinedFailures.length) throw new Error(`combined evidence failed: ${combinedFailures.join('; ')}`);
  const diagnostics = aggregateDiagnostics(rows);
  const evidenceRows = rows.map(compatibilityRow);
  const productPackage = JSON.parse(await readFile(path.join(root, 'packages/core/package.json'), 'utf8'));
  const result = buildLabResult({
    runId, startedAt, endedAt, scenarios: evidenceRows,
    browser: { name: 'Chrome', version: browserVersion, channel: 'chrome', headless: true },
    product: { name: productPackage.name, version: productPackage.version, bundleSha256: createHash('sha256').update(await readFile(bundleTarget)).digest('hex') },
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()), diagnostics,
  });
  await writeArtifact(normalNames[0], `${JSON.stringify(result, null, 2)}\n`);
  await writeArtifact(normalNames[1], `${JSON.stringify(buildMatrixArtifact(runId, evidenceRows), null, 2)}\n`);
  await writeArtifact(normalNames[2], `${JSON.stringify(buildNearestNegativeArtifact(runId, evidenceRows), null, 2)}\n`);
  const summary = summaryText(runId, startedAt, endedAt, evidenceRows, diagnostics);
  await writeArtifact(normalNames[3], summary);
  await writeArtifact(normalNames[4], screenshots.get(normalNames[4]));
  await writeArtifact(normalNames[5], screenshots.get(normalNames[5]));
  process.stdout.write(summary);
  if (!result.pass) throw new Error('closed matrix result failed');
  return { result, browserContract };
}

async function captureIdleSet(browser, browserVersion) {
  const counterManifest = orderedRuns().find(row => row.scenario === 'backing-store-mismatch' && row.variant === 'variant-c' && row.mode === 'bad');
  const counterexample = await captureRow(browser, browserVersion, counterManifest, undefined, 'counterexample');
  if (counterexample.pass || JSON.stringify(counterexample.failures) !== JSON.stringify(['idle capture contains draw activity'])) throw new Error(`idle counterexample changed: ${counterexample.failures.join('; ')}`);
  const rows = []; let browserContract = counterexample.browserContract;
  const capturedRows = [];
  for (let index = 0; index < 20; index++) {
    const expected = idleRowManifest(index);
    const manifest = orderedRuns().find(row => row.scenario === expected.scenario && row.variant === expected.variant && row.mode === expected.mode);
    const row = await captureRow(browser, browserVersion, manifest, undefined, 'evidence');
    if (!sameJson(browserContract, row.browserContract)) throw new Error('browser contract changed between captures');
    const handshake = row.idleHandshake;
    capturedRows.push(row);
    rows.push({
      iteration: index + 1, scenario: row.scenario, variant: row.variant, mode: row.mode, schedule: expected.schedule, productResult: row.productResult, primitiveProof: row.primitiveProof,
      handshake: { probeOperations: IDLE_BOUNDARY_PROBE_OPERATIONS, beforeDrawCount: handshake.before.drawCount, afterDrawCount: handshake.after.drawCount, beforeAcceptedRunCount: handshake.before.acceptedRunCount, afterAcceptedRunCount: handshake.after.acceptedRunCount, afterInteractionStartedAt: handshake.after.interactionStartedAt, drainWindowCount: handshake.drainWindowCount, drainRasterOperationCount: handshake.drainRasterOperationCount },
    });
  }
  if (capturedRows.some(row => !row.pass)) throw new Error(capturedRows.filter(row => !row.pass).map((row, index) => `idle row ${index + 1}: ${row.failures.join('; ')}`).join(' | '));
  return {
    browserVersion, browserContract, counterexample: { scenario: counterexample.scenario, variant: counterexample.variant, mode: counterexample.mode, pass: counterexample.pass, failures: counterexample.failures, droppedEntryCounts: counterexample.limits.droppedEntryCounts }, rows,
    diagnostics: aggregateDiagnostics([counterexample, ...capturedRows]),
  };
}
async function buildIdleArtifact(captured, runId, matrixRunId, startedAt, endedAt, bundleTarget) {
  return {
    schemaVersion: 1, runId, matrixRunId, startedAt, endedAt, chromeRevision: captured.browserVersion,
    gitSha: gitHead(), bundleSha256: await fileSha256(bundleTarget), harnessSha256: await harnessSha256(),
    counterexample: captured.counterexample, rows: captured.rows, diagnostics: captured.diagnostics, port: { number: 5190, listenersAfter: listeners() },
  };
}
async function idleRelease() {
  const run = useEvidenceRun(await createEvidenceRun('idle-release'));
  writtenArtifacts.clear();
  const modules = await verifyReleaseManifest();
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'run', 'build'], { cwd: root, stdio: 'inherit' });
  const bundleSource = path.join(root, 'packages/core/dist/canvas-scan.iife.js');
  const bundleTarget = path.join(root, 'apps/workbench/public/canvas-scan.iife.js');
  await copyFile(bundleSource, bundleTarget);
  const releaseRunId = randomUUID(); const idleRunId = randomUUID(); const idleStartedAt = new Date().toISOString();
  const captured = await launchLab(async (browser, browserVersion) => {
    const idle = await captureIdleSet(browser, browserVersion);
    const idleEndedAt = new Date().toISOString();
    const matrixRunId = randomUUID(); const matrixStartedAt = idleEndedAt;
    const matrix = await captureMatrix(browser, browserVersion);
    const matrixEndedAt = new Date().toISOString();
    const mutationRunId = randomUUID(); const mutationStartedAt = matrixEndedAt;
    const manifest = applyMutation(orderedRuns(), 'heavy-burst-seed-off').find(row => row.mutation);
    const mutationResult = await captureRow(browser, browserVersion, manifest);
    const mutationEndedAt = new Date().toISOString();
    if (!sameJson(idle.browserContract, matrix.browserContract) || !sameJson(idle.browserContract, mutationResult.browserContract)) throw new Error('browser contract changed between phases');
    return { browserVersion, idle, idleEndedAt, matrixRunId, matrixStartedAt, matrixEndedAt, matrix, mutationRunId, mutationStartedAt, mutationEndedAt, mutationResult };
  });
  const matrixWritten = await writeMatrixEvidence({ ...captured.matrix, browserVersion: captured.browserVersion, runId: captured.matrixRunId, startedAt: captured.matrixStartedAt, endedAt: captured.matrixEndedAt, bundleTarget });
  const primary = matrixWritten.result;
  const idleArtifact = await buildIdleArtifact(captured.idle, idleRunId, captured.matrixRunId, idleStartedAt, captured.idleEndedAt, bundleTarget);
  const idleFailures = checkIdleEvidence(idleArtifact, { matrixRunId: primary.runId, matrixStartedAt: primary.startedAt, chromeRevision: primary.browser.version, gitSha: primary.gitSha, bundleSha256: primary.product.bundleSha256, harnessSha256: await harnessSha256() });
  if (idleFailures.length) throw new Error(idleFailures.join('; '));
  await writeArtifact(idleArtifactName, `${JSON.stringify(idleArtifact, null, 2)}\n`);
  if (captured.mutationResult.pass || !sameJson(captured.mutationResult.failures, [missingHeavyFinding])) throw new Error(`mutation failed outside its contract: ${captured.mutationResult.failures.join('; ')}`);
  const mutationEvidence = { mutationRunId: captured.mutationRunId, parentRunId: captured.matrixRunId, startedAt: captured.mutationStartedAt, endedAt: captured.mutationEndedAt, failure: missingHeavyFinding };
  validateMutationPayload(mutationEvidence, primary);
  await writeArtifact(mutationName, `mutationRunId=${mutationEvidence.mutationRunId}\nparentRunId=${mutationEvidence.parentRunId}\nstartedAt=${mutationEvidence.startedAt}\nendedAt=${mutationEvidence.endedAt}\nfailure=${mutationEvidence.failure}\n`);
  const releaseDiagnostics = collectDiagnostics();
  for (const source of [captured.idle.diagnostics, aggregateDiagnostics(captured.matrix.rows), captured.mutationResult.diagnostics]) for (const key of Object.keys(releaseDiagnostics)) releaseDiagnostics[key].push(...source[key]);
  const environment = { chromeRevision: primary.browser.version, gitSha: primary.gitSha, bundleSha256: primary.product.bundleSha256, harnessSha256: await harnessSha256(), browserContract: captured.idle.browserContract };
  const releaseEvidence = {
    schemaVersion: 1, releaseRunId, startedAt: idleStartedAt, endedAt: captured.mutationEndedAt, environment,
    phases: {
      idle: { runId: idleRunId, startedAt: idleStartedAt, endedAt: captured.idleEndedAt, counterexample: captured.idle.counterexample, rows: captured.idle.rows },
      matrix: { runId: captured.matrixRunId, startedAt: captured.matrixStartedAt, endedAt: captured.matrixEndedAt, rows: captured.matrix.rows.map(combinedRow) },
      mutation: { runId: captured.mutationRunId, startedAt: captured.mutationStartedAt, endedAt: captured.mutationEndedAt, failure: missingHeavyFinding },
    },
    diagnostics: releaseDiagnostics, port: { number: 5190, listenersAfter: listeners() },
  };
  const releaseFailures = checkReleaseEvidence(releaseEvidence, environment);
  if (releaseFailures.length) throw new Error(releaseFailures.join('; '));
  await writeArtifact(releaseArtifactName, `${JSON.stringify(releaseEvidence, null, 2)}\n`);
  await writeArtifact(hashName, `${(await hashEntries(idleReleaseArtifactPaths())).join('\n')}\n`);
  await validateEvidence(run, false);
  const endedAt = captured.mutationEndedAt;
  const artifacts = artifactNames.map((name, index) => { const item = writtenArtifacts.get(name); if (!item) throw new Error('artifact set'); return { name, role: ['matrix-primary', 'matrix-projection', 'negative-projection', 'console-summary', 'continuous-screenshot', 'burst-screenshot', 'mutation-evidence', 'idle-evidence', 'release-evidence', 'artifact-manifest'][index], device: item.device, inode: item.inode, size: item.size, sha256: item.sha256 }; });
  await writeRunIndex(run, { schemaVersion: 1, issue: 'SIDPROJ-102', kind: 'idle-release', runId: run.runId, startedAt: idleStartedAt, endedAt, directory: { mode: '0700', ...run.directoryIdentity }, source: { gitSha: primary.gitSha, chromeRevision: primary.browser.version, bundleSha256: primary.product.bundleSha256, manifestSha256: await harnessSha256(), modules }, artifacts });
  await validateEvidence(run);
  console.log('CANVAS_LAB_V04_IDLE_BOUNDARY: PASS');
  console.log('CANVAS_LAB_V04: PASS');
  console.log('CANVAS_LAB_V04_MUTATION: EXPECTED FAIL missing heavy-canvas-work');
  console.log('CANVAS_LAB_V04_DISK_EVIDENCE: PASS');
  console.log(`SIDPROJ_102_IDLE_RELEASE_RUN_DIR: ${run.directory}`);
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'check') {
    await validateEvidence(useEvidenceRun(await releaseRunFromDirectory(args.directory)));
    console.log('CANVAS_LAB_V04_NEAREST_NEGATIVES: PASS');
    console.log('CANVAS_LAB_V04_VARIANTS: PASS');
    console.log('CANVAS_LAB_V04_MANIFEST: PASS');
  } else await idleRelease();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`CANVAS_LAB_V04: FAIL ${error.message}`); process.exitCode = 1; });
