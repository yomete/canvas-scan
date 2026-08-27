// Runs the guided canvas-scan workflow against the pinned external corpus.
//
// Setup and observation are kept apart from end to end: the clone, install and
// build produce a `setup` result, the guided run produces a `run` result, and
// only the checker combines them. A build that never worked can never emerge
// as a clean canvas-scan result.
//
// Nothing here opens an issue, a pull request, or any other upstream action. It
// reads three repositories at fixed commits and writes locally.
//
// Usage:
//   node corpus-run.mjs --out=DIR [--entry=chartjs] [--cache=DIR] [--skip-setup]
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../../scripts/browser-driver.mjs';
import { checkManifest, checkOutcomes, classifyOutcome } from './corpus-check.mjs';
import { investigate } from './investigate-url.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const corpus = path.join(here, 'corpus');

export const manifest = checkManifest(JSON.parse(readFileSync(path.join(corpus, 'manifest.json'), 'utf8')));

const stable = value => `${JSON.stringify(value, null, 2)}\n`;
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');

function run(command, args, cwd, timeoutSeconds) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: timeoutSeconds * 1000, stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    ok: result.status === 0,
    command: `${command} ${args.join(' ')}`,
    status: result.status,
    // Kept short. The point of the tail is to name the failure, not to archive
    // somebody else's build log.
    stderrTail: (result.stderr ?? '').split('\n').filter(Boolean).slice(-8).join('\n'),
  };
}

// Clone, check out the pinned commit, install, build. Every step that can fail
// names itself, so the outcome can say which one did.
export function prepare(entry, { cacheDir, skipSetup = false }) {
  const checkout = path.join(cacheDir, entry.id);
  const commands = [];
  const record = (step, result) => { commands.push({ step, ...result }); return result; };

  if (!existsSync(path.join(checkout, '.git'))) {
    mkdirSync(checkout, { recursive: true });
    const cloned = record('clone', run('git', ['clone', '--filter=blob:none', entry.repository, checkout], cacheDir, entry.evidenceBudget.setupSeconds));
    if (!cloned.ok) return { ok: false, step: 'clone', reason: `could not clone ${entry.repository}`, commands, checkout };
  }
  const fetched = record('fetch', run('git', ['fetch', '--depth=1', 'origin', entry.commit], checkout, entry.evidenceBudget.setupSeconds));
  if (!fetched.ok) return { ok: false, step: 'fetch', reason: `could not fetch ${entry.commit}`, commands, checkout };
  const checkedOut = record('checkout', run('git', ['checkout', '--force', entry.commit], checkout, 120));
  if (!checkedOut.ok) return { ok: false, step: 'checkout', reason: `the repository does not check out at the pinned commit ${entry.commit}`, commands, checkout };

  const head = run('git', ['rev-parse', 'HEAD'], checkout, 60);
  const artifact = path.join(checkout, entry.buildArtifact);
  if (!skipSetup || !existsSync(artifact)) {
    for (const [command, args] of entry.setup) {
      const step = record(command === 'git' ? 'git' : `${command} ${args[0]}`, run(command, args, checkout, entry.evidenceBudget.setupSeconds));
      if (!step.ok) return { ok: false, step: step.command, reason: `the setup step \`${step.command}\` failed`, commands, checkout };
    }
  }
  if (!existsSync(artifact)) return { ok: false, step: 'build-artifact', reason: `the build did not produce ${entry.buildArtifact}`, commands, checkout };

  return {
    ok: true,
    checkout,
    commands,
    // Provenance. Without these three a result cannot be repeated, and a corpus
    // result that cannot be repeated is an anecdote.
    applicationCommit: (head.ok ? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim() : null),
    buildArtifactSha256: digest(artifact),
  };
}

// Library entries get a page of their own that loads the build from the pinned
// checkout. An application entry serves its own built output.
function stage(entry, setup, outDir) {
  const served = path.join(outDir, `${entry.id}-site`);
  mkdirSync(served, { recursive: true });
  if (entry.page === null) return path.join(setup.checkout, path.dirname(entry.buildArtifact));
  copyFileSync(path.join(corpus, 'pages', entry.page), path.join(served, 'index.html'));
  copyFileSync(path.join(setup.checkout, entry.buildArtifact), path.join(served, 'library.js'));
  return served;
}

