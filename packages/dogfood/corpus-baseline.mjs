// Advisory baseline comparison over the pinned external corpus.
//
// What it compares: structural result classes. Which entries produced evidence,
// what kinds of finding, what the tool could and could not compare, what a
// collection limit dropped. Structure is stable enough that a change in it
// means something.
//
// What it never compares: time. Not one millisecond enters a baseline, because
// two browser runs on two machines differ by more than any change worth
// reporting, and a difference between one recording and one other recording is
// not evidence of a faster or slower anything. The vocabulary is enforced, not
// merely intended: the renderer refuses to emit a report containing "faster",
// "slower", "fixed", "improved" or "regressed".
//
// It is advisory in this version and says so on every report. An ordinary
// change in finding count is something to look at, not something to fail a
// build over — especially when the applications belong to other people.
//
// Usage:
//   node corpus-baseline.mjs --run=DIR/corpus-run.json --baseline=FILE [--write]
import { readFileSync, writeFileSync } from 'node:fs';

export const BASELINE_SCHEMA_VERSION = 1;
export const ADVISORY_NOTE = 'Advisory. A change here is something to read, not a build failure, and the corpus never defines product truth.';

// Named so the exclusion is a rule with a test behind it rather than an
// omission somebody restores by accident.
export const EXCLUDED_TIMING_FIELDS = Object.freeze([
  'canvasApiSelfTimeMs', 'maxWindowSelfTimeMs', 'durationMs', 'timestampMs',
  'startedAtTimestampMs', 'endedAtTimestampMs', 'blockingDurationMs', 'ranAt',
]);

// The words a timing pair could tempt a report into. None of them can be said
// from two recordings, so none of them can be written at all.
const FORBIDDEN_WORDS = /\b(faster|slower|fixed|improved|regressed|regression|speedup|slowdown)\b/i;

export class BaselineError extends Error {}
const fail = message => { throw new BaselineError(message); };

const sorted = values => [...new Set(values)].sort();

// One entry's structural result class. Everything here is a name or a count of
// kinds — never a measurement.
export function resultClass(entry, handoffRecords = []) {
  const findings = handoffRecords.filter(record => record.kind === 'finding');
  const limits = handoffRecords.filter(record => record.kind === 'limit');
  const comparisons = handoffRecords.filter(record => record.kind === 'comparison');
  return {
    entryId: entry.entryId,
    status: entry.status,
    applicationCommit: entry.applicationCommit,
    findingTypes: sorted(findings.map(finding => finding.type)),
    findingCount: findings.length,
    // Whether anything was comparable at all, as a class rather than a ratio:
    // "the tool could tell" and "the tool could not tell" are different
    // answers; 62% against 64% is not.
    comparability: entry.detail?.comparableShare === undefined ? 'unmeasured'
      : entry.detail.comparableShare >= 0.5 ? 'mostly-comparable'
        : entry.detail.comparableShare > 0 ? 'partly-comparable' : 'not-comparable',
    droppedKinds: sorted(limits.map(limit => `${limit.scope}:${limit.name}`)),
    comparisonStatuses: sorted(comparisons.map(comparison => comparison.status)),
    reportPath: entry.reportPath ?? null,
    handoffPath: entry.handoff?.jsonl ?? entry.handoff?.json ?? null,
  };
}

function assertNoTiming(value, path = 'baseline') {
  if (Array.isArray(value)) { value.forEach((item, index) => assertNoTiming(item, `${path}[${index}]`)); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (EXCLUDED_TIMING_FIELDS.includes(key)) fail(`${path}.${key} is a timing field and must not enter a baseline`);
    assertNoTiming(item, `${path}.${key}`);
  }
}

export function buildBaseline(summary, handoffsByEntry = {}) {
  const baseline = {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    issue: 'SIDPROJ-112',
    advisory: true,
    // The pins. A comparison across different pins is not a comparison, and
    // saying which pin moved is more useful than any diff of the results.
    pins: {
      canvasScanVersion: summary.canvasScanVersion,
      packageBundleSha256: summary.packageBundleSha256,
      corpusSchemaVersion: summary.schemaVersion,
      handoffSchemaVersion: 1,
      entries: Object.fromEntries(summary.entries.map(entry => [entry.entryId, { commit: entry.commit, buildArtifactSha256: entry.buildArtifactSha256 }])),
    },
    resultClasses: summary.entries.map(entry => resultClass(entry, handoffsByEntry[entry.entryId] ?? [])),
  };
  assertNoTiming(baseline.resultClasses);
  return baseline;
}

// Any of these makes the comparison meaningless rather than interesting. They
// are reported as invalid, never as a change, because a changed pin explains
// every difference underneath it and a diff would only distract.
function invalidities(previous, current) {
  const reasons = [];
  if (previous.schemaVersion !== current.schemaVersion) reasons.push(`the baseline schema moved from ${previous.schemaVersion} to ${current.schemaVersion}`);
  for (const key of ['corpusSchemaVersion', 'handoffSchemaVersion']) {
    if (previous.pins[key] !== current.pins[key]) reasons.push(`the ${key} moved from ${previous.pins[key]} to ${current.pins[key]}`);
  }
  if (previous.pins.canvasScanVersion !== current.pins.canvasScanVersion) reasons.push(`canvas-scan moved from ${previous.pins.canvasScanVersion} to ${current.pins.canvasScanVersion}`);
  if (previous.pins.packageBundleSha256 !== current.pins.packageBundleSha256) reasons.push('the package bundle changed');
  for (const [entryId, pin] of Object.entries(previous.pins.entries)) {
    const now = current.pins.entries[entryId];
    if (!now) continue;
    if (now.commit !== pin.commit) reasons.push(`${entryId} is pinned to a different commit`);
    if (now.buildArtifactSha256 !== pin.buildArtifactSha256) reasons.push(`${entryId} built a different artifact`);
  }
  // An entry that did not produce evidence cannot be diffed against one that
  // did. A missing or unsound run is a hole in the comparison, not a change.
  for (const item of [...previous.resultClasses, ...current.resultClasses]) {
    if (['setup-failed', 'run-failed'].includes(item.status)) reasons.push(`${item.entryId} did not produce a sound run (${item.status})`);
  }
  return sorted(reasons);
}

