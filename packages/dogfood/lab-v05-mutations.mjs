import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEvidence, diskMutationNames } from './lab-v05-truth.mjs';
import { expectedMatrix } from './session-comparison-fixture.mjs';

const defaultDirectory = '/private/tmp/sidproj-69-v05-lab-evidence';
const stable = value => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const diskMutationLine = `CANVAS_LAB_V05_DISK_MUTATIONS: PASS ${diskMutationNames.join(',')}\n`;
const readJson = async (directory, name) => JSON.parse(await readFile(path.join(directory, name), 'utf8'));
const writeJson = (directory, name, value) => writeFile(path.join(directory, name), stable(value));

async function files(directory, relative = '') {
  const result = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await files(directory, next));
    else result.push(next);
  }
  return result.sort();
}

async function refreshManifest(directory) {
  const names = (await files(directory)).filter(name => name !== 'evidence-sha256.txt').sort();
  const lines = await Promise.all(names.map(async name => `${sha256(await readFile(path.join(directory, name)))}  ${name}`));
  await writeFile(path.join(directory, 'evidence-sha256.txt'), `${lines.join('\n')}\n`);
}

async function refreshEndTime(directory) {
  const metadata = await readJson(directory, 'run-metadata.json');
  metadata.endedAt = new Date().toISOString();
  await writeJson(directory, 'run-metadata.json', metadata);
}

