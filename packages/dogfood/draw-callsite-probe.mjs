import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { checkEvidence, checkEvidenceObject, createManifest, fixtureFiles, rowNames } from './draw-callsite-truth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = '/private/tmp/sidproj-68-draw-callsite-evidence';
const web = '/private/tmp/sidproj-68-draw-callsite-web';
const viteConfig = '/private/tmp/sidproj-68-vite.config.mjs';
const port = 5205;
const origin = `http://127.0.0.1:${port}`;
const pageUrl = `${origin}/v05-05-draw-callsite.html`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const diagnostics = { browserConsoleWarnings: [], browserConsoleErrors: [], pageErrors: [] };
const failures = [];
const requestLog = [];
const responseTasks = [];
let crossOriginRequestAttempts = 0;
let mappedSourceRequestAttempts = 0;
let browser;
let server;

if (process.argv[2] === '--check-evidence') {
  try { await checkEvidence(process.argv[3]); console.log('SIDPROJ_68_DRAW_CALLSITE: PASS'); }
  catch (error) { console.error(error); console.log('SIDPROJ_68_DRAW_CALLSITE: FAIL'); process.exitCode = 1; }
  process.exit();
}

function dirtyState() { return execFileSync('git', ['status', '--short', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }); }
async function ready() {
  for (let end = Date.now() + 60000; Date.now() < end; await wait(200)) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error('Vite exited before readiness');
    try { if ((await fetch(pageUrl)).ok) return; } catch {}
  }
  throw new Error('Vite did not start on strict port 5205');
}
async function stopServer() {
  if (!server?.pid) return;
  if (server.exitCode === null && server.signalCode === null) {
    process.kill(-server.pid, 'SIGTERM');
    await Promise.race([once(server, 'exit'), wait(5000)]);
    if (server.exitCode === null && server.signalCode === null) {
      process.kill(-server.pid, 'SIGKILL');
      await once(server, 'exit');
    }
  }
  for (let end = Date.now() + 5000; Date.now() < end; await wait(100)) {
    try { await fetch(pageUrl); } catch { return; }
  }
  throw new Error('Vite still accepts requests after shutdown');
}
async function buildFixtures() {
  const require = createRequire(path.join(root, 'packages/core/package.json'));
  const esbuild = require('esbuild');
  const globalNames = { direct: 'DirectFixture', nested: 'NestedFixture', bundled: 'BundledFixture', 'no-map': 'NoMapFixture' };
  await mkdir(web, { recursive: true });
  for (const name of rowNames) {
    const source = path.join(root, `packages/dogfood/fixtures/v05-05/${name}-source.js`);
    const scriptFile = path.join(web, `${name}.js`);
    await esbuild.build({ entryPoints: [source], bundle: true, format: 'iife', globalName: globalNames[name], sourcemap: name === 'no-map' ? false : 'external', sourcesContent: false, outfile: scriptFile });
    if (name !== 'no-map') {
      await writeFile(scriptFile, `${await readFile(scriptFile, 'utf8')}\n//# sourceMappingURL=${name}.js.map\n`);
      const mapFile = path.join(web, `${name}.js.map`);
      const map = JSON.parse(await readFile(mapFile, 'utf8'));
      map.sources = [`fixtures/v05-05/${name}-source.js`];
      delete map.sourceRoot;
      delete map.sourcesContent;
      await writeFile(mapFile, `${JSON.stringify(map)}\n`);
    }
  }
  return globalNames;
}
async function writeViteConfig() {
  const value = `
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = ${JSON.stringify(path.join(root, 'apps/workbench'))};
const web = ${JSON.stringify(web)};
export default {
  root,
  plugins: [{
    name: 'sidproj-68-fixtures',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        let file = null;
        if (pathname === '/canvas-scan.iife.js') file = ${JSON.stringify(path.join(root, 'packages/core/dist/canvas-scan.iife.js'))};
        else if (pathname.startsWith('/v05-05-generated/')) file = path.join(web, path.basename(pathname));
        if (!file) return next();
        try {
          const body = await readFile(file);
          response.statusCode = 200;
          response.setHeader('content-type', file.endsWith('.map') ? 'application/json' : 'text/javascript');
          response.setHeader('content-length', String(body.byteLength));
          response.end(body);
        } catch { response.statusCode = 404; response.end(); }
      });
    },
  }],
};
`;
  await writeFile(viteConfig, value);
}
function redirectChain(request) {
  const values = [];
  for (let current = request.redirectedFrom(); current; current = current.redirectedFrom()) values.unshift(current.url());
  return values;
}
function observe(page, row) {
  page.on('console', message => {
    if (message.type() === 'warning') diagnostics.browserConsoleWarnings.push(`${row}: ${message.text()}`);
    if (message.type() === 'error') diagnostics.browserConsoleErrors.push(`${row}: ${message.text()}`);
  });
  page.on('pageerror', error => diagnostics.pageErrors.push(`${row}: ${error.message}`));
  page.on('request', request => {
    if (request.resourceType() !== 'fetch') return;
    const url = new URL(request.url());
    if (url.origin !== origin) crossOriginRequestAttempts++;
    if (url.pathname.includes('/fixtures/v05-05/') && url.pathname.endsWith('-source.js')) mappedSourceRequestAttempts++;
  });
  page.on('response', response => {
    const request = response.request();
    if (request.resourceType() !== 'fetch') return;
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/v05-05-generated/')) return;
    responseTasks.push((async () => {
      const body = await response.body();
      const responseUrl = new URL(response.url());
      requestLog.push({
        row,
        kind: url.pathname.endsWith('.map') ? 'source-map' : 'generated-script',
        url: request.url(),
        requestOrigin: url.origin,
        responseUrl: response.url(),
        responseOrigin: responseUrl.origin,
        status: response.status(),
        redirected: redirectChain(request).length > 0,
        redirectChain: redirectChain(request),
        headers: await response.allHeaders(),
        responseBytes: body.byteLength,
      });
    })());
  });
}
async function runRow(name, globalName) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const page = await context.newPage();
  observe(page, name);
  await page.goto(pageUrl, { waitUntil: 'load' });
  await page.addScriptTag({ url: `${origin}/v05-05-generated/${name}.js?private-query=1#private-fragment` });
  await page.evaluate(async () => { await window.__V05_05__.makeSource(); });
  await page.locator('[data-canvas-scan]').evaluate(node => {
    const button = node.shadowRoot.querySelector('.counts');
    if (button?.getAttribute('aria-expanded') !== 'true') button?.click();
  });
  const action = page.locator('[data-action="start-explanation"]').first();
  if (!await action.isVisible()) await page.locator('.finding-toggle').first().click();
  await action.click();
  await page.locator('.explanation-panel.active').waitFor();
  await page.evaluate(async ({ name, globalName }) => {
    const method = name === 'no-map' ? 'noMap' : name;
    const draw = window[globalName]?.[method];
    if (typeof draw !== 'function') throw new Error(`missing fixture draw ${globalName}.${method}`);
    await window.__V05_05__.replay(draw);
  }, { name, globalName });
  for (let end = Date.now() + 5000; Date.now() < end; await page.waitForTimeout(50)) {
    await Promise.all(responseTasks);
    const generated = requestLog.some(request => request.row === name && request.kind === 'generated-script');
    const map = requestLog.some(request => request.row === name && request.kind === 'source-map');
    if (generated && (name === 'no-map' || map)) break;
  }
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.__CANVAS_SCAN__.stopExplanation(); });
  const artifact = await page.evaluate(() => window.__CANVAS_SCAN__.getLastExplanation());
  if (!artifact) throw new Error(`${name}: missing explanation artifact`);
  await page.locator('[data-canvas-scan]').evaluate(node => {
    const button = node.shadowRoot.querySelector('.counts');
    if (button?.getAttribute('aria-expanded') !== 'true') button?.click();
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const text = await page.locator('[data-canvas-scan]').evaluate(node => node.shadowRoot.querySelector('.explanation-panel.complete')?.innerText ?? '');
  await context.close();
  return { artifact, text };
}

const initialDirtyState = dirtyState();
const artifacts = {};
const overlay = { rows: [] };
let expected;
let chromeRevision = '';
let coreIifeSha256 = '';
let fixtureSha256 = {};
try {
  await rm(output, { recursive: true, force: true });
  await rm(web, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  execFileSync('pnpm', ['--filter', 'canvas-scan', 'run', 'build'], { cwd: root, stdio: 'inherit' });
  const bundle = await readFile(path.join(root, 'packages/core/dist/canvas-scan.iife.js'));
  coreIifeSha256 = sha256(bundle);
  const globalNames = await buildFixtures();
  await writeViteConfig();
  const vite = path.join(root, 'apps/workbench/node_modules/.bin/vite');
  server = spawn(vite, ['--config', viteConfig, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: path.join(root, 'apps/workbench'), detached: true, stdio: 'ignore' });
  await ready();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  chromeRevision = browser.version();
  for (const name of rowNames) {
    const result = await runRow(name, globalNames[name]);
    artifacts[name] = result.artifact;
    overlay.rows.push({ name, text: result.text });
  }
  await Promise.all(responseTasks);
  requestLog.sort((left, right) => rowNames.indexOf(left.row) - rowNames.indexOf(right.row) || left.url.localeCompare(right.url));
  const expectedTemplate = JSON.parse(await readFile(path.join(root, 'packages/dogfood/fixtures/v05-05/expected.json'), 'utf8'));
  expected = { ...expectedTemplate, origin };
  fixtureSha256 = Object.fromEntries(await Promise.all(fixtureFiles.map(async file => [file, sha256(await readFile(path.join(root, file)))])));
  const checks = {
    fourRows: Object.keys(artifacts).length === 4,
    browserDiagnostics: Object.values(diagnostics).every(values => values.length === 0),
    crossOriginRequestAttempts: crossOriginRequestAttempts === 0,
    mappedSourceRequestAttempts: mappedSourceRequestAttempts === 0,
    overlayRows: overlay.rows.length === 4,
    requestLog: requestLog.length >= 7,
  };
  const metadata = {
    status: 'PASS',
    chromeRevision,
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    initialDirtyState,
    finalDirtyState: dirtyState(),
    coreIifeSha256,
    fixtureSha256,
    loopbackOrigin: origin,
    crossOriginRequestAttempts,
    checks,
    ...diagnostics,
    failures: [],
  };
  const trusted = { expected: expectedTemplate, gitSha: metadata.gitSha, coreIifeSha256, fixtureSha256 };
  checkEvidenceObject({ expected, artifacts, requests: requestLog, overlay, metadata }, trusted);
  for (const name of rowNames) await writeFile(path.join(output, `${name}-artifact.json`), `${JSON.stringify(artifacts[name], null, 2)}\n`);
  await writeFile(path.join(output, 'expected.json'), `${JSON.stringify(expected, null, 2)}\n`);
  await writeFile(path.join(output, 'request-log.json'), `${JSON.stringify(requestLog, null, 2)}\n`);
  await writeFile(path.join(output, 'overlay-evidence.json'), `${JSON.stringify(overlay, null, 2)}\n`);
  await writeFile(path.join(output, 'run-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  await writeFile(path.join(output, 'evidence-sha256.txt'), await createManifest(output));
  await checkEvidence(output, trusted);
} catch (error) {
  failures.push(error instanceof Error ? error.stack ?? error.message : String(error));
  failures.push(JSON.stringify({ fixtureFrames: Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => [name, artifact.stacks?.flatMap(sample => sample.frames).filter(frame => frame.generated?.file.includes('/v05-05-generated/')) ?? []])), diagnostics, crossOriginRequestAttempts, mappedSourceRequestAttempts, overlay, requestLog }, null, 2));
} finally {
  try { await browser?.close(); } catch (error) { failures.push(String(error)); }
  try { await stopServer(); } catch (error) { failures.push(String(error)); }
  try { await rm(web, { recursive: true, force: true }); } catch (error) { failures.push(String(error)); }
  try { await rm(viteConfig, { force: true }); } catch (error) { failures.push(String(error)); }
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  console.log('SIDPROJ_68_DRAW_CALLSITE: FAIL');
  process.exitCode = 1;
} else console.log('SIDPROJ_68_DRAW_CALLSITE: PASS');
