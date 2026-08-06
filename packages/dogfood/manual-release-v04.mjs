import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const artifactPath = '/private/tmp/sidproj-56-manual-release-test.json';
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const index = arg.indexOf('=');
  return [arg.slice(2, index), arg.slice(index + 1)];
}));
const fixture = path.resolve(args.fixture ?? '');
const tarball = path.resolve(args.tarball ?? '');
const expectedTarballSha256 = args['tarball-sha256'];
const expectedIifeSha256 = args['iife-sha256'];
const expectedGitSha = args['git-sha'];
const baseUrl = 'http://127.0.0.1:4383';
const failures = [];
const checks = {};
let server;
let browser;
let browserVersion = null;
let continuous = null;
let burst = null;

const sha256 = value => createHash('sha256').update(value).digest('hex');
const check = (name, value) => {
  checks[name] = Boolean(value);
  if (!value) failures.push(`failed check: ${name}`);
};
const wait = timeout => new Promise(resolve => setTimeout(resolve, timeout));
const plain = value => value === null || ['string', 'number', 'boolean'].includes(typeof value) ||
  (Array.isArray(value) && value.every(plain)) ||
  (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(plain));
const privateKey = value => {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(privateKey);
  const blocked = new Set(['pageText', 'inputValue', 'pixels', 'element', 'node', 'canvas']);
  return Object.entries(value).some(([key, item]) => blocked.has(key) || privateKey(item));
};
const findingsAreUseful = session => session.findings.length > 0 && session.findings.every(finding =>
  finding.evidenceLevel === 'candidate' &&
  ['observation', 'explanation', 'nonEstablishedFacts'].every(key => typeof finding.claimBoundary?.[key] === 'string' && finding.claimBoundary[key].length > 20) &&
  typeof finding.nextCheck === 'string' && finding.nextCheck.length > 20);

async function ready() {
  for (let end = Date.now() + 60000; Date.now() < end; await wait(250)) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Vite exited before readiness with ${server.exitCode ?? server.signalCode}`);
    try { if ((await fetch(baseUrl)).ok) return; } catch {}
  }
  throw new Error('Vite preview did not start');
}

async function stopServer() {
  if (!server?.pid || server.exitCode !== null || server.signalCode !== null) return;
  try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await Promise.race([once(server, 'exit'), wait(5000)]);
  if (server.exitCode === null && server.signalCode === null) throw new Error('Vite preview did not stop');
}

try {
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const installedIife = path.join(fixture, 'node_modules/canvas-scan/dist/canvas-scan.iife.js');
  check('gitIdentity', gitSha === expectedGitSha);
  check('exactTarball', sha256(await readFile(tarball)) === expectedTarballSha256);
  check('installedIife', sha256(await readFile(installedIife)) === expectedIifeSha256);
  server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4383', '--strictPort'], { cwd: fixture, stdio: 'inherit', detached: true });
  await ready();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  browserVersion = browser.version();
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__MANUAL_RELEASE__ && window.__CANVAS_SCAN__);
  const identity = await page.evaluate(() => ({ version: window.__CANVAS_SCAN__.version, earlyLoad: window.__MANUAL_RELEASE__.earlyLoad }));
  check('runtimeVersion', identity.version === '0.4.0');
  check('earlyLoad', identity.earlyLoad === true);
  continuous = await page.evaluate(() => window.__MANUAL_RELEASE__.recordContinuous());
  burst = await page.evaluate(() => window.__MANUAL_RELEASE__.recordBurst());
  check('continuousRecording', continuous?.stopReason === 'manual' && continuous.windows.length > 0 && continuous.findings.some(finding => finding.type === 'repeated-draw-work'));
  check('burstRecording', burst?.stopReason === 'manual' && burst.windows.length > 0 && burst.findings.some(finding => finding.type === 'heavy-canvas-work'));
  check('usefulFindingCopy', findingsAreUseful(continuous) && findingsAreUseful(burst));
  check('plainJsonExport', plain(continuous) && plain(burst) && JSON.stringify(JSON.parse(JSON.stringify({ continuous, burst }))) === JSON.stringify({ continuous, burst }));
  check('privacyBoundary', !privateKey(continuous) && !privateKey(burst));
  check('distinctSessions', continuous.sessionId !== burst.sessionId);
  check('browserVersion', Boolean(browserVersion));
  await page.close();
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  try { await browser?.close(); } catch (error) { failures.push(String(error)); }
  try { await stopServer(); } catch (error) { failures.push(String(error)); }
}

const pass = failures.length === 0 && Object.values(checks).every(Boolean);
const result = {
  schemaVersion: 1,
  status: pass ? 'PASS' : 'FAIL',
  startedFromExactTarball: true,
  gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  expectedGitSha,
  packageVersion: '0.4.0',
  tarballSha256: expectedTarballSha256,
  iifeSha256: expectedIifeSha256,
  browserVersion,
  checks,
  sessions: { continuous, burst },
  failures,
};
await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(`MANUAL_RELEASE_ARTIFACT: ${artifactPath}`);
console.log(`MANUAL_RELEASE_TEST: ${pass ? 'PASS' : 'FAIL'}`);
process.exitCode = pass ? 0 : 1;
