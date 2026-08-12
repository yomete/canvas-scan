import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { expectedMatrix, sessionFor } from './session-comparison-fixture.mjs';
import { checkEvidence, recompute } from './session-comparison-truth.mjs';

execFileSync('pnpm', ['--filter', 'canvas-scan', 'run', 'build'], { stdio: 'inherit' });
const { createEvidence } = await import('./session-comparison-probe.mjs');
const stable = value => `${JSON.stringify(value, null, 2)}\n`;
const sha = value => createHash('sha256').update(value).digest('hex');

function evidence() { const directory = mkdtempSync(join(tmpdir(), 'sidproj-64-truth-')); createEvidence(directory); return directory; }
function jsonFiles(directory, relative = '') {
  const result = [];
  for (const item of readdirSync(join(directory, relative), { withFileTypes: true })) {
    const path = `${relative}${item.name}`;
    if (item.isDirectory()) result.push(...jsonFiles(directory, `${path}/`));
    else if (path.endsWith('.json')) result.push(path);
  }
  return result.sort();
}
function refreshManifest(directory) {
  const lines = jsonFiles(directory).map(path => `${sha(readFileSync(join(directory, path)))}  ${path}`);
  writeFileSync(join(directory, 'evidence-sha256.txt'), `${lines.join('\n')}\n`);
}
function mutate(directory, path, change, refresh = true) {
  const target = join(directory, path); const value = JSON.parse(readFileSync(target, 'utf8'));
  change(value); writeFileSync(target, stable(value)); if (refresh) refreshManifest(directory);
}
function row(id) { return expectedMatrix.rows.find(value => value.id === id); }

test('accepts valid complete evidence and preserves variant structural deltas', () => {
  const directory = evidence();
  try { assert.equal(checkEvidence(directory), true); } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const [name, path, change] of [
  ['measure value', 'artifacts/heavy-work.json', value => { value.measures[0].candidate++; }],
  ['delta', 'artifacts/heavy-work.json', value => { value.measures[0].delta++; }],
  ['direction', 'artifacts/heavy-work.json', value => { value.measures[0].direction = 'increased'; }],
  ['interpretation', 'artifacts/heavy-work.json', value => { value.measures[2].interpretation = 'structural'; }],
  ['method order', 'artifacts/heavy-work.json', value => { [value.measures[4], value.measures[6]] = [value.measures[6], value.measures[4]]; }],
  ['reason', 'artifacts/finding-type-mismatch.json', value => { value.incomparableReasons = ['incomplete-evidence']; }],
  ['pairing index', 'artifacts/heavy-work.json', value => { value.baseline.findingIndex = 4; }],
  ['raw session input', 'inputs/heavy-work-baseline.json', value => { value.sessionId = 'forged'; }],
  ['expected matrix', 'expected-results.json', value => { value.rows.pop(); }],
  ['variant metadata', 'inputs/session-identities-baseline.json', value => { value.canvases[0].canvasId = 'forged'; }],
  ['artifact set', 'actual-results.json', value => { value.pop(); }],
  ['extra claim field', 'artifacts/heavy-work.json', value => { value.improved = true; }],
  ['Git SHA', 'run-metadata.json', value => { value.gitCommit = '0'.repeat(40); }],
  ['bundle hash', 'run-metadata.json', value => { value.bundleSha256 = '0'.repeat(64); }],
]) {
  test(`rejects a forged ${name} after hashes are refreshed`, () => {
    const directory = evidence();
    try { mutate(directory, path, change); assert.throws(() => checkEvidence(directory), /session comparison evidence failed/); } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}

test('rejects both forged worktree status strings after hashes are refreshed', () => {
  const directory = evidence();
  try {
    mutate(directory, 'run-metadata.json', value => { value.initialStatus = 'forged\n'; value.finalStatus = 'forged\n'; });
    assert.throws(() => checkEvidence(directory), /session comparison evidence failed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('rejects a forged evidence hash', () => {
  const directory = evidence();
  try {
    writeFileSync(join(directory, 'evidence-sha256.txt'), 'forged  expected-results.json\n');
    assert.throws(() => checkEvidence(directory), /session comparison evidence failed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('recomputes all incomparable reasons with exact precedence', () => {
  const heavy = row('heavy-work'); const baseline = sessionFor(heavy, 0); const candidate = sessionFor(heavy, 1);
  assert.deepEqual(recompute(heavy, { ...baseline, schemaVersion: 2 }, candidate).incomparableReasons, ['unsupported-schema']);
  assert.deepEqual(recompute({ ...heavy, baselineFindingIndex: 99 }, baseline, candidate).incomparableReasons, ['finding-not-found']);
  assert.deepEqual(recompute({ ...heavy, candidateFindingIndex: 0 }, baseline, sessionFor(row('repeated-work'), 1)).incomparableReasons, ['finding-type-mismatch']);
  const incomplete = structuredClone(baseline); incomplete.findings[0].topMethods = null;
  assert.deepEqual(recompute(heavy, incomplete, candidate).incomparableReasons, ['incomplete-evidence']);
});

for (const [name, change] of [
  ['missing methods', value => { value.canvases[0].methodEvidence = null; }],
  ['invalid maximum window', value => { value.findings[0].maximumWindow.timestampMs = Number.NaN; }],
  ['invalid selected canvas', value => { value.canvases[0].activeWindowCount = 1.5; }],
  ['required drops', value => { value.droppedEntryCounts.canvasWindowReports = 1; }],
]) {
  test(`recomputes malformed ${name} as incomplete evidence without throwing`, () => {
    const selectedRow = row('heavy-work'); const baseline = sessionFor(selectedRow, 0); const candidate = sessionFor(selectedRow, 1); change(baseline);
    assert.doesNotThrow(() => recompute(selectedRow, baseline, candidate));
    assert.deepEqual(recompute(selectedRow, baseline, candidate).incomparableReasons, ['incomplete-evidence']);
  });
}

test('controlled variants change only their named raw-input factors', () => {
  const baseRow = row('repeated-work'); const base = sessionFor(baseRow, 0);
  const identitiesRow = row('session-identities'); const identities = sessionFor(identitiesRow, 0);
  assert.notEqual(identities.sessionId, base.sessionId);
  assert.notEqual(identities.findings[0].canvasId, base.findings[0].canvasId);
  assert.notEqual(identities.findings[0].episodeId, base.findings[0].episodeId);

  const orderRow = row('canvas-creation-order'); const order = sessionFor(orderRow, 0);
  assert.equal(orderRow.baselineFindingIndex, 1); assert.equal(order.findings[1].type, base.findings[0].type); assert.equal(order.canvases[1].canvasId, base.canvases[0].canvasId);

  const unrelatedRow = row('unrelated-canvas-work'); const unrelated = sessionFor(unrelatedRow, 0);
  assert.notDeepEqual(unrelated, order); assert.equal(unrelated.windows.length, 1); assert.deepEqual(Object.keys(unrelated.canvases[0].methodEvidence), ['clearRect']);

  const artifacts = [identitiesRow, orderRow, unrelatedRow].map(value => recompute(value, sessionFor(value, 0), sessionFor(value, 1)).measures);
  assert.deepEqual(artifacts[0], artifacts[1]); assert.deepEqual(artifacts[1], artifacts[2]);
});