export function compareBaselines(previous, current) {
  if (previous?.schemaVersion === undefined || current?.schemaVersion === undefined) fail('a baseline has no schema version');
  const before = new Map(previous.resultClasses.map(item => [item.entryId, item]));
  const after = new Map(current.resultClasses.map(item => [item.entryId, item]));

  const added = [...after.keys()].filter(id => !before.has(id));
  const removed = [...before.keys()].filter(id => !after.has(id));
  const incomplete = [...after.values()].filter(item => ['setup-failed', 'run-failed', 'declared-unavailable'].includes(item.status)).map(item => ({ entryId: item.entryId, status: item.status, reportPath: item.reportPath, handoffPath: item.handoffPath }));

  const changed = [];
  for (const [entryId, now] of after) {
    const then = before.get(entryId);
    if (!then) continue;
    const differences = [];
    for (const field of ['status', 'comparability']) {
      if (then[field] !== now[field]) differences.push({ field, from: then[field], to: now[field] });
    }
    for (const field of ['findingTypes', 'droppedKinds', 'comparisonStatuses']) {
      if (JSON.stringify(then[field]) !== JSON.stringify(now[field])) differences.push({ field, from: then[field], to: now[field] });
    }
    if (then.findingCount !== now.findingCount) differences.push({ field: 'findingCount', from: then.findingCount, to: now.findingCount });
    if (differences.length) changed.push({ entryId, differences, reportPath: now.reportPath, handoffPath: now.handoffPath });
  }

  const reasons = [...invalidities(previous, current), ...removed.map(id => `${id} is missing from this run`)];
  return {
    status: reasons.length ? 'invalid' : 'comparable',
    advisory: true,
    reasons: sorted(reasons),
    added, removed, incomplete, changed,
  };
}

// Only the findingCount field is "ordinary". Everything else is a change in
// what the tool could say, which is worth a reader's attention even though the
// job still passes.
export const onlyOrdinaryChanges = diff => diff.changed.every(entry => entry.differences.every(difference => difference.field === 'findingCount'));

export function renderReport(diff) {
  const lines = [`corpus baseline: ${diff.status}`, ADVISORY_NOTE];
  if (diff.status === 'invalid') {
    lines.push('', 'This comparison is not valid:');
    for (const reason of diff.reasons) lines.push(`  - ${reason}`);
  }
  for (const entryId of diff.added) lines.push(`+ ${entryId} is new in this run`);
  for (const entryId of diff.removed) lines.push(`- ${entryId} is missing from this run`);
  for (const entry of diff.incomplete) lines.push(`? ${entry.entryId} did not complete (${entry.status})${entry.reportPath ? ` — report: ${entry.reportPath}` : ''}`);
  for (const entry of diff.changed) {
    lines.push('', `~ ${entry.entryId}`);
    for (const difference of entry.differences) {
      lines.push(`    ${difference.field}: ${JSON.stringify(difference.from)} -> ${JSON.stringify(difference.to)}`);
    }
    // Every change is one click from the evidence behind it.
    if (entry.reportPath) lines.push(`    report: ${entry.reportPath}`);
    if (entry.handoffPath) lines.push(`    handoff: ${entry.handoffPath}`);
  }
  if (diff.status === 'comparable' && !diff.added.length && !diff.changed.length && !diff.incomplete.length) lines.push('', 'No structural change.');
  const report = lines.join('\n');
  // The last line of defence. If a change to this file ever tried to say one
  // recording was faster than another, it would fail here.
  if (FORBIDDEN_WORDS.test(report)) fail(`the report used a word two recordings cannot support: ${report.match(FORBIDDEN_WORDS)[0]}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = Object.fromEntries(process.argv.slice(2).map(argument => {
    const index = argument.indexOf('=');
    return index === -1 ? [argument.slice(2), true] : [argument.slice(2, index), argument.slice(index + 1)];
  }));
  if (!options.run) { console.error('usage: node corpus-baseline.mjs --run=DIR/corpus-run.json --baseline=FILE [--write]'); process.exit(2); }
  const summary = JSON.parse(readFileSync(options.run, 'utf8'));
  const handoffs = Object.fromEntries(summary.entries.filter(entry => entry.handoff?.jsonl).map(entry => [
    entry.entryId,
    readFileSync(entry.handoff.jsonl, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)),
  ]));
  const current = buildBaseline(summary, handoffs);
  if (options.write || !options.baseline) {
    writeFileSync(options.baseline ?? 'corpus-baseline.json', `${JSON.stringify(current, null, 2)}\n`);
    console.log(`wrote ${options.baseline ?? 'corpus-baseline.json'}`);
  } else {
    console.log(renderReport(compareBaselines(JSON.parse(readFileSync(options.baseline, 'utf8')), current)));
  }
  // Advisory: an ordinary change never fails the job.
  process.exit(0);
}
