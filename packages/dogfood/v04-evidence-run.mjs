import { createHash, randomUUID } from 'node:crypto';
import { constants, lstat, mkdir, open, readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseManifest } from './v04-release-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceRoot = '/private/tmp';
const testRun = Symbol('test evidence run');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const gitSha = /^[0-9a-f]{40}$/;
const chromeRevision = /^\d+\.\d+\.\d+\.\d+$/;
const decimal = /^[1-9]\d*$/;
const writtenFileIdentities = new WeakMap();
const canonicalTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const roles = [
  ['browser-document', 'apps/workbench/public/v04-lab.html'],
  ['bootstrap', 'apps/workbench/src/v04-lab-main.tsx'],
  ['calibration-fixture', 'apps/workbench/src/V04Lab.tsx'],
  ['repository-truth', 'packages/dogfood/lab-v04-truth.mjs'],
  ['release-runner-checker', 'packages/dogfood/lab-v04.mjs'],
  ['release-contract-tests', 'packages/dogfood/lab-v04.test.mjs'],
  ['evidence-directory', 'packages/dogfood/v04-evidence-run.mjs'],
  ['targeted-runner', 'packages/dogfood/v04-heavy-negative-probe.mjs'],
  ['targeted-checker', 'packages/dogfood/v04-heavy-negative-probe-check.mjs'],
  ['targeted-contract-tests', 'packages/dogfood/v04-heavy-negative-probe-check.test.mjs'],
];
export const trustedModuleSpec = Object.freeze(roles.map(([role, path]) => Object.freeze({ role, path })));
const artifacts = Object.freeze({
  targeted: Object.freeze([['targeted.json', 'targeted-evidence']]),
  'idle-release': Object.freeze([['canvas-lab-v0.4.json', 'matrix-primary'], ['variant-matrix.json', 'matrix-projection'], ['nearest-negatives.json', 'negative-projection'], ['console-summary.txt', 'console-summary'], ['integrated-continuous.png', 'continuous-screenshot'], ['integrated-burst.png', 'burst-screenshot'], ['mutation-output.txt', 'mutation-evidence'], ['idle-boundary.json', 'idle-evidence'], ['release-evidence.json', 'release-evidence'], ['sha256.txt', 'artifact-manifest']]),
});
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function parseExactJson(text) {
  if (typeof text !== 'string') throw new Error('artifact schema');
  let offset = 0;
  const whitespace = () => { while (/[\t\n\r ]/.test(text[offset] ?? '')) offset++; };
  const string = () => {
    if (text[offset] !== '"') throw new Error('artifact schema');
    const start = offset++;
    while (offset < text.length) {
      const character = text[offset++];
      if (character === '"') {
        const parsed = JSON.parse(text.slice(start, offset));
        for (let index = 0; index < parsed.length; index++) {
          const code = parsed.charCodeAt(index);
          if (code >= 0xd800 && code <= 0xdbff) { const next = parsed.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('artifact schema'); }
          else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('artifact schema');
        }
        return parsed;
      }
      if (character === '\\') offset++;
      else if (character.charCodeAt(0) < 0x20) throw new Error('artifact schema');
    }
    throw new Error('artifact schema');
  };
  const value = () => {
    whitespace();
    if (text[offset] === '{') {
      offset++; whitespace(); const objectKeys = new Set(); if (text[offset] === '}') { offset++; return; }
      while (true) { const key = string(); if (objectKeys.has(key)) throw new Error('artifact schema'); objectKeys.add(key); whitespace(); if (text[offset++] !== ':') throw new Error('artifact schema'); value(); whitespace(); const separator = text[offset++]; if (separator === '}') return; if (separator !== ',') throw new Error('artifact schema'); whitespace(); }
    }
    if (text[offset] === '[') { offset++; whitespace(); if (text[offset] === ']') { offset++; return; } while (true) { value(); whitespace(); const separator = text[offset++]; if (separator === ']') return; if (separator !== ',') throw new Error('artifact schema'); } }
    if (text[offset] === '"') { string(); return; }
    for (const literal of ['true', 'false', 'null']) if (text.startsWith(literal, offset)) { offset += literal.length; return; }
    const number = text.slice(offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/); if (!number) throw new Error('artifact schema'); offset += number[0].length;
  };
  try { value(); whitespace(); if (offset !== text.length) throw new Error('artifact schema'); return JSON.parse(text); }
  catch (error) { if (error?.message === 'artifact schema') throw error; throw new Error('artifact schema'); }
}
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...expected].sort().join('|');
const identity = stat => stat && stat.dev > 0 && stat.ino > 0 ? { device: String(stat.dev), inode: String(stat.ino) } : null;
const sameIdentity = (stat, value) => identity(stat)?.device === value.device && identity(stat)?.inode === value.inode;
const mode = stat => stat.mode & 0o777;
const checkedDirectory = async run => {
  const stat = await lstat(run.directory);
  const expectedRoot = run[testRun] === true ? run.root : evidenceRoot;
  if (!stat.isDirectory() || stat.isSymbolicLink() || mode(stat) !== 0o700 || path.dirname(run.directory) !== expectedRoot || !sameIdentity(stat, run.directoryIdentity)) throw new Error('run directory');
  return stat;
};
const artifactSpec = (run, name) => artifacts[run.kind]?.find(([item]) => item === name);
const checkedName = (run, name, final = true) => {
  if (typeof name !== 'string' || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || path.isAbsolute(name) || final && name !== 'run.json' && !artifactSpec(run, name)) throw new Error(final ? 'unexpected final artifact' : 'unexpected temporary artifact');
  const target = path.resolve(run.directory, name);
  if (path.dirname(target) !== run.directory) throw new Error(final ? 'unexpected final artifact' : 'unexpected temporary artifact');
  return target;
};
export async function verifyReleaseManifest(base = root, manifest = releaseManifest) {
  if (!keys(manifest, ['schemaVersion', 'algorithm', 'modules']) || manifest.schemaVersion !== 1 || manifest.algorithm !== 'sha256' || !Array.isArray(manifest.modules) || manifest.modules.some(item => !keys(item, ['role', 'path', 'sha256']) || !digest.test(item.sha256))) throw new Error('manifest schema');
  if (manifest.modules.length !== trustedModuleSpec.length) throw new Error('trusted module set');
  const pairs = manifest.modules.map(({ role, path: itemPath }) => `${role}\0${itemPath}`);
  const expected = trustedModuleSpec.map(({ role, path: itemPath }) => `${role}\0${itemPath}`);
  if (new Set(pairs).size !== pairs.length || !pairs.every(pair => expected.includes(pair))) throw new Error('trusted module set');
  if (pairs.join('\n') !== expected.join('\n')) throw new Error('trusted module order');
  const modules = [];
  for (const item of manifest.modules) {
    const target = path.resolve(base, item.path);
    if (!target.startsWith(`${base}${path.sep}`)) throw new Error('trusted module set');
    let bytes;
    try { bytes = await readFile(target); } catch { throw new Error('trusted module set'); }
    if (sha256(bytes) !== item.sha256) throw new Error('trusted module digest');
    modules.push({ role: item.role, path: item.path, sha256: item.sha256 });
  }
  return modules;
}
export async function createEvidenceRun(kind, options = {}) {
  const resolvedTestRoot = typeof options.testRoot === 'string' ? path.resolve(options.testRoot) : null;
  const production = keys(options, []);
  const testing = keys(options, ['testRoot']) && typeof options.testRoot === 'string' && path.isAbsolute(options.testRoot) && options.testRoot === resolvedTestRoot && resolvedTestRoot !== evidenceRoot;
  const selectedTesting = keys(options, ['testRoot', 'runId']) && typeof options.testRoot === 'string' && path.isAbsolute(options.testRoot) && options.testRoot === resolvedTestRoot && resolvedTestRoot !== evidenceRoot && typeof options.runId === 'string' && uuid.test(options.runId);
  if (!['targeted', 'idle-release'].includes(kind) || !production && !testing && !selectedTesting) throw new Error('invalid evidence run');
  const runRoot = testing || selectedTesting ? path.resolve(options.testRoot) : evidenceRoot;
  const runId = selectedTesting ? options.runId : randomUUID(); const directory = path.join(runRoot, `sidproj-102-${kind}-${runId}`);
  try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error?.code === 'EEXIST') throw new Error('run directory exists'); throw error; }
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || mode(stat) !== 0o700 || path.dirname(directory) !== runRoot || path.basename(directory) !== `sidproj-102-${kind}-${runId}`) throw new Error('run directory');
  const run = { kind, runId, directory, root: runRoot, directoryIdentity: identity(stat) };
  Object.defineProperty(run, testRun, { value: testing || selectedTesting });
  return Object.freeze(run);
}
export async function writeFinalArtifact(run, name, bytes) {
  if (name === 'run.json') throw new Error('unexpected final artifact');
  const target = checkedName(run, name); await checkedDirectory(run);
  let handle;
  try { handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if (error?.code === 'EEXIST') throw new Error('final artifact exists'); throw error; }
  let written;
  try { await handle.writeFile(bytes); await handle.sync(); written = await handle.stat(); if (!written.isFile() || mode(written) !== 0o600 || written.nlink !== 1) throw new Error('artifact identity'); }
  finally { await handle.close(); }
  await checkedDirectory(run); const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || mode(stat) !== 0o600 || stat.nlink !== 1 || !sameIdentity(stat, identity(written))) throw new Error('artifact identity');
  const recorded = writtenFileIdentities.get(run) ?? new Map(); recorded.set(name, identity(stat)); writtenFileIdentities.set(run, recorded);
  return { name, ...identity(stat), size: String(stat.size), sha256: sha256(bytes) };
}
export async function readCurrentArtifact(run, name) {
  const target = checkedName(run, name); await checkedDirectory(run);
  let handle;
  try { handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { throw new Error('artifact identity'); }
  try {
    const before = await handle.stat(); let pathBefore;
    try { pathBefore = await lstat(target); } catch { throw new Error('artifact identity'); }
    const recorded = writtenFileIdentities.get(run)?.get(name);
    if (!before.isFile() || mode(before) !== 0o600 || before.nlink !== 1 || !sameIdentity(before, identity(pathBefore)) || recorded && !sameIdentity(before, recorded)) throw new Error('artifact identity');
    const bytes = await handle.readFile(); const after = await handle.stat(); const pathAfter = await lstat(target);
    if (!sameIdentity(before, identity(after)) || !sameIdentity(before, identity(pathAfter)) || after.nlink !== 1 || mode(after) !== 0o600) throw new Error('artifact identity');
    await checkedDirectory(run); return bytes;
  } finally { await handle.close(); }
}
export async function writeRunIndex(run, value) {
  await checkedDirectory(run); const target = path.join(run.directory, 'run.json'); let handle;
  try { handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if (error?.code === 'EEXIST') throw new Error('final artifact exists'); throw error; }
  let written; let bytes;
  try {
    written = await handle.stat();
    if (!written.isFile() || mode(written) !== 0o600 || written.nlink !== 1) throw new Error('artifact identity');
    bytes = `${JSON.stringify({ ...value, index: { mode: '0600', ...identity(written) } })}\n`;
    await handle.writeFile(bytes); await handle.sync(); written = await handle.stat();
    if (!written.isFile() || mode(written) !== 0o600 || written.nlink !== 1) throw new Error('artifact identity');
  } finally { await handle.close(); }
  await checkedDirectory(run); const stat = await lstat(target); if (!stat.isFile() || stat.isSymbolicLink() || mode(stat) !== 0o600 || stat.nlink !== 1 || !sameIdentity(stat, identity(written))) throw new Error('artifact identity');
  const recorded = writtenFileIdentities.get(run) ?? new Map(); recorded.set('run.json', identity(stat)); writtenFileIdentities.set(run, recorded);
  return { name: 'run.json', ...identity(stat), size: String(stat.size), sha256: sha256(bytes) };
}
export async function checkRunDirectory(run) { await checkedDirectory(run); const names = (await readdir(run.directory)).sort(); await checkedDirectory(run); const expected = [...artifacts[run.kind].map(([name]) => name), 'run.json'].sort(); if (names.join('\n') !== expected.join('\n')) throw new Error('artifact set'); return names; }
export async function checkRunIndex(run, now = Date.now()) {
  await checkRunDirectory(run);
  const value = parseExactJson((await readCurrentArtifact(run, 'run.json')).toString('utf8'));
  if (!keys(value, ['schemaVersion', 'issue', 'kind', 'runId', 'startedAt', 'endedAt', 'directory', 'source', 'artifacts', 'index']) || value.schemaVersion !== 1 || value.issue !== 'SIDPROJ-102' || value.kind !== run.kind || value.runId !== run.runId || !canonicalTime(value.startedAt) || !canonicalTime(value.endedAt) || Date.parse(value.startedAt) >= Date.parse(value.endedAt) || Date.parse(value.endedAt) - Date.parse(value.startedAt) > 30 * 60 * 1000 || Date.parse(value.startedAt) > now || Date.parse(value.endedAt) > now || now - Date.parse(value.endedAt) > 24 * 60 * 60 * 1000 || !Array.isArray(value.artifacts)) throw new Error('artifact schema');
  if (!keys(value.directory, ['mode', 'device', 'inode']) || value.directory.mode !== '0700' || value.directory.device !== run.directoryIdentity.device || value.directory.inode !== run.directoryIdentity.inode || !decimal.test(value.directory.device) || !decimal.test(value.directory.inode)) throw new Error('artifact identity');
  const indexStat = await lstat(path.join(run.directory, 'run.json'));
  if (!keys(value.index, ['mode', 'device', 'inode']) || value.index.mode !== '0600' || !decimal.test(value.index.device) || !decimal.test(value.index.inode) || !sameIdentity(indexStat, value.index) || mode(indexStat) !== 0o600 || indexStat.nlink !== 1) throw new Error('artifact identity');
  const source = value.source;
  if (!keys(source, ['gitSha', 'chromeRevision', 'bundleSha256', 'manifestSha256', 'modules']) || !gitSha.test(source.gitSha) || !chromeRevision.test(source.chromeRevision) || !digest.test(source.bundleSha256) || !digest.test(source.manifestSha256) || !Array.isArray(source.modules) || source.modules.length !== trustedModuleSpec.length) throw new Error('artifact schema');
  if (source.modules.some((item, index) => !keys(item, ['role', 'path', 'sha256']) || item.role !== trustedModuleSpec[index].role || item.path !== trustedModuleSpec[index].path || !digest.test(item.sha256))) throw new Error('artifact schema');
  const expected = artifacts[run.kind];
  if (value.artifacts.length !== expected.length) throw new Error('artifact set');
  for (const [index, [name, role]] of expected.entries()) {
    const item = value.artifacts[index];
    if (!keys(item, ['name', 'role', 'device', 'inode', 'size', 'sha256']) || item.name !== name || item.role !== role || !decimal.test(item.device) || !decimal.test(item.inode) || !decimal.test(item.size) || !digest.test(item.sha256)) throw new Error('artifact set');
    const bytes = await readCurrentArtifact(run, name);
    const stat = await lstat(path.join(run.directory, name));
    if (!sameIdentity(stat, item) || mode(stat) !== 0o600 || stat.nlink !== 1 || item.size !== String(bytes.length) || item.sha256 !== sha256(bytes)) throw new Error('artifact identity');
  }
  return value;
}
export async function removeOwnedTemporary(run, name, fileIdentity) {
  const target = checkedName(run, name, false);
  if (artifactSpec(run, name) || name === 'run.json') throw new Error('unexpected temporary artifact');
  await checkedDirectory(run);
  let handle;
  try { handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { throw new Error('artifact identity'); }
  try {
    const opened = await handle.stat();
    const pathBefore = await lstat(target);
    if (!opened.isFile() || opened.nlink !== 1 || mode(opened) !== 0o600 || !sameIdentity(opened, fileIdentity) || !sameIdentity(pathBefore, fileIdentity)) throw new Error('artifact identity');
    await checkedDirectory(run);
    const pathImmediatelyBefore = await lstat(target);
    if (!sameIdentity(pathImmediatelyBefore, fileIdentity) || pathImmediatelyBefore.nlink !== 1 || mode(pathImmediatelyBefore) !== 0o600) throw new Error('artifact identity');
    await unlink(target);
    const removed = await handle.stat();
    if (!sameIdentity(removed, fileIdentity) || removed.nlink !== 0) throw new Error('artifact identity');
  } finally { await handle.close(); }
}
