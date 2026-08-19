import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReadinessEvidence } from './readiness-v05.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rounded = value => Math.round(value * 1000) / 1000;
const measure = (id, unit, baseline, candidate) => {
  const delta = baseline === null || candidate === null ? null : unit === 'count' ? candidate - baseline : rounded(candidate - baseline);
  return { id, unit, baseline, candidate, delta, direction: delta === null ? 'unknown' : delta < 0 ? 'decreased' : delta > 0 ? 'increased' : 'unchanged', interpretation: unit === 'ms' ? 'observed-timing-pair' : 'structural' };
};
const nextEntryId = session => `browser-evidence-${session.browserEntries.length + 1}`;

export const readinessMutations = [
  ['run stages has a missing row', value => { value.runStages.pop(); }],
  ['run stages has an extra valid-shaped row', value => { value.runStages.push(structuredClone(value.runStages[0])); }],
  ['run stages has a duplicate row', value => { value.runStages[1].id = value.runStages[0].id; }],
  ['run stages is reordered', value => { [value.runStages[0], value.runStages[1]] = [value.runStages[1], value.runStages[0]]; }],
  ['run stages has an unsupported status', value => { value.runStages[0].status = 'unsupported'; }],
  ['a complete stage has a finite failure reason', value => { value.runStages[0].reason = 'setup-failed'; }],
  ['a complete action list cannot replace run stages', value => { value.runStages = value.actionIds; }],
  ['a command argument token changes to another valid token', value => { value.artifacts.copiedExplanation.windows[1].commands[0].arguments[0].token = `${'b'.repeat(32)}-1`; }],
  ['a command argument token uses an invalid private value', value => { value.artifacts.copiedExplanation.windows[1].commands[0].arguments[0].token = 'private-user-value'; }],
  ['a command argument kind changes from number to string', value => { value.artifacts.copiedExplanation.windows[1].commands[0].arguments[0].kind = 'string'; }],
  ['a raw session uses schema version 999', value => { value.artifacts.baselineSession.schemaVersion = 999; }],
  ['a raw session uses a private stop reason', value => { value.artifacts.baselineSession.stopReason = 'private-user-value'; }],
  ['a raw finding uses a private next check', value => { value.artifacts.baselineSession.findings[0].nextCheck = 'private-user-value'; }],
  ['a raw session has an extra valid-shaped episode association row', value => { value.artifacts.baselineSession.episodeAssociations.push(structuredClone(value.artifacts.baselineSession.episodeAssociations[0])); }],
  ['a raw session has an extra valid document event row', value => {
    const session = value.artifacts.baselineSession;
    const lastTime = session.browserEntries.at(-1).endedAtTimestampMs;
    const entry = { entryId: nextEntryId(session), kind: 'document-event', eventType: 'pointermove', startedAtTimestampMs: lastTime, endedAtTimestampMs: lastTime, targetTagName: 'div' };
    session.browserEntries.push(entry);
    session.episodeAssociations.push({ entryId: entry.entryId, entryKind: entry.kind, episodeId: session.episodes[0].episodeId, startedAtTimestampMs: entry.startedAtTimestampMs, endedAtTimestampMs: entry.endedAtTimestampMs, evidenceLevel: 'associated' });
  }],
  ['a raw session has two valid long animation frame rows', value => {
    const session = value.artifacts.baselineSession;
    const episode = session.episodes[0];
    const longAnimationFrame = { entryId: '', kind: 'long-animation-frame', startedAtTimestampMs: episode.startedAtTimestampMs, endedAtTimestampMs: episode.startedAtTimestampMs, durationMs: 0, blockingDurationMs: 0, scripts: [], droppedScriptAttributionCount: 0 };
    const missing = 2 - session.browserEntries.filter(entry => entry.kind === 'long-animation-frame').length;
    session.browserEntries.splice(2, 0, ...Array.from({ length: missing }, () => structuredClone(longAnimationFrame)));
    session.browserEntries.forEach((entry, index) => { entry.entryId = `browser-evidence-${index + 1}`; });
    session.episodeAssociations = session.browserEntries.flatMap(entry => entry.startedAtTimestampMs > episode.endedAtTimestampMs || episode.startedAtTimestampMs > entry.endedAtTimestampMs ? [] : [{ entryId: entry.entryId, entryKind: entry.kind, episodeId: episode.episodeId, startedAtTimestampMs: Math.max(entry.startedAtTimestampMs, episode.startedAtTimestampMs), endedAtTimestampMs: Math.min(entry.endedAtTimestampMs, episode.endedAtTimestampMs), evidenceLevel: 'associated' }]);
  }],
  ['a browser row changes to another valid target tag name', value => { value.artifacts.baselineSession.browserEntries[0].targetTagName = 'button'; }],
  ['an interaction ID change splits the replay pointer pair', value => { value.artifacts.baselineSession.browserEntries[6].interactionId++; }],
  ['a copied explanation has an extra valid-shaped window row', value => {
    const window = structuredClone(value.artifacts.copiedExplanation.windows.at(-1));
    window.windowIndex++;
    window.timestampMs++;
    value.artifacts.copiedExplanation.windows.push(window);
  }],
  ['a copied explanation has a duplicate valid stack row', value => { value.artifacts.copiedExplanation.stacks.push(structuredClone(value.artifacts.copiedExplanation.stacks[0])); }],
  ['a copied explanation has a duplicate valid stack frame', value => { value.artifacts.copiedExplanation.stacks[0].frames.push(structuredClone(value.artifacts.copiedExplanation.stacks[0].frames[1])); }],
  ['a copied stack frame has a private function name', value => { value.artifacts.copiedExplanation.stacks[0].frames[1].functionName = 'privateUserValue'; }],
  ['a copied stack frame has a valid but false unresolved reason', value => { value.artifacts.copiedExplanation.stacks[0].frames[1].unresolvedReason = 'mapping-missing'; }],
  ['a copied explanation has a duplicate valid comparison row', value => { value.artifacts.copiedExplanation.comparisons.push(structuredClone(value.artifacts.copiedExplanation.comparisons[0])); }],
  ['a copied command uses a private name', value => { value.artifacts.copiedExplanation.windows[1].commands[0].name = 'private-user-value'; }],
  ['a copied command uses a private unknown reason', value => { value.artifacts.copiedExplanation.windows[1].commands[0].unknownReason = 'private-user-value'; }],
  ['a copied argument has a raw value field', value => { value.artifacts.copiedExplanation.windows[1].commands[0].arguments[0].rawValue = 'private-user-value'; }],
  ['a copied timing for the canvas total changes from 999 to 0', value => { value.artifacts.copiedComparison.measures[2] = measure('canvas-api-self-time-ms', 'ms', 999, 0); }],
  ['a copied timing for the maximum window changes from 999 to 0', value => { value.artifacts.copiedComparison.measures[3] = measure('maximum-window-self-time-ms', 'ms', 999, 0); }],
  ['a copied clearRect timing changes from 999 to 0', value => { value.artifacts.copiedComparison.measures[5] = measure('method:clearRect:self-time-ms', 'ms', 999, 0); }],
  ['a copied fillRect timing changes from 999 to 0', value => { value.artifacts.copiedComparison.measures[7] = measure('method:fillRect:self-time-ms', 'ms', 999, 0); }],
  ['a copied fillStyle timing changes from 999 to 0', value => { value.artifacts.copiedComparison.measures[9] = measure('method:fillStyle:self-time-ms', 'ms', 999, 0); }],
  ['a copied argument uses an invalid kind', value => { value.artifacts.copiedExplanation.windows[1].commands[0].arguments[0].kind = 'private-user-value'; }],
  ['a copied argument uses position 80', value => { value.artifacts.copiedExplanation.windows[1].commands[0].arguments[0].position = 80; }],
  ['a generated script path has a query string', value => { value.artifacts.copiedExplanation.stacks[0].frames[1].generated.file += '?token=private-user-value'; }],
  ['a generated script path has a fragment', value => { value.artifacts.copiedExplanation.stacks[0].frames[1].generated.file += '#private-user-value'; }],
  ['a mapped source path has a query string', value => {
    Object.assign(value.artifacts.copiedExplanation.stacks[0].frames[1], { mapped: { file: '/src/ritual-canvas.tsx?token=private-user-value', line: 1, column: 1 }, mappingStatus: 'mapped', unresolvedReason: null });
  }],
  ['a mapped source path has a fragment', value => {
    Object.assign(value.artifacts.copiedExplanation.stacks[0].frames[1], { mapped: { file: '/src/ritual-canvas.tsx#private-user-value', line: 1, column: 1 }, mappingStatus: 'mapped', unresolvedReason: null });
  }],
  ['a raw session has an unexpected valid-shaped user mark row', value => {
    const session = value.artifacts.baselineSession;
    const lastTime = session.browserEntries.at(-1).endedAtTimestampMs;
    session.browserEntries.push({ entryId: nextEntryId(session), kind: 'user-mark', startedAtTimestampMs: lastTime, endedAtTimestampMs: lastTime, label: 'private-user-value' });
  }],
  ['a readiness artifact has a private browser version', value => { value.browserVersion = 'private-user-value'; }],
  ['a raw session has the wrong duration', value => { value.artifacts.baselineSession.durationMs = 500; }],
  ['a copied explanation has the wrong duration', value => { value.artifacts.copiedExplanation.durationMs = 500; }],
  ['a copied explanation ID epoch is 2 ms before startedAt', value => {
    const artifact = value.artifacts.copiedExplanation;
    artifact.explanationId = artifact.explanationId.replace(/-\d+-([1-9]\d*)$/, `-${Date.parse(artifact.startedAt) - 2}-$1`);
  }],
  ['a copied explanation ID epoch is 1 ms after startedAt', value => {
    const artifact = value.artifacts.copiedExplanation;
    artifact.explanationId = artifact.explanationId.replace(/-\d+-([1-9]\d*)$/, `-${Date.parse(artifact.startedAt) + 1}-$1`);
  }],
  ['a copied explanation follow-up epoch is 1 ms before startedAt', value => {
    const artifact = value.artifacts.copiedExplanation;
    artifact.followUp.sessionId = artifact.followUp.sessionId.replace(/-\d+-([1-9]\d*)$/, `-${Date.parse(artifact.startedAt) - 1}-$1`);
    value.explanation.followUpSessionId = artifact.followUp.sessionId;
  }],
  ['a copied explanation follow-up epoch is 1 ms after startedAt', value => {
    const artifact = value.artifacts.copiedExplanation;
    artifact.followUp.sessionId = artifact.followUp.sessionId.replace(/-\d+-([1-9]\d*)$/, `-${Date.parse(artifact.startedAt) + 1}-$1`);
    value.explanation.followUpSessionId = artifact.followUp.sessionId;
  }],
  ['raw window times are out of order', value => {
    Object.assign(value.artifacts.baselineSession.windows[2], { startedAtTimestampMs: 1.25, timestampMs: 1.5, endedAtTimestampMs: 1.5 });
    value.artifacts.baselineSession.findings[0].repeatedWindows[0].timestampMs = 1.5;
  }],
  ['copied explanation window times are out of order', value => { value.artifacts.copiedExplanation.windows[2].timestampMs = value.artifacts.copiedExplanation.windows[1].timestampMs; }],
];

export function runReadinessMutations(value, expectedCandidate) {
  assert.equal(checkReadinessEvidence(value, expectedCandidate), true);
  for (const [name, mutate] of readinessMutations) {
    const changed = structuredClone(value);
    mutate(changed);
    assert.throws(() => checkReadinessEvidence(changed, expectedCandidate), undefined, name);
  }
  return readinessMutations.length;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr}`);
  return result.stdout.trim();
}

async function main() {
  const directory = process.argv[2];
  if (!directory) throw new Error('provide a readiness evidence directory');
  const expectedCandidate = {
    gitSha: run('git', ['rev-parse', 'HEAD']),
    branch: run('git', ['branch', '--show-current']),
    packageVersion: JSON.parse(await readFile(path.join(root, 'packages/core/package.json'), 'utf8')).version,
  };
  const value = JSON.parse(await readFile(path.join(directory, 'evidence.json'), 'utf8'));
  console.log(`SIDPROJ_114_READINESS_MUTATIONS: PASS (${runReadinessMutations(value, expectedCandidate)})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
