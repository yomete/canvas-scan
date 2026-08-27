// The corpus manifest and its checker. No network, no clone, no build — this
// is the part that must hold before anything is run, and it is what keeps a
// broken third-party build from ever reading as a clean canvas-scan result.
//
// Run: node --test corpus-check.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CorpusError, checkManifest, checkOutcomes, classifyOutcome } from './corpus-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = path.join(here, 'corpus');
const manifest = JSON.parse(readFileSync(path.join(corpus, 'manifest.json'), 'utf8'));
const refuses = pattern => error => error instanceof CorpusError && pattern.test(error.message);
const entry = manifest.entries[0];

const session = (findings, statuses) => ({
  findings,
  canvases: [{ commandStatuses: statuses }],
});

test('the shipped manifest pins three distinct applications', () => {
  assert.equal(checkManifest(manifest), manifest);
  assert.equal(manifest.entries.length, 3);
  assert.deepEqual(manifest.entries.map(item => item.id), ['chartjs', 'konva', 'excalidraw']);
  for (const item of manifest.entries) {
    assert.match(item.commit, /^[0-9a-f]{40}$/, `${item.id} is not pinned to a commit`);
    assert.ok(item.stopConditions.length >= 3, `${item.id} declares too few stop conditions`);
    assert.ok(item.interactionDescription.length > 20, `${item.id} does not describe its interaction`);
    assert.ok(existsSync(path.join(corpus, 'interactions', item.interaction)), `${item.id} names a missing interaction module`);
    if (item.page !== null) assert.ok(existsSync(path.join(corpus, 'pages', item.page)), `${item.id} names a missing page`);
  }
});

test('the manifest refuses a moving target or a single design', () => {
  const withTag = { ...manifest, entries: [{ ...entry, commit: 'v4.5.1' }, ...manifest.entries.slice(1)] };
  assert.throws(() => checkManifest(withTag), refuses(/not pinned to a full commit/));
  const oneDesign = { ...manifest, entries: manifest.entries.map(item => ({ ...item, design: 'charting' })) };
  assert.throws(() => checkManifest(oneDesign), refuses(/1 distinct canvas designs/));
  assert.throws(() => checkManifest({ ...manifest, entries: manifest.entries.slice(0, 2) }), refuses(/at least three applications/));
  assert.throws(() => checkManifest({ ...manifest, externalValidity: 'product-truth' }), refuses(/must be labelled external-only/));
  const { stopConditions, ...withoutStopConditions } = entry;
  assert.throws(() => checkManifest({ ...manifest, entries: [withoutStopConditions, ...manifest.entries.slice(1)] }), refuses(/missing stopConditions/));
  assert.throws(() => checkManifest({ ...manifest, entries: [{ ...entry, stopConditions: [] }, ...manifest.entries.slice(1)] }), refuses(/defines no stop conditions/));
});

test('a failed setup can never read as a clean canvas-scan result', () => {
  const outcome = classifyOutcome(entry, { setup: { ok: false, step: 'npm run build', reason: 'the setup step `npm run build` failed' } });
  assert.equal(outcome.status, 'setup-failed');
  assert.equal(outcome.detail.setupStep, 'npm run build');
  // The gate refuses even a well-formed setup failure if its wording would let
  // a reader take it for health.
  assert.throws(() => checkOutcomes([{ ...outcome, reason: 'no findings' }]), refuses(/failed setup but reads like a clean result/));
  // And a setup failure is never accepted evidence.
  assert.deepEqual(checkOutcomes([outcome]).accepted, []);
  assert.deepEqual(checkOutcomes([outcome]).unsound, [outcome]);
});

test('separates useful evidence, honest unknown, and a declared unavailable state', () => {
  const useful = classifyOutcome(entry, {
    setup: { ok: true }, run: { ok: true },
    session: session([{ type: 'repeated-draw-work' }], { same: 40, changed: 50, unknown: 10 }),
  });
  assert.equal(useful.status, 'useful-evidence');
  assert.deepEqual(useful.detail.findingTypes, ['repeated-draw-work']);

  // No findings with most windows comparable is a real answer, not a gap.
  const quiet = classifyOutcome(entry, { setup: { ok: true }, run: { ok: true }, session: session([], { same: 80, changed: 10, unknown: 10 }) });
  assert.equal(quiet.status, 'useful-evidence');
  assert.match(quiet.reason, /the application was observed and had nothing to report/);

  // No findings with almost nothing comparable is the tool saying it could not
  // tell, which must never be dressed up as health.
  const unknown = classifyOutcome(entry, { setup: { ok: true }, run: { ok: true }, session: session([], { same: 5, changed: 5, unknown: 90 }) });
  assert.equal(unknown.status, 'honest-unknown');
  assert.match(unknown.reason, /only 10% of 100 windows could be compared/);

  const unavailable = classifyOutcome(entry, {
    setup: { ok: true },
    run: { ok: false, reason: 'the run stopped early', stopCondition: 'the guided run reports a note' },
  });
  assert.equal(unavailable.status, 'declared-unavailable');
  assert.equal(unavailable.detail.stopCondition, 'the guided run reports a note');

  // An undeclared failure is not allowed to borrow a stop condition.
  const surprise = classifyOutcome(entry, { setup: { ok: true }, run: { ok: false, reason: 'something else', stopCondition: null } });
  assert.equal(surprise.status, 'run-failed');

  const { accepted, unsound } = checkOutcomes([useful, quiet, unknown, unavailable, surprise]);
  assert.deepEqual(accepted.map(item => item.status), ['useful-evidence', 'useful-evidence', 'honest-unknown', 'declared-unavailable']);
  assert.deepEqual(unsound.map(item => item.status), ['run-failed']);
});

test('every outcome carries its external-validity label and no authority', () => {
  const outcome = classifyOutcome(entry, { setup: { ok: true }, run: { ok: true }, session: session([{ type: 'heavy-canvas-work' }], { same: 10, changed: 0, unknown: 0 }) });
  assert.equal(outcome.externalValidity, 'external-only');
  assert.equal(outcome.blocksRelease, false);
  assert.equal(outcome.definesProductTruth, false);
  assert.equal(outcome.createsUpstreamAction, false);
  assert.throws(() => checkOutcomes([{ ...outcome, blocksRelease: true }]), refuses(/claims an authority the corpus does not have/));
  assert.throws(() => checkOutcomes([{ ...outcome, definesProductTruth: true }]), refuses(/claims an authority/));
  assert.throws(() => checkOutcomes([{ ...outcome, createsUpstreamAction: true }]), refuses(/claims an authority/));
  assert.throws(() => checkOutcomes([{ ...outcome, externalValidity: 'product-truth' }]), refuses(/not labelled external-only/));
  assert.throws(() => checkOutcomes([{ ...outcome, status: 'passed' }]), refuses(/unknown corpus outcome "passed"/));
});

test('the corpus opens no upstream action', () => {
  // Nothing in the corpus may push, open a pull request, or file an issue. A
  // grep is a blunt check and exactly the right one: it fails when someone
  // adds the capability, not when they use it.
  for (const file of ['corpus-run.mjs', 'corpus-check.mjs']) {
    const source = readFileSync(path.join(here, file), 'utf8');
    for (const forbidden of ['git push', 'gh pr', 'gh issue', 'pulls', 'api.github.com']) {
      assert.ok(!source.includes(forbidden), `${file} mentions ${forbidden}; the corpus creates no upstream action`);
    }
  }
});
