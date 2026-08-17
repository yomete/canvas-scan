import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertLabBoundary,
  assertManifestEntries,
  assertPublicContract,
  assertPackedVersion,
  ESM_RUNTIME_EXPORTS,
  TYPE_EXPORTS,
} from './pack-manifest.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = path.join(repoRoot, 'packages/core');
const { version } = JSON.parse(
  fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
);
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'canvas-scan-verify-pack-'),
);
const summaries = [];
let packDetails = {};
let publicSurfaceProbe = null;
const summaryPaths = ['/private/tmp/sidproj-70-pack-summary.json', '/private/tmp/sidproj-56-pack-summary.json'];
const summaryPath = summaryPaths[0];
const manualReleasePath = '/private/tmp/sidproj-56-manual-release-test.json';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function run(command, args, cwd) {
  const effectiveArgs = command === 'npm' && args[0] === 'install'
    ? [...args, '--cache', path.join(temporaryRoot, 'npm-cache')]
    : args;
  console.log(`\n$ ${command} ${effectiveArgs.join(' ')}`);
  const result = spawnSync(command, effectiveArgs, {
    cwd,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const outcome =
      result.status === null ? `signal ${result.signal}` : `exit ${result.status}`;
    throw new Error(`${command} failed with ${outcome}`);
  }
}

async function withServer(command, args, cwd, url, check) {
  const server = spawn(command, args, { cwd, stdio: 'inherit', detached: true });
  try {
    const deadline = Date.now() + 120_000;
    let last;
    while (Date.now() < deadline) {
      if (server.exitCode != null) {
        throw new Error(`server exited early: ${server.exitCode}`);
      }
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (response.status === 200) {
          const body = await response.text();
          check(body);
          return;
        }
        last = `status ${response.status}`;
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`server did not answer 200 within 120s (${last})`);
  } finally {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      process.kill(-server.pid, 'SIGKILL');
    } catch {}
  }
}


function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function verify(name, fn) {
  try {
    await fn();
    summaries.push({ name, status: 'PASS' });
    console.log(`\n${name}: PASS`);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    summaries.push({ name, status: 'FAIL', reason });
    console.error(`\n${name}: FAIL — ${reason}`);
    return false;
  }
}

function installedBin(fixture) {
  return path.join(
    fixture,
    'node_modules',
    'canvas-scan',
    'bin',
    'canvas-scan.mjs',
  );
}

