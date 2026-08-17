import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  checkEvidenceObject,
  rowArtifactPath,
  safeArtifactPath,
  scanPrivateEvidence,
  validateManifest,
  verificationCommandsFor,
} from './lab-v05-truth.mjs';

const truth = JSON.parse(await readFile(new URL('./fixtures/v05-lab/expected.json', import.meta.url)));
const metadata = { commitHash: 'a'.repeat(40), packageHash: 'b'.repeat(64), browserRevision: '151.0.0.0' };
const diagnostics = () => Object.fromEntries(truth.requiredDiagnostics.map(key => [key, []]));
const facts = index => ({ evidenceMarker: index });
const actualRows = () => truth.rows.map((row, index) => ({ actualResult: row.expectedResult, facts: facts(index) }));
const matrix = () => truth.rows.map((row, index) => ({
  ...row,
  actualResult: row.expectedResult,
  artifactPath: rowArtifactPath(row),
  commitHash: metadata.commitHash,
  packageHash: metadata.packageHash,
  browserRevision: metadata.browserRevision,
  pass: true,
  facts: facts(index),
}));
const evidence = () => ({ matrix: matrix(), metadata: { ...metadata }, diagnostics: diagnostics() });
const check = (value, rows = actualRows()) => checkEvidenceObject(value, truth, '/unused', { actualRows: rows });
const reject = async mutate => {
  const value = evidence();
  const rows = actualRows();
  mutate(value, rows);
  await assert.rejects(check(value, rows), /v0\.5 lab evidence failed/);
};

test('uses the preceding v0.4 evidence in release mode', () => {
  assert.ok(verificationCommandsFor(false).includes('pnpm --filter dogfood run lab:v0.4'));
  assert.equal(verificationCommandsFor(true).includes('pnpm --filter dogfood run lab:v0.4'), false);
  assert.equal(verificationCommandsFor(true).filter(command => command === 'pnpm --filter dogfood run lab:v0.4:check').length, 1);
});

test('accepts the complete ordered 59-row object', async () => {
  assert.equal(await check(evidence()), true);
});

test('rejects missing, extra, duplicate, and reordered rows', async t => {
  await t.test('missing', () => reject(value => value.matrix.pop()));
  await t.test('extra', () => reject(value => value.matrix.push(structuredClone(value.matrix[0]))));
  await t.test('duplicate', () => reject(value => { value.matrix[1] = structuredClone(value.matrix[0]); }));
  await t.test('reordered', () => reject(value => { [value.matrix[0], value.matrix[1]] = [value.matrix[1], value.matrix[0]]; }));
});

test('rejects missing nearest-negative and positive variants', async t => {
  await t.test('nearest negative', () => reject(value => { value.matrix.splice(3, 1); value.matrix.push(structuredClone(value.matrix.at(-1))); }));
  await t.test('positive variant', () => reject(value => { value.matrix.splice(1, 1); value.matrix.push(structuredClone(value.matrix.at(-1))); }));
});

test('rejects false known command results', async t => {
  await t.test('unknown to same', () => reject(value => { value.matrix[4].actualResult = 'same'; }));
  await t.test('unknown to changed', () => reject(value => { value.matrix[4].actualResult = 'changed'; }));
  await t.test('changed to same', () => reject(value => { value.matrix[0].actualResult = 'same'; }));
});

test('rejects changed facts for every result family', async t => {
  for (const [name, index] of [['command', 0], ['callsite', 5], ['comparison', 9], ['limit', 17], ['overlay', 57], ['integrated', 58]]) {
    await t.test(name, () => reject(value => { value.matrix[index].facts = { forged: true }; }));
  }
});

test('rejects coordinated report changes against repository truth', async () => {
  await reject((value, rows) => {
    value.matrix[0].expectedResult = 'same';
    value.matrix[0].actualResult = 'same';
    rows[0].actualResult = 'same';
  });
});

test('rejects false pass state and row metadata', async t => {
  await t.test('pass', () => reject(value => { value.matrix[0].pass = false; }));
  await t.test('commit', () => reject(value => { value.matrix[0].commitHash = 'c'.repeat(40); }));
  await t.test('package', () => reject(value => { value.matrix[0].packageHash = 'd'.repeat(64); }));
  await t.test('browser', () => reject(value => { value.matrix[0].browserRevision = '999.0.0.0'; }));
});

test('rejects unsafe, changed, and duplicate artifact paths', async t => {
  await t.test('traversal', () => reject(value => { value.matrix[0].artifactPath = '../outside.json'; }));
  await t.test('absolute', () => reject(value => { value.matrix[0].artifactPath = '/private/tmp/outside.json'; }));
  await t.test('changed', () => reject(value => { value.matrix[0].artifactPath = 'raw/command/artifacts/other.json'; }));
  await t.test('duplicate', () => reject(value => { value.matrix[1].artifactPath = value.matrix[0].artifactPath; }));
  assert.equal(safeArtifactPath('raw/a.json'), true);
  assert.equal(safeArtifactPath('raw//a.json'), false);
});