export async function runEntry(entry, { outDir, cacheDir, skipSetup = false, log = console.log }) {
  log(`\n${entry.id}: ${entry.title}`);
  const setup = prepare(entry, { cacheDir, skipSetup });
  if (!setup.ok) {
    log(`  setup failed at ${setup.step}: ${setup.reason}`);
    return { outcome: classifyOutcome(entry, { setup }), setup, run: null, report: null };
  }

  const entryOut = path.join(outDir, entry.id);
  mkdirSync(entryOut, { recursive: true });
  const { server, port } = await serve(stage(entry, setup, outDir));
  const origin = `http://127.0.0.1:${port}`;
  let report = null;
  let runResult;
  try {
    report = await investigate(
      {
        url: `${origin}/`, origin, out: entryOut,
        drive: path.join(corpus, 'interactions', entry.interaction),
        handoff: 'both', blockExternal: true,
        timeoutMs: entry.evidenceBudget.runSeconds * 1000,
      },
      { log: () => {} },
    );
    runResult = report.notes.length === 0
      ? { ok: true }
      : { ok: false, reason: report.notes.join(' | '), stopCondition: 'the guided run reports a note' };
  } catch (error) {
    runResult = { ok: false, reason: String(error), stopCondition: null };
  } finally {
    server.close();
  }

  const sessionFile = path.join(entryOut, 'artifacts/session-1.json');
  const session = existsSync(sessionFile) ? JSON.parse(readFileSync(sessionFile, 'utf8')) : null;
  const outcome = classifyOutcome(entry, { setup, run: runResult, session });
  log(`  ${outcome.status}: ${outcome.reason}`);
  return { outcome, setup, run: runResult, report };
}

export async function runCorpus({ outDir, cacheDir, only = null, skipSetup = false, log = console.log }) {
  mkdirSync(outDir, { recursive: true });
  const entries = only ? manifest.entries.filter(entry => entry.id === only) : manifest.entries;
  if (entries.length === 0) throw new Error(`no corpus entry named ${only}. Known: ${manifest.entries.map(entry => entry.id).join(', ')}`);

  const results = [];
  for (const entry of entries) results.push(await runEntry(entry, { outDir, cacheDir, skipSetup, log }));

  const outcomes = results.map(result => result.outcome);
  const { accepted, unsound } = checkOutcomes(outcomes);
  const summary = {
    schemaVersion: 1,
    issue: 'SIDPROJ-111',
    externalValidity: manifest.externalValidity,
    note: manifest.note,
    ranAt: new Date().toISOString(),
    canvasScanVersion: JSON.parse(readFileSync(path.join(root, 'packages/core/package.json'), 'utf8')).version,
    packageBundleSha256: digest(path.join(root, 'packages/core/dist/canvas-scan.iife.js')),
    browserVersion: results.find(result => result.report)?.report.browserVersion ?? null,
    entries: results.map((result, index) => ({
      ...outcomes[index],
      applicationCommit: result.setup?.applicationCommit ?? null,
      buildArtifactSha256: result.setup?.buildArtifactSha256 ?? null,
      commands: (result.setup?.commands ?? []).map(command => ({ step: command.step, command: command.command, ok: command.ok })),
      handoff: result.report?.handoffPaths ?? null,
      reportPath: result.report?.reportPath ?? null,
    })),
    accepted: accepted.map(item => item.entryId),
    unsound: unsound.map(item => `${item.entryId}: ${item.status}`),
  };
  const summaryPath = path.join(outDir, 'corpus-run.json');
  writeFileSync(summaryPath, stable(summary));
  log(`\ncorpus: ${summaryPath}`);
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = Object.fromEntries(process.argv.slice(2).map(argument => {
    const index = argument.indexOf('=');
    return index === -1 ? [argument.slice(2), true] : [argument.slice(2, index), argument.slice(index + 1)];
  }));
  await runCorpus({
    outDir: options.out ?? path.join(root, `.corpus-${Date.now()}`),
    cacheDir: options.cache ?? path.join(os.tmpdir(), 'canvas-scan-corpus'),
    only: typeof options.entry === 'string' ? options.entry : null,
    skipSetup: options['skip-setup'] === true,
  });
}
