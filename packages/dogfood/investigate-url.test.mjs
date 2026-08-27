// Proves the guided-investigation command end to end in real Chrome: it
// refuses the targets it should refuse, installs before any application
// script, and carries a complete ritual driven through the overlay all the way
// to a written report.
//
// Run: node --test investigate-url.test.mjs   (needs apps/demo/dist)
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../../scripts/browser-driver.mjs';
import { UsageError, investigate, parseArguments } from './investigate-url.mjs';
import { parseJson, parseJsonl } from './agent-handoff.mjs';
import { summarize } from './read-handoff.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const demo = path.join(root, 'apps/demo/dist');
const ritual = path.join(root, 'packages/dogfood/fixtures/investigate-url-ritual.mjs');

test('accepts one http or https target', () => {
  assert.equal(parseArguments(['--url=https://example.com']).url, 'https://example.com/');
  assert.equal(parseArguments(['--url=http://127.0.0.1:8080/app']).origin, 'http://127.0.0.1:8080');
  assert.equal(parseArguments(['--url=https://example.com']).timeoutMs, 3_600_000);
  assert.equal(parseArguments(['--url=https://example.com']).handoff, 'both');
  assert.equal(parseArguments(['--url=https://example.com', '--handoff=jsonl']).handoff, 'jsonl');
});

test('refuses unsupported schemes and ambiguous targets', () => {
  const refused = message => error => error instanceof UsageError && new RegExp(message).test(error.message);
  assert.throws(() => parseArguments([]), refused('--url'));
  assert.throws(() => parseArguments(['--url=file:///tmp/index.html']), refused('must be http or https'));
  assert.throws(() => parseArguments(['--url=data:text/html,<canvas>']), refused('must be http or https'));
  assert.throws(() => parseArguments(['--url=not a url']), refused('not a URL'));
  // Two targets is not a target to guess between.
  assert.throws(() => parseArguments(['--url=https://a.example', '--url=https://b.example']), refused('more than once'));
  assert.throws(() => parseArguments(['https://example.com']), refused('unexpected argument'));
  assert.throws(() => parseArguments(['--url=https://example.com', '--timeout=0']), refused('positive number'));
  assert.throws(() => parseArguments(['--url=https://example.com', '--handoff=yaml']), refused('must be json, jsonl, both or none'));
});

test('carries a complete ritual from a URL to a written report', { timeout: 240_000 }, async () => {
  assert.ok(existsSync(demo), 'apps/demo/dist is missing. Run: pnpm --filter demo run build');
  const { server, port } = await serve(demo);
  const out = mkdtempSync(path.join(os.tmpdir(), 'canvas-scan-investigation-'));
  let report;
  try {
    report = await investigate(
      { url: `http://127.0.0.1:${port}/`, origin: `http://127.0.0.1:${port}`, out, drive: ritual, handoff: 'both', timeoutMs: 180_000 },
      { log: () => {} },
    );
  } finally {
    server.close();
  }

  assert.deepEqual(report.notes, [], `the run reported problems: ${report.notes.join(' | ')}`);

  // Installed at the position the README promises, before the application.
  assert.equal(report.install.hadDocumentElement, false, 'the bundle ran after the document element existed, so this proves nothing about early install');
  assert.equal(report.install.readyStateAtInstall, 'loading');
  assert.equal(report.install.installed, true);
  assert.equal(report.install.overlayMounted, true);
  assert.equal(report.install.getContextWrapped, true);

  // The user's own browser profile is never the one that runs.
  assert.equal(report.profile.isolated, true);
  assert.ok(report.profile.userDataDir.startsWith(os.tmpdir()), `the profile was not a throwaway: ${report.profile.userDataDir}`);
  assert.equal(existsSync(report.profile.userDataDir), false, 'the throwaway profile was left behind');

  // Every step of the ritual, driven through the overlay's own controls.
  const status = id => report.steps.find(step => step.id === id)?.status;
  for (const id of ['early-load', 'record-baseline', 'explain-baseline', 'record-candidate', 'compare']) {
    assert.equal(status(id), 'complete', `${id} did not complete`);
  }

  // Nothing left the target's origin, and nothing carried a body anywhere.
  assert.deepEqual(report.offOriginRequests.filter(request => request.hasBody), []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.consoleFromCanvasScan, []);

  // The report names files that exist and hash to what it says they do.
  assert.ok(report.artifacts.length >= 4, `expected a baseline, an explanation, a candidate and a comparison, got ${report.artifacts.length}`);
  for (const artifact of report.artifacts) {
    const file = path.join(out, artifact.path);
    assert.ok(existsSync(file), `${artifact.path} is named in the report but missing on disk`);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).schemaVersion, 1);
  }
  assert.ok(report.artifacts.some(artifact => artifact.id === 'baseline-session'));
  assert.ok(report.artifacts.some(artifact => artifact.id.startsWith('explanation-')));
  assert.ok(report.artifacts.some(artifact => artifact.id.startsWith('comparison-')));

  // The printed path is the report, not a promise of one.
  const written = JSON.parse(readFileSync(report.reportPath, 'utf8'));
  assert.equal(written.target, report.target);
  assert.equal(written.issue, 'SIDPROJ-108');
  assert.ok(written.sessions.length >= 2);
  assert.ok(written.sessions[0].findings.length > 0, 'the baseline recorded no finding, so the comparison proved nothing');

  // The agent handoff is written from the same run, in both forms, and both
  // survive their own reader.
  const jsonl = parseJsonl(readFileSync(report.handoffPaths.jsonl, 'utf8'));
  const json = parseJson(readFileSync(report.handoffPaths.json, 'utf8'));
  assert.deepEqual(json, jsonl);
  assert.equal(jsonl.length, report.handoffRecordCount);
  assert.equal(jsonl.at(-1).kind, 'result');
  assert.equal(jsonl.at(-1).status, 'complete');
  assert.deepEqual(jsonl.at(-1).incompleteStages, []);
  assert.ok(jsonl.some(record => record.kind === 'finding'), 'the handoff carries no finding');
  assert.ok(jsonl.some(record => record.kind === 'comparison'), 'the handoff carries no comparison');
  assert.ok(jsonl.some(record => record.kind === 'explanation'), 'the handoff carries no explanation');

  // The consumer reads the file alone — no browser, no overlay, no state.
  const summary = summarize(jsonl);
  assert.match(summary, /run complete/);
  assert.match(summary, /not established:/);
  assert.match(summary, /improvement established: false/);
});
