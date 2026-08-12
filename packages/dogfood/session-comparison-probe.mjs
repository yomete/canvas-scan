import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { compareSessions } from '../core/dist/index.js';
import { checkEvidence } from './session-comparison-truth.mjs';
import { expectedMatrix, sessionFor } from './session-comparison-fixture.mjs';

const defaultDirectory = '/private/tmp/sidproj-64-session-comparison-evidence';
const stable = value => `${JSON.stringify(value, null, 2)}\n`;
const write = (directory, path, value) => writeFileSync(join(directory, path), stable(value));
const status = () => execFileSync('git', ['status', '--short'], { encoding: 'utf8' });
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');

export function createEvidence(directory = defaultDirectory) {
  const initialStatus = status();
  for (const path of ['inputs', 'artifacts', 'expected-results.json', 'actual-results.json', 'run-metadata.json', 'evidence-sha256.txt']) rmSync(join(directory, path), { recursive: true, force: true });
  mkdirSync(join(directory, 'inputs'), { recursive: true }); mkdirSync(join(directory, 'artifacts'), { recursive: true });
  const actual = [];
  for (const row of expectedMatrix.rows) { const baseline = sessionFor(row, 0); const candidate = sessionFor(row, 1); const artifact = compareSessions(baseline, candidate, { baselineFindingIndex: row.baselineFindingIndex, candidateFindingIndex: row.candidateFindingIndex }); write(directory, `inputs/${row.id}-baseline.json`, baseline); write(directory, `inputs/${row.id}-candidate.json`, candidate); write(directory, `artifacts/${row.id}.json`, artifact); actual.push(artifact); }
  write(directory, 'expected-results.json', expectedMatrix); write(directory, 'actual-results.json', actual);
  const finalStatus = status();
  write(directory, 'run-metadata.json', { gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), initialStatus, finalStatus, bundleSha256: hash(new URL('../core/dist/index.js', import.meta.url)), nodeVersion: process.version, command: 'pnpm --filter dogfood run probe:session-comparison' });
  const paths = [...expectedMatrix.rows.flatMap(row => [`inputs/${row.id}-baseline.json`, `inputs/${row.id}-candidate.json`, `artifacts/${row.id}.json`]), 'expected-results.json', 'actual-results.json', 'run-metadata.json'].sort();
  writeFileSync(join(directory, 'evidence-sha256.txt'), `${paths.map(path => `${hash(join(directory, path))}  ${path}`).join('\n')}\n`);
  if (initialStatus !== finalStatus) throw new Error('worktree changed during evidence generation'); checkEvidence(directory); return directory;
}

const isMain = process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url;
if (isMain) {
  const checkIndex = process.argv.indexOf('--check-evidence');
  if (checkIndex >= 0) {
    process.stdout.write('SIDPROJ_64_SESSION_COMPARISON: checking evidence\n');
    checkEvidence(process.argv[checkIndex + 1], { requireCommandOutputs: true });
  } else createEvidence();
  console.log('SIDPROJ_64_SESSION_COMPARISON: PASS');
}