async function verifyVite(tarball) {
  const fixture = path.join(temporaryRoot, 'vite-fixture');
  fs.mkdirSync(path.join(fixture, 'src'), { recursive: true });
  writeJson(path.join(fixture, 'package.json'), {
    private: true,
    type: 'module',
  });
  fs.writeFileSync(
    path.join(fixture, 'index.html'),
    '<div id="root"></div><script>window.__CANVAS_SCAN_OPTS={overlay:false,minFlashRasterOps:3}</script><script type="module" src="/src/main.jsx"></script>\n',
  );
  fs.writeFileSync(
    path.join(fixture, 'src/main.jsx'),
    `import 'canvas-scan/auto';
import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const settle = async count => { for (let index = 0; index < count; index++) await nextFrame(); };
const continuousCanvas = document.createElement('canvas');
const continuousContext = continuousCanvas.getContext('2d');
const burstCanvas = document.createElement('canvas');
burstCanvas.width = 900;
burstCanvas.height = 500;
const burstContext = burstCanvas.getContext('2d');
document.body.append(continuousCanvas, burstCanvas);

window.__MANUAL_RELEASE__ = {
  earlyLoad: Boolean(window.__CANVAS_SCAN__),
  async recordContinuous() {
    window.__CANVAS_SCAN__.startRecording();
    for (let frame = 0; frame < 7; frame++) {
      continuousContext.clearRect(0, 0, 300, 150);
      continuousContext.fillRect(10, 10, 20, 20);
      continuousContext.strokeRect(10, 10, 20, 20);
      await nextFrame();
    }
    await settle(2);
    return window.__CANVAS_SCAN__.stopRecording();
  },
  async recordBurst() {
    window.__CANVAS_SCAN__.startRecording();
    await settle(2);
    for (let pass = 0; pass < 5; pass++) {
      burstContext.clearRect(0, 0, 900, 500);
      for (let index = 0; index < 18000; index++) {
        burstContext.fillStyle = index & 1 ? '#2563eb' : '#7c3aed';
        burstContext.fillRect((index * 13) % 900, (index * 17) % 487, 9, 2 + (index % 8));
      }
    }
    await settle(3);
    return window.__CANVAS_SCAN__.stopRecording();
  },
};

function App() {
  const canvas = useRef(null);

  useEffect(() => {
    const context = canvas.current.getContext('2d');
    context.fillStyle = '#f00';
    context.fillRect(0, 0, 20, 20);
  }, []);

  return <canvas ref={canvas} width="40" height="40" />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
  );

  run(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      tarball,
      'vite@^6',
      'react@^19',
      'react-dom@^19',
      '@vitejs/plugin-react@^4',
    ],
    fixture,
  );
  run(process.execPath, [installedBin(fixture), 'init', fixture], fixture);
  run('npx', ['vite', 'build'], fixture);
  run(
    process.execPath,
    [
      '-e',
      `import('canvas-scan').then(m => { if (!${JSON.stringify(ESM_RUNTIME_EXPORTS)}.every(key => typeof m[key] === 'function')) process.exit(1) })`,
    ],
    fixture,
  );
  await withServer(
    'npx',
    ['vite', 'preview', '--port', '4381', '--strictPort'],
    fixture,
    'http://localhost:4381/',
    (body) => {
      if (!body.includes('id="root"')) throw new Error('vite preview served unexpected body');
    },
  );
}

function verifyPublicSurface(tarball) {
  const fixture = path.join(temporaryRoot, 'public-surface-fixture');
  fs.mkdirSync(fixture, { recursive: true });
  writeJson(path.join(fixture, 'package.json'), { private: true, type: 'module' });
  const install = ['install', '--no-audit', '--no-fund', tarball, 'typescript@^5'];
  run('npm', install, fixture);
  const importSource = `import('canvas-scan').then(value => { if (!${JSON.stringify(ESM_RUNTIME_EXPORTS)}.every(name => typeof value[name] === 'function')) process.exit(1) })`;
  run(process.execPath, ['-e', importSource], fixture);
  fs.writeFileSync(path.join(fixture, 'surface.ts'), `import type { ${TYPE_EXPORTS.join(', ')} } from 'canvas-scan';\ntype PublicTypes = ${TYPE_EXPORTS.join(' | ')};\ndeclare const value: PublicTypes;\nvoid value;\n`);
  writeJson(path.join(fixture, 'tsconfig.json'), { compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2022', noEmit: true, strict: true, skipLibCheck: false }, files: ['surface.ts'] });
  const tsc = path.join(fixture, 'node_modules/typescript/bin/tsc');
  run(process.execPath, [tsc, '--project', 'tsconfig.json'], fixture);
  publicSurfaceProbe = {
    installCommand: 'npm install --no-audit --no-fund <exact-tarball> typescript@^5 --cache <temporary-cache>',
    importCommand: 'node --eval <runtime-export-allowlist-probe>',
    typecheckCommand: 'node <fixture-typescript>/bin/tsc --project tsconfig.json',
    runtimeExports: ESM_RUNTIME_EXPORTS,
    typeExports: TYPE_EXPORTS,
    importStatus: 'PASS',
    typecheckStatus: 'PASS',
  };
}

async function verifyManualRelease(tarball) {
  const gitSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
  run(process.execPath, [
    path.join(repoRoot, 'packages/dogfood/manual-release-v04.mjs'),
    `--fixture=${path.join(temporaryRoot, 'vite-fixture')}`,
    `--tarball=${tarball}`,
    `--tarball-sha256=${sha256(fs.readFileSync(tarball))}`,
    `--iife-sha256=${packDetails.iifeSha256}`,
    `--git-sha=${gitSha}`,
  ], repoRoot);
  packDetails.manualReleaseTestSha256 = sha256(fs.readFileSync(manualReleasePath));
}

async function verifyNext(tarball) {
  const fixture = path.join(temporaryRoot, 'next-fixture');
  fs.mkdirSync(path.join(fixture, 'app'), { recursive: true });
  writeJson(path.join(fixture, 'package.json'), {
    private: true,
    type: 'module',
  });
  fs.writeFileSync(
    path.join(fixture, 'app/layout.jsx'),
    `export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
  );
  fs.writeFileSync(
    path.join(fixture, 'app/page.jsx'),
    `export default function Page() {
  return <main>canvas-scan package verification</main>;
}
`,
  );

  run(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      tarball,
      'next@15.3.x',
      'react@^19',
      'react-dom@^19',
    ],
    fixture,
  );
  run(
    process.execPath,
    [installedBin(fixture), 'init', fixture, '--write'],
    fixture,
  );

  const instrumentationClient = path.join(
    fixture,
    'instrumentation-client.ts',
  );
  if (
    !fs.existsSync(instrumentationClient) ||
    !fs
      .readFileSync(instrumentationClient, 'utf8')
      .startsWith("import 'canvas-scan/auto';")
  ) {
    throw new Error('canvas-scan init did not create instrumentation-client.ts');
  }

  run('npx', ['next', 'build'], fixture);
  await withServer(
    'npx',
    ['next', 'start', '-p', '4382'],
    fixture,
    'http://localhost:4382/',
    (body) => {
      if (!body.includes('canvas-scan package verification')) {
        throw new Error('next start served unexpected body');
      }
    },
  );
}

