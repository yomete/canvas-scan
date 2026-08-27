// Five baselines: valid, changed, incomplete, stale, and incomparable. Plus
// the two rules that matter more than any diff — no timing enters a baseline,
// and no report can say one recording was faster than another.
//
// Run: node --test corpus-baseline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { BaselineError, EXCLUDED_TIMING_FIELDS, buildBaseline, compareBaselines, onlyOrdinaryChanges, renderReport } from './corpus-baseline.mjs';

const refuses = pattern => error => error instanceof BaselineError && pattern.test(error.message);

const summary = (overrides = {}) => ({
  schemaVersion: 1,
  canvasScanVersion: '0.6.2',
  packageBundleSha256: 'a'.repeat(64),
  ranAt: '2026-08-27T10:00:00.000Z',
  entries: [
    {
      entryId: 'chartjs', commit: 'c'.repeat(40), buildArtifactSha256: '1'.repeat(64),
      status: 'useful-evidence', detail: { comparableShare: 0.9 },
      reportPath: '/tmp/corpus/chartjs/run-report.json',
      handoff: { jsonl: '/tmp/corpus/chartjs/handoff.jsonl', json: null },
    },
    {
      entryId: 'konva', commit: 'd'.repeat(40), buildArtifactSha256: '2'.repeat(64),
      status: 'honest-unknown', detail: { comparableShare: 0.1 },
      reportPath: '/tmp/corpus/konva/run-report.json',
      handoff: { jsonl: '/tmp/corpus/konva/handoff.jsonl', json: null },
    },
  ],
  ...overrides,
});

const handoffs = (types = ['repeated-draw-work'], dropped = ['session:canvasWindowReports']) => ({
  chartjs: [
    ...types.map(type => ({ kind: 'finding', type })),
    ...dropped.map(name => ({ kind: 'limit', scope: name.split(':')[0], name: name.split(':')[1] })),
    { kind: 'comparison', status: 'complete' },
  ],
  konva: [],
});

test('a baseline pins the package, the corpus commits, and the schemas', () => {
  const baseline = buildBaseline(summary(), handoffs());
  assert.equal(baseline.advisory, true);
  assert.equal(baseline.pins.canvasScanVersion, '0.6.2');
  assert.equal(baseline.pins.packageBundleSha256, 'a'.repeat(64));
  assert.equal(baseline.pins.corpusSchemaVersion, 1);
  assert.equal(baseline.pins.handoffSchemaVersion, 1);
  assert.deepEqual(Object.keys(baseline.pins.entries), ['chartjs', 'konva']);
  assert.equal(baseline.pins.entries.chartjs.commit, 'c'.repeat(40));
  assert.deepEqual(baseline.resultClasses[0].findingTypes, ['repeated-draw-work']);
  assert.equal(baseline.resultClasses[0].comparability, 'mostly-comparable');
  assert.equal(baseline.resultClasses[1].comparability, 'partly-comparable');
});

test('no timing field can enter a baseline', () => {
  assert.ok(EXCLUDED_TIMING_FIELDS.includes('canvasApiSelfTimeMs'));
  // A finding carries its self-time. The baseline takes the type and leaves
  // the milliseconds, because two browser runs differ by more than any change
  // worth reporting.
  const baseline = buildBaseline(summary(), { ...handoffs(), chartjs: [{ kind: 'finding', type: 'heavy-canvas-work', canvasApiSelfTimeMs: 9.9 }] });
  const serialized = JSON.stringify(baseline.resultClasses);
  assert.equal(serialized.includes('9.9'), false, 'a measured time reached the baseline');
  for (const field of EXCLUDED_TIMING_FIELDS) {
    assert.equal(serialized.includes(`"${field}"`), false, `${field} reached the baseline`);
  }
  assert.deepEqual(baseline.resultClasses[0].findingTypes, ['heavy-canvas-work']);
  // The run summary's own timing never travels either: a result class carries
  // named fields rather than spreading whatever detail the run collected.
  const leaky = summary();
  leaky.entries[0] = { ...leaky.entries[0], detail: { comparableShare: 0.9, durationMs: 1234 } };
  assert.equal(JSON.stringify(buildBaseline(leaky, handoffs())).includes('1234'), false);
});

test('a valid, unchanged pair reports no structural change', () => {
  const baseline = buildBaseline(summary(), handoffs());
  const diff = compareBaselines(baseline, buildBaseline(summary(), handoffs()));
  assert.equal(diff.status, 'comparable');
  assert.deepEqual(diff.reasons, []);
  assert.deepEqual(diff.changed, []);
  assert.match(renderReport(diff), /No structural change/);
  assert.match(renderReport(diff), /Advisory/);
});

