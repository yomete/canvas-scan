import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertManifestEntries,
  assertPackedVersion,
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

function run(command, args, cwd) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
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
    '<div id="root"></div><script type="module" src="/src/main.jsx"></script>\n',
  );
  fs.writeFileSync(
    path.join(fixture, 'src/main.jsx'),
    `import 'canvas-scan/auto';
import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

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
      "import('canvas-scan').then(m => { if (typeof m.start !== 'function') process.exit(1) })",
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
    const chunk = entries.find((entry) => /dist\/chunk-/.test(entry));
    assertPackedVersion(
      {
        esm: readEntry(chunk),
        iife: readEntry('package/dist/canvas-scan.iife.js'),
        readme: readEntry('package/README.md'),
      },
      version,
    );
  });

  if (packed) {
    await verify('Vite fixture', () => verifyVite(tarball));
    await verify('Next fixture', () => verifyNext(tarball));
  } else {
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
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log('\nPack verification summary');
for (const summary of summaries) {
  const reason = summary.reason ? ` — ${summary.reason}` : '';
  console.log(`${summary.name}: ${summary.status}${reason}`);
}

if (summaries.some((summary) => summary.status === 'FAIL')) {
  process.exitCode = 1;
}