let tarball = null;
try {
  const packDirectory = path.join(temporaryRoot, 'pack');
  fs.mkdirSync(packDirectory);
  const packed = await verify('package', () => {
    // Deliberately dirty: prepack must clean stale build output itself so
    // this exercises the exact lifecycle maintainers use to publish.
    fs.mkdirSync(path.join(packageDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'dist/chunk-STALE00.js'), '// stale\n');
    run(
      'pnpm',
      [
        '--filter',
        'canvas-scan',
        'pack',
        '--pack-destination',
        packDirectory,
      ],
      repoRoot,
    );

    const tarballs = fs
      .readdirSync(packDirectory)
      .filter((file) => file.endsWith('.tgz'));
    if (tarballs.length !== 1) {
      throw new Error(`expected one tarball, found ${tarballs.length}`);
    }
    tarball = path.join(packDirectory, tarballs[0]);
    const listing = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' });
    if (listing.status !== 0) throw new Error('could not list tarball');
    const entries = listing.stdout.trim().split('\n');
    assertManifestEntries(entries);

    const readEntry = (entry) => {
      const extracted = spawnSync('tar', ['-xzOf', tarball, entry], {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      });
      if (extracted.status !== 0) {
        throw new Error(`could not read ${entry} from the tarball`);
      }
      return extracted.stdout;
    };
    const esmEntry = readEntry('package/dist/index.js');
    const chunkName = esmEntry.match(/from ["']\.\/(chunk-[A-Z0-9]+\.js)["']/)?.[1];
    if (!chunkName) throw new Error('ESM entry does not import the packed runtime chunk');
    const esmRuntime = readEntry(`package/dist/${chunkName}`);
    const iife = readEntry('package/dist/canvas-scan.iife.js');
    const declarations = readEntry('package/dist/index.d.ts');
    const readme = readEntry('package/README.md');
    const manifest = readEntry('package/package.json');
    assertPackedVersion(
      {
        manifest,
        esm: esmRuntime,
        iife,
        readme,
      },
      version,
    );
    assertPublicContract({ runtime: esmRuntime, declarations, iife });
    const contentEntries = entries.filter((entry) => /^(package\/(?:dist\/.*\.(?:js|d\.ts)|package\.json|README\.md|bin\/.*))$/.test(entry));
    assertLabBoundary(entries, Object.fromEntries(contentEntries.map((entry) => [entry, readEntry(entry)])));
    const sourceIndex = fs.readFileSync(path.join(packageDir, 'src/index.ts'), 'utf8');
    const sourceRecording = fs.readFileSync(path.join(packageDir, 'src/recording.ts'), 'utf8');
    assertPackedVersion({ iife: sourceIndex, recording: sourceRecording }, version);
    summaries.push({ name: 'public contract', status: 'PASS' });
    summaries.push({ name: 'lab boundary', status: 'PASS' });
    packDetails = { tarballSha256: sha256(fs.readFileSync(tarball)), esmSha256: sha256(esmEntry), runtimeSha256: sha256(esmRuntime), iifeSha256: sha256(iife), packageManifestVersion: JSON.parse(manifest).version, declarationHashes: Object.fromEntries(entries.filter((entry) => /^package\/dist\/.*\.d\.ts$/.test(entry)).map((entry) => [entry, sha256(readEntry(entry))])), manifestEntries: entries, runtimeExports: ESM_RUNTIME_EXPORTS, typeExports: TYPE_EXPORTS, publicContract: 'PASS', labBoundary: 'PASS' };
  });

  if (packed) {
    await verify('clean public surface fixture', () => verifyPublicSurface(tarball));
    const vitePassed = await verify('Vite fixture', () => verifyVite(tarball));
    if (vitePassed) await verify('manual release test', () => verifyManualRelease(tarball));
    else summaries.push({ name: 'manual release test', status: 'FAIL', reason: 'Vite fixture failed' });
    await verify('Next fixture', () => verifyNext(tarball));
  } else {
    summaries.push({
      name: 'clean public surface fixture',
      status: 'FAIL',
      reason: 'package step failed',
    });
    summaries.push({
      name: 'Vite fixture',
      status: 'FAIL',
      reason: 'package step failed',
    });
    summaries.push({
      name: 'Next fixture',
      status: 'FAIL',
      reason: 'package step failed',
    });
    summaries.push({
      name: 'manual release test',
      status: 'FAIL',
      reason: 'package step failed',
    });
  }
} finally {
  const failed = summaries.some((summary) => summary.status === 'FAIL');
  const environmentErrors = summaries
    .filter((summary) => summary.status === 'FAIL' && /fixture|EPERM|EACCES|network|ECONNREFUSED|EADDRINUSE|server|cache|exit 255/i.test(`${summary.name} ${summary.reason ?? ''}`))
    .map((summary) => summary.reason);
  const summary = {
    schemaVersion: 1,
    packageVersion: version,
    baseGitSha: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim(),
    dirty: spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim().length > 0,
    ...packDetails,
    fixtureResults: summaries,
    publicContractResults: summaries.filter((summary) => ['public contract', 'lab boundary'].includes(summary.name)),
    labBoundaryResults: summaries.filter((summary) => summary.name === 'lab boundary'),
    publicSurfaceProbe,
    environmentErrors,
    finalStatus: failed ? 'FAIL' : 'PASS',
  };
  for (const file of summaryPaths) writeJson(file, summary);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log('\nPack verification summary');
console.log(`PACK_SUMMARY: ${summaryPath}`);
for (const summary of summaries) {
  const reason = summary.reason ? ` — ${summary.reason}` : '';
  console.log(`${summary.name}: ${summary.status}${reason}`);
}

if (summaries.some((summary) => summary.status === 'FAIL')) {
  process.exitCode = 1;
}