async function expectRejected(source, name, mutate) {
  const parent = await mkdtemp(path.join(tmpdir(), `sidproj-69-${name}-`));
  const directory = path.join(parent, 'evidence');
  try {
    await cp(source, directory, { recursive: true, preserveTimestamps: true });
    await mutate(directory);
    await refreshEndTime(directory);
    await refreshManifest(directory);
    let rejected = false;
    try { await checkEvidence(directory); } catch { rejected = true; }
    if (!rejected) throw new Error(`disk mutation passed: ${name}`);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

async function refreshChild(directory, name) {
  await refreshManifest(path.join(directory, name));
}

export async function runDiskMutations(source = defaultDirectory) {
  const cases = [
    ['missing-row', async directory => {
      const matrix = await readJson(directory, 'matrix.json');
      matrix.pop();
      await writeJson(directory, 'matrix.json', matrix);
    }],
    ['extra-row', async directory => {
      const matrix = await readJson(directory, 'matrix.json');
      matrix.push(structuredClone(matrix.at(-1)));
      await writeJson(directory, 'matrix.json', matrix);
    }],
    ['reordered-row', async directory => {
      const matrix = await readJson(directory, 'matrix.json');
      [matrix[0], matrix[1]] = [matrix[1], matrix[0]];
      await writeJson(directory, 'matrix.json', matrix);
    }],
    ['false-known-command', async directory => {
      const artifact = await readJson(directory, 'raw/command/artifacts/unsupported-value.json');
      artifact.comparisons.at(-1).status = 'same';
      artifact.comparisons.at(-1).unknownReason = null;
      await writeJson(directory, 'raw/command/artifacts/unsupported-value.json', artifact);
    }],
    ['command-first-difference', async directory => {
      const artifact = await readJson(directory, 'raw/command/artifacts/wrapper-depth.json');
      artifact.firstDifference.ordinal++;
      await writeJson(directory, 'raw/command/artifacts/wrapper-depth.json', artifact);
    }],
    ['callsite-limit-command-truth', async directory => {
      const name = 'raw/limits/artifacts/source-map-lookups/wrapper-depth.json';
      const artifact = await readJson(directory, name);
      artifact.comparisons[1].status = 'unknown';
      artifact.comparisons[1].difference = null;
      artifact.comparisons[1].unknownReason = 'source-map-lookup-limit';
      await writeJson(directory, name, artifact);
      await refreshChild(directory, 'raw/limits');
    }],
    ['command-gap-known', async directory => {
      const name = 'raw/limits/artifacts/value-tokens/wrapper-depth.json';
      const artifact = await readJson(directory, name);
      artifact.comparisons[1].status = 'same';
      artifact.comparisons[1].unknownReason = null;
      await writeJson(directory, name, artifact);
      await refreshChild(directory, 'raw/limits');
    }],
    ['wrong-callsite', async directory => {
      const artifact = await readJson(directory, 'raw/callsite/direct-artifact.json');
      const frame = artifact.stacks.flatMap(sample => sample.frames).find(item => item.mapped);
      frame.mapped.line++;
      await writeJson(directory, 'raw/callsite/direct-artifact.json', artifact);
      await refreshChild(directory, 'raw/callsite');
    }],
    ['wrong-comparison', async directory => {
      const row = expectedMatrix.rows[0];
      const artifact = await readJson(directory, `raw/comparison/artifacts/${row.id}.json`);
      artifact.measures[0].delta = 999;
      await writeJson(directory, `raw/comparison/artifacts/${row.id}.json`, artifact);
      const actual = await readJson(directory, 'raw/comparison/actual-results.json');
      actual[0] = artifact;
      await writeJson(directory, 'raw/comparison/actual-results.json', actual);
      const matrix = await readJson(directory, 'matrix.json');
      matrix[9].facts.deltas[0] = 999;
      await writeJson(directory, 'matrix.json', matrix);
    }],
    ['wrong-limit', async directory => {
      const name = 'raw/limits/artifacts/value-tokens/wrapper-depth.json';
      const artifact = await readJson(directory, name);
      artifact.droppedEntryCounts.valueTokens++;
      artifact.limitResults.find(item => item.name === 'value-tokens').rejectedCount++;
      await writeJson(directory, name, artifact);
      await refreshChild(directory, 'raw/limits');
    }],
    ['missing-artifact', directory => rm(path.join(directory, 'raw/integrated/panel-text.txt'))],
    ['unsafe-artifact-path', async directory => {
      const matrix = await readJson(directory, 'matrix.json');
      matrix[0].artifactPath = '../outside.json';
      await writeJson(directory, 'matrix.json', matrix);
    }],
    ['extra-file', directory => writeFile(path.join(directory, 'raw/extra.json'), '{}\n')],
    ['symlink', async directory => {
      const target = path.join(directory, 'raw/integrated/panel-text.txt');
      await unlink(target);
      await symlink(path.join(directory, 'checker-output.txt'), target);
    }],
    ['nested-manifest', async directory => {
      const name = path.join(directory, 'raw/callsite/evidence-sha256.txt');
      const lines = (await readFile(name, 'utf8')).trim().split('\n');
      lines[0] = `${'0'.repeat(64)}  ${lines[0].slice(66)}`;
      await writeFile(name, `${lines.join('\n')}\n`);
    }],
    ['forged-metadata', async directory => {
      const metadata = await readJson(directory, 'run-metadata.json');
      metadata.commitHash = 'f'.repeat(40);
      await writeJson(directory, 'run-metadata.json', metadata);
      const matrix = await readJson(directory, 'matrix.json');
      for (const row of matrix) row.commitHash = metadata.commitHash;
      await writeJson(directory, 'matrix.json', matrix);
    }],
    ['stale-final-file', async directory => {
      const stale = new Date(Date.now() + 60_000);
      await utimes(path.join(directory, 'raw/integrated/panel-text.txt'), stale, stale);
    }],
    ['stale-child-time', async directory => {
      const artifact = await readJson(directory, 'raw/callsite/direct-artifact.json');
      artifact.startedAt = '2020-01-01T00:00:00.000Z';
      artifact.endedAt = '2020-01-01T00:00:01.000Z';
      await writeJson(directory, 'raw/callsite/direct-artifact.json', artifact);
      await refreshChild(directory, 'raw/callsite');
    }],
    ['stale-provenance', async directory => {
      const provenance = await readJson(directory, 'provenance/limits.json');
      provenance.startedAt = '2020-01-01T00:00:00.000Z';
      provenance.endedAt = '2020-01-01T00:00:01.000Z';
      await writeJson(directory, 'provenance/limits.json', provenance);
    }],
    ['stale-overlay-session', async directory => {
      for (const name of ['raw-baseline-session.json', 'raw-comparable-candidate-session.json', 'raw-incomparable-candidate-session.json']) {
        const session = await readJson(directory, `raw/overlay/${name}`);
        session.startedAt = '2020-01-01T00:00:00.000Z';
        session.endedAt = '2020-01-01T00:00:01.000Z';
        await writeJson(directory, `raw/overlay/${name}`, session);
      }
      await refreshChild(directory, 'raw/overlay');
    }],
    ['private-raw', directory => writeFile(path.join(directory, 'raw/integrated/panel-text.txt'), 'opaque-private-string\n')],
    ['private-digest', directory => writeFile(path.join(directory, 'raw/integrated/panel-text.txt'), `${sha256('opaque-private-string')}\n`)],
    ['raw-stack', directory => writeFile(path.join(directory, 'raw/integrated/panel-text.txt'), 'Error: private\n    at applicationFunction (app.js:1:1)\n')],
    ['source-map-body', async directory => {
      const requests = await readJson(directory, 'raw/callsite/request-log.json');
      requests[0].headers['x-private'] = '{"mappings":"AAAA"}';
      await writeJson(directory, 'raw/callsite/request-log.json', requests);
      await refreshChild(directory, 'raw/callsite');
    }],
    ['outcome-claim', directory => writeFile(path.join(directory, 'raw/integrated/panel-text.txt'), 'The change has improved performance.\n')],
    ['direct-outcome-claim', directory => writeFile(path.join(directory, 'raw/integrated/panel-text.txt'), 'Rendering issue, fixed.\n')],
    ['compact-outcome-claim', directory => writeFile(path.join(directory, 'raw/integrated/panel-text.txt'), 'status:fixed\n')],
    ['forward-timing-claim', directory => writeFile(path.join(directory, 'raw/integrated/panel-text.txt'), 'GPU processing time was 1 ms.\n')],
    ['reverse-timing-claim', directory => writeFile(path.join(directory, 'raw/integrated/panel-text.txt'), 'Time on the GPU was 1 ms.\n')],
    ['split-timing-claim', directory => writeFile(path.join(directory, 'raw/integrated/panel-text.txt'), 'GPU\ntime was 1 ms.\n')],
    ['diagnostic', async directory => {
      const diagnostics = await readJson(directory, 'diagnostics.json');
      diagnostics.pageErrors.push('failure');
      await writeJson(directory, 'diagnostics.json', diagnostics);
    }],
    ['unexpected-drop', async directory => {
      const artifact = await readJson(directory, 'raw/command/artifacts/wrapper-depth.json');
      artifact.droppedEntryCounts.stackSamples++;
      await writeJson(directory, 'raw/command/artifacts/wrapper-depth.json', artifact);
    }],
    ['missing-step', async directory => {
      const actions = await readJson(directory, 'raw/integrated/action-log.json');
      actions.splice(5, 1);
      await writeJson(directory, 'raw/integrated/action-log.json', actions);
    }],
    ['wrong-order', async directory => {
      const actions = await readJson(directory, 'raw/integrated/action-log.json');
      [actions[0], actions[1]] = [actions[1], actions[0]];
      await writeJson(directory, 'raw/integrated/action-log.json', actions);
    }],
    ['wrong-selected-index', async directory => {
      const state = await readJson(directory, 'raw/integrated/interaction-state.json');
      state.candidateFindingIndex = 999;
      await writeJson(directory, 'raw/integrated/interaction-state.json', state);
    }],
    ['forged-integrated-comparison', async directory => {
      const artifact = await readJson(directory, 'raw/integrated/comparison.json');
      artifact.measures[0].delta = 999;
      await writeJson(directory, 'raw/integrated/comparison.json', artifact);
      await writeJson(directory, 'raw/integrated/exported-comparison.json', artifact);
      const matrix = await readJson(directory, 'matrix.json');
      matrix.at(-1).facts.measures = artifact.measures;
      await writeJson(directory, 'matrix.json', matrix);
    }],
    ['changed-export', async directory => {
      const exported = await readJson(directory, 'raw/integrated/exported-comparison.json');
      exported.measures[0].delta = 999;
      await writeJson(directory, 'raw/integrated/exported-comparison.json', exported);
    }],
    ['improvement-established', async directory => {
      const artifact = await readJson(directory, 'raw/integrated/comparison.json');
      artifact.improvementEstablished = true;
      await writeJson(directory, 'raw/integrated/comparison.json', artifact);
      await writeJson(directory, 'raw/integrated/exported-comparison.json', artifact);
      const matrix = await readJson(directory, 'matrix.json');
      matrix.at(-1).facts.improvementEstablished = true;
      await writeJson(directory, 'matrix.json', matrix);
    }],
    ['child-run-id', async directory => {
      const manifest = await readJson(directory, 'raw/command/manifest.json');
      manifest.runId = 'different-run';
      await writeJson(directory, 'raw/command/manifest.json', manifest);
    }],
    ['copied-actual-result', async directory => {
      const actual = await readJson(directory, 'raw/comparison/actual-results.json');
      actual[0].measures[0].delta = 999;
      await writeJson(directory, 'raw/comparison/actual-results.json', actual);
    }],
    ['collector-run', async directory => {
      const runs = await readJson(directory, 'collector-runs.json');
      runs.runs[0].exitCode = 1;
      await writeJson(directory, 'collector-runs.json', runs);
    }],
    ['run-link', async directory => {
      const links = await readJson(directory, 'run-links.json');
      links.files.pop();
      await writeJson(directory, 'run-links.json', links);
    }],
    ['stripped-verification-record', async directory => {
      const name = path.join(directory, 'verification-output.txt');
      const output = await readFile(name, 'utf8');
      const next = output.indexOf('\nCOMMAND: ', 1);
      const stripped = `${output.slice(0, next).split('\n').slice(0, 3).join('\n')}\n${output.slice(next + 1)}`;
      await writeFile(name, stripped);
    }],
    ['missing-mutation-result', async directory => {
      const name = path.join(directory, 'mutation-test-output.txt');
      const text = await readFile(name, 'utf8');
      await writeFile(name, text.replace(diskMutationLine, ''));
    }],
  ];
  if (cases.map(([name]) => name).join('|') !== diskMutationNames.join('|')) throw new Error('disk mutation list does not match trusted names');
  const parent = await mkdtemp(path.join(tmpdir(), 'sidproj-69-clean-evidence-'));
  const clean = path.join(parent, 'evidence');
  try {
    await cp(source, clean, { recursive: true, preserveTimestamps: true });
    const outputPath = path.join(clean, 'mutation-test-output.txt');
    const output = await readFile(outputPath, 'utf8');
    await writeFile(outputPath, `${output.replace(/^CANVAS_LAB_V05_DISK_MUTATIONS: PASS .*$/gm, '').trimEnd()}\n\n${diskMutationLine}`);
    await refreshEndTime(clean);
    await refreshManifest(clean);
    try { await checkEvidence(clean); } catch (error) { throw new Error(`clean copy failed: ${error.message}`); }
    for (const [name, mutate] of cases) await expectRejected(clean, name, mutate);
    return cases.map(([name]) => name);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const names = await runDiskMutations(process.argv[2] || defaultDirectory);
  console.log(`CANVAS_LAB_V05_MUTATIONS: PASS ${names.join(',')}`);
}