test('reports added, removed, and changed result classes with links to the evidence', () => {
  const before = buildBaseline(summary(), handoffs());
  const after = buildBaseline(
    summary({ entries: [...summary().entries, { entryId: 'excalidraw', commit: 'e'.repeat(40), buildArtifactSha256: '3'.repeat(64), status: 'useful-evidence', detail: { comparableShare: 0.4 }, reportPath: '/tmp/corpus/excalidraw/run-report.json', handoff: { jsonl: '/tmp/corpus/excalidraw/handoff.jsonl' } }] }),
    { ...handoffs(['repeated-draw-work', 'resize-churn'], ['session:canvasWindowReports', 'session:resetEvents']), excalidraw: [] },
  );
  const diff = compareBaselines(before, after);
  assert.equal(diff.status, 'comparable');
  assert.deepEqual(diff.added, ['excalidraw']);
  assert.deepEqual(diff.removed, []);
  const [changed] = diff.changed;
  assert.equal(changed.entryId, 'chartjs');
  assert.deepEqual(changed.differences.map(item => item.field).sort(), ['droppedKinds', 'findingCount', 'findingTypes']);
  // A change without its evidence is a rumour.
  const report = renderReport(diff);
  assert.match(report, /report: \/tmp\/corpus\/chartjs\/run-report\.json/);
  assert.match(report, /handoff: \/tmp\/corpus\/chartjs\/handoff\.jsonl/);
  assert.match(report, /\+ excalidraw is new in this run/);
  assert.equal(onlyOrdinaryChanges(diff), false);

  // An ordinary finding-count change on its own stays ordinary, so the default
  // job has nothing to escalate.
  const countOnly = compareBaselines(before, buildBaseline(summary(), handoffs(['repeated-draw-work', 'repeated-draw-work'])));
  assert.deepEqual(countOnly.changed[0].differences.map(item => item.field), ['findingCount']);
  assert.equal(onlyOrdinaryChanges(countOnly), true);
});

test('an incomplete run is a hole in the comparison, not a change', () => {
  const before = buildBaseline(summary(), handoffs());
  const broken = summary();
  broken.entries[0] = { ...broken.entries[0], status: 'setup-failed', detail: { setupStep: 'npm run build' } };
  const diff = compareBaselines(before, buildBaseline(broken, handoffs()));
  assert.equal(diff.status, 'invalid');
  assert.ok(diff.reasons.some(reason => /chartjs did not produce a sound run \(setup-failed\)/.test(reason)));
  assert.deepEqual(diff.incomplete.map(item => item.entryId), ['chartjs']);
  assert.match(renderReport(diff), /This comparison is not valid/);
  assert.match(renderReport(diff), /\? chartjs did not complete \(setup-failed\)/);

  // A declared-unavailable entry is reported as incomplete but does not make
  // the comparison invalid: the entry said in advance this could happen.
  const unavailable = summary();
  unavailable.entries[1] = { ...unavailable.entries[1], status: 'declared-unavailable', detail: {} };
  const softer = compareBaselines(before, buildBaseline(unavailable, handoffs()));
  assert.equal(softer.status, 'comparable');
  assert.deepEqual(softer.incomplete.map(item => item.entryId), ['konva']);
});

test('a stale baseline is invalid rather than diffed', () => {
  const before = buildBaseline(summary(), handoffs());
  // A different package.
  const newVersion = compareBaselines(before, buildBaseline(summary({ canvasScanVersion: '0.7.0' }), handoffs()));
  assert.equal(newVersion.status, 'invalid');
  assert.ok(newVersion.reasons.some(reason => /canvas-scan moved from 0\.6\.2 to 0\.7\.0/.test(reason)));
  // A different bundle of the same version.
  const newBundle = compareBaselines(before, buildBaseline(summary({ packageBundleSha256: 'b'.repeat(64) }), handoffs()));
  assert.ok(newBundle.reasons.includes('the package bundle changed'));
  // A moved corpus pin.
  const moved = summary();
  moved.entries[0] = { ...moved.entries[0], commit: 'f'.repeat(40) };
  assert.ok(compareBaselines(before, buildBaseline(moved, handoffs())).reasons.some(reason => /chartjs is pinned to a different commit/.test(reason)));
  // A rebuilt artifact at the same commit.
  const rebuilt = summary();
  rebuilt.entries[0] = { ...rebuilt.entries[0], buildArtifactSha256: '9'.repeat(64) };
  assert.ok(compareBaselines(before, buildBaseline(rebuilt, handoffs())).reasons.some(reason => /chartjs built a different artifact/.test(reason)));
});

test('a missing entry makes the comparison incomparable', () => {
  const before = buildBaseline(summary(), handoffs());
  const after = buildBaseline(summary({ entries: [summary().entries[0]] }), handoffs());
  const diff = compareBaselines(before, after);
  assert.equal(diff.status, 'invalid');
  assert.deepEqual(diff.removed, ['konva']);
  assert.ok(diff.reasons.includes('konva is missing from this run'));
  assert.match(renderReport(diff), /- konva is missing from this run/);
  const schemaDrift = compareBaselines(before, { ...after, schemaVersion: 2 });
  assert.ok(schemaDrift.reasons.some(reason => /baseline schema moved from 1 to 2/.test(reason)));
  assert.throws(() => compareBaselines(before, {}), refuses(/no schema version/));
});

test('no report can say faster, slower, fixed, improved, or regressed', () => {
  for (const word of ['faster', 'slower', 'fixed', 'improved', 'regressed']) {
    assert.throws(
      () => renderReport({ status: 'comparable', advisory: true, reasons: [], added: [], removed: [], incomplete: [], changed: [{ entryId: 'chartjs', differences: [{ field: 'note', from: 'a', to: word }] }] }),
      refuses(new RegExp(word)),
      `${word} was allowed into a report`,
    );
  }
  // And it never leaks in through a reason either.
  assert.throws(
    () => renderReport({ status: 'invalid', advisory: true, reasons: ['chartjs got faster'], added: [], removed: [], incomplete: [], changed: [] }),
    refuses(/faster/),
  );
});