test('rejects each nonempty diagnostic class', async t => {
  for (const key of truth.requiredDiagnostics) await t.test(key, () => reject(value => { value.diagnostics[key].push('failure'); }));
});

test('rejects unsupported claim text in matrix facts', async () => {
  await reject(value => { value.matrix[0].facts.note = 'This is wasted work.'; });
  await reject(value => { value.matrix[0].facts.note = 'The change has improved performance.'; });
  await reject(value => { value.matrix[0].facts.note = 'It is now faster.'; });
  await reject(value => { value.matrix[0].facts.note = 'The application is faster.'; });
  await reject(value => { value.matrix[0].facts.note = 'The software improved.'; });
  await reject(value => { value.matrix[0].facts.note = 'Info: The software improved.'; });
  await reject(value => { value.matrix[0].facts.note = 'The application runs faster.'; });
  await reject(value => { value.matrix[0].facts.note = 'We fixed the rendering issue.'; });
  await reject(value => { value.matrix[0].facts.note = 'Issue fixed.'; });
  await reject(value => { value.matrix[0].facts.note = 'Fixed.'; });
  await reject(value => { value.matrix[0].facts.note = 'Fixed rendering issue.'; });
  await reject(value => { value.matrix[0].facts.note = 'Rendering issue: fixed.'; });
  await reject(value => { value.matrix[0].facts.note = 'Rendering issue, fixed.'; });
  await reject(value => { value.matrix[0].facts.note = 'Rendering issue — now fixed.'; });
  await reject(value => { value.matrix[0].facts.note = 'Rendering issue (fixed).'; });
  await reject(value => { value.matrix[0].facts.note = 'GPU processing time was 1 ms.'; });
  await reject(value => { value.matrix[0].facts.note = 'Time on the GPU was 1 ms.'; });
  await reject(value => { value.matrix[0].facts.note = 'GPU\ntime was 1 ms.'; });
  await reject(value => { value.matrix[0].facts.note = 'Time\nGPU cost was 1 ms.'; });
});

test('allows fixed-limit repository labels', async () => {
  const value = evidence();
  value.matrix[0].facts.note = 'fixed-limit\nfixed-limits';
  const rows = actualRows();
  rows[0].facts = value.matrix[0].facts;
  assert.equal(await check(value, rows), true);
});

test('rejects compact product outcome claims', async () => {
  await reject(value => { value.matrix[0].facts.note = 'performance:fixed'; });
  await reject(value => { value.matrix[0].facts.note = 'rendering:fixed'; });
  await reject(value => { value.matrix[0].facts.note = 'status:fixed'; });
  await reject(value => { value.matrix[0].facts.note = ':fixed: PASS'; });
  await reject(value => { value.matrix[0].facts.note = 'outcome:fixed: PASS'; });
});

test('detects each private evidence class and derived digest', () => {
  const samples = [
    truth.privacySeeds.strings[0],
    String(truth.privacySeeds.numbers[0]),
    truth.privacySeeds.urlParts[0],
    truth.privacySeeds.objectKeys[0],
    truth.privacySeeds.rawStackParts[0],
    truth.privacySeeds.mapBodyParts[0],
    createHash('sha256').update(truth.privacySeeds.strings[0]).digest('hex'),
  ];
  for (const sample of samples) assert.ok(scanPrivateEvidence(`prefix ${sample} suffix`, truth.privacySeeds));
  assert.ok(scanPrivateEvidence('{"mappings": "AAAA"}', truth.privacySeeds));
  assert.ok(scanPrivateEvidence('Error: private\n    at applicationFunction (app.js:1:1)', truth.privacySeeds));
  assert.equal(scanPrivateEvidence('opaque token 12 and a safe loopback path', truth.privacySeeds), null);
});

test('validates exact manifest coverage and hashes', () => {
  const bytes = new Map([['a.json', Buffer.from('a')], ['raw/b.txt', Buffer.from('b')]]);
  const digest = value => createHash('sha256').update(value).digest('hex');
  const lines = [...bytes].map(([name, value]) => `${digest(value)}  ${name}`);
  assert.equal(validateManifest(lines, [...bytes.keys()], bytes), true);
  assert.throws(() => validateManifest(lines.slice(1), [...bytes.keys()], bytes));
  assert.throws(() => validateManifest([...lines, lines[0]], [...bytes.keys()], bytes));
  assert.throws(() => validateManifest([`${'0'.repeat(64)}  a.json`, lines[1]], [...bytes.keys()], bytes));
  assert.throws(() => validateManifest([`${digest(bytes.get('a.json'))}  ../a.json`, lines[1]], [...bytes.keys()], bytes));
});

test('rejects incomplete integrated flow reporting', async t => {
  await t.test('missing step', () => reject(value => { value.matrix[58].facts.actionSequence = ['record-baseline']; }));
  await t.test('wrong selected index', () => reject(value => { value.matrix[58].facts.baselineFindingIndex = 999; }));
  await t.test('forged comparison', () => reject(value => { value.matrix[58].facts.measures = []; }));
  await t.test('outcome conclusion', () => reject(value => { value.matrix[58].facts.note = 'The candidate improved performance.'; }));
});
