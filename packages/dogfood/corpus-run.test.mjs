// Proves the corpus runner's whole pipeline — clone at a pinned commit,
// build, serve, guided run, classify — against a repository made for the test.
//
// A local repository is the point, not a shortcut. It removes the network and
// the three third-party build systems from the question, so a failure here is
// the runner's and nothing else's. The three real applications are exercised by
// `pnpm --filter dogfood run corpus`, which needs the network.
//
// Run: node --test corpus-run.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEntry } from './corpus-run.mjs';
import { checkOutcomes } from './corpus-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

// A source file that a "build" step turns into the served library, so the
// runner's build and artifact checks have something real to do.
const SOURCE = `
window.startCorpusFixture = () => {
  const canvas = document.getElementById('plot');
  canvas.width = 600; canvas.height = 300;
  const context = canvas.getContext('2d');
  const draw = () => {
    for (let index = 0; index < 120; index++) context.fillRect((index % 60) * 10, (index % 30) * 10, 8, 8);
    for (let index = 0; index < 40; index++) context.getImageData(0, 0, 600, 300);
    requestAnimationFrame(draw);
  };
  draw();
};
`;

function makeRepository() {
  const repository = mkdtempSync(path.join(os.tmpdir(), 'canvas-scan-corpus-repo-'));
  const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' });
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Corpus Fixture');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(repository, 'source.js'), SOURCE);
  // The "build": copy source to dist. Trivial on purpose — what is under test
  // is that the runner runs it, checks its artifact, and hashes it.
  writeFileSync(path.join(repository, 'build.sh'), 'mkdir -p dist && cp source.js dist/library.js\n');
  git('add', '.');
  git('commit', '--quiet', '--no-gpg-sign', '-m', 'fixture');
  return { repository, commit: git('rev-parse', 'HEAD').trim() };
}

test('carries one corpus entry from a pinned commit to a classified outcome', { timeout: 240_000 }, async () => {
  assert.ok(existsSync(path.join(root, 'packages/core/dist/canvas-scan.iife.js')), 'build the bundle first: pnpm --filter canvas-scan run build');
  const { repository, commit } = makeRepository();
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'canvas-scan-corpus-out-'));
  const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'canvas-scan-corpus-cache-'));
  const entry = {
    id: 'fixture',
    title: 'a repository made for this test',
    repository,
    commit,
    ref: 'main',
    design: 'a fixture that draws every frame',
    setup: [['sh', ['build.sh']]],
    buildArtifact: 'dist/library.js',
    page: 'corpus-fixture.html',
    interaction: 'corpus-fixture.mjs',
    interactionDescription: 'Let the fixture draw for four seconds while a recording runs.',
    expectedSupport: { canvasCount: { minimum: 1 }, commandStatuses: { sameOrChangedShareAtLeast: 0.5 }, findingTypes: ['heavy-canvas-work'] },
    stopConditions: ['the build does not produce dist/library.js', 'no canvas is present after the page settles', 'the guided run reports a note'],
    evidenceBudget: { setupSeconds: 120, runSeconds: 120 },
  };

  const result = await runEntry(entry, { outDir, cacheDir, log: () => {} });

  assert.equal(result.setup.ok, true, `setup failed: ${result.setup.reason}`);
  // Provenance: the commit the run actually used, and the hash of what it built.
  assert.equal(result.setup.applicationCommit, commit);
  assert.match(result.setup.buildArtifactSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(result.setup.commands.map(command => command.step), ['clone', 'fetch', 'checkout', 'sh build.sh']);

  assert.equal(result.run.ok, true, `run failed: ${result.run?.reason}`);
  assert.equal(result.outcome.status, 'useful-evidence', result.outcome.reason);
  assert.equal(result.outcome.externalValidity, 'external-only');
  assert.equal(result.outcome.blocksRelease, false);
  assert.equal(result.outcome.createsUpstreamAction, false);
  assert.deepEqual(checkOutcomes([result.outcome]).unsound, []);

  // Every run saves the handoff, and it names the pinned application commit's
  // own build rather than some other checkout.
  assert.ok(existsSync(result.report.handoffPaths.jsonl), 'the run saved no handoff');
  assert.ok(existsSync(result.report.handoffPaths.json), 'the run saved no handoff');
});

test('a build that produces nothing is a setup failure, not a clean result', { timeout: 240_000 }, async () => {
  const { repository, commit } = makeRepository();
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'canvas-scan-corpus-out-'));
  const cacheDir = mkdtempSync(path.join(os.tmpdir(), 'canvas-scan-corpus-cache-'));

  const entry = {
    id: 'fixture-broken',
    title: 'a repository whose build produces nothing',
    repository,
    commit,
    ref: 'main',
    design: 'a fixture with a broken build',
    // Runs, exits 0, writes nothing where the entry says to look.
    setup: [['sh', ['-c', 'true']]],
    buildArtifact: 'dist/library.js',
    page: 'corpus-fixture.html',
    interaction: 'corpus-fixture.mjs',
    interactionDescription: 'Never reached: the build produced nothing.',
    expectedSupport: { canvasCount: { minimum: 1 }, commandStatuses: {}, findingTypes: [] },
    stopConditions: ['the build does not produce dist/library.js'],
    evidenceBudget: { setupSeconds: 120, runSeconds: 120 },
  };

  const result = await runEntry(entry, { outDir, cacheDir, log: () => {} });
  assert.equal(result.outcome.status, 'setup-failed');
  assert.match(result.outcome.reason, /did not produce dist\/library\.js/);
  // No browser was ever opened, and nothing about canvas-scan is claimed.
  assert.equal(result.report, null);
  assert.deepEqual(checkOutcomes([result.outcome]).accepted, []);
});
